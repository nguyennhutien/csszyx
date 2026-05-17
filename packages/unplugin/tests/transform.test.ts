import { transformSourceCode } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import { mangleCodeClassesSync } from '../src/unplugin.js';

/**
 * Tests for the compiler's transformSourceCode function as used by the unplugin.
 *
 * The pre-plugin calls transformSourceCode() on .tsx/.jsx files containing
 * sz props. These tests verify the AST transform produces correct output.
 */
describe('transformSourceCode (compiler AST transform)', () => {
    describe('static string sz prop', () => {
        it('should convert sz="..." to className="..."', () => {
            const source = 'const el = <div sz="p-4 bg-red-500" />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('className=');
            expect(result.code).toContain('p-4 bg-red-500');
            expect(result.code).not.toContain(' sz=');
        });
    });

    describe('static object sz prop', () => {
        it('should compile static sz object to className string', () => {
            const source = 'const el = <div sz={{ p: 4, bg: "red-500" }} />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('className=');
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('bg-red-500');
        });

        it('should handle nested variant objects', () => {
            const source = 'const el = <div sz={{ p: 4, hover: { bg: "blue-600" } }} />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('className=');
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('hover:bg-blue-600');
        });

        it('should handle multiple properties', () => {
            const source = 'const el = <div sz={{ m: 2, p: 4, text: "lg", font: "bold" }} />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('m-2');
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('text-lg');
            expect(result.code).toContain('font-bold');
        });
    });

    describe('dynamic sz prop (runtime fallback)', () => {
        it('should wrap dynamic expressions with _sz()', () => {
            const source = 'const el = <div sz={dynamicStyles} />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(true);
            expect(result.code).toContain('_sz(dynamicStyles)');
            expect(result.code).toContain('className=');
        });

        it('should wrap function call with _sz()', () => {
            const source = 'const el = <div sz={getStyles()} />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(true);
            expect(result.code).toContain('_sz(getStyles())');
        });
    });

    describe('files without sz', () => {
        it('should skip files without sz keyword', () => {
            const source = 'const el = <div className="p-4" />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(false);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toBe(source);
        });

        it('should skip plain JS files', () => {
            const source = 'export const config = { key: "value" };';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(false);
            expect(result.code).toBe(source);
        });
    });

    describe('edge cases', () => {
        it('should handle multiple sz props in same file', () => {
            const source = `
const a = <div sz={{ p: 4 }} />;
const b = <span sz="text-lg" />;
`;
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('text-lg');
        });

        it('should handle sz with empty object', () => {
            const source = 'const el = <div sz={{}} />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('className=');
        });
    });
});

// ─── Mangle map used by post-plugin pass tests ───────────────────────────────
const TEST_MANGLE: Record<string, string> = {
    flex: 'z',
    'items-center': 'h',
    'flex-row': 'a',
    'flex-col': 'b',
    'p-4': 'c',
    'rounded-xl': 'd',
    'rounded-full': 'e',
    'size-24': 'f',
    'bg-violet-500': 'g',
    'scale-75': 'i',
    'scale-100': 'j',
    // After compiler fix: content: '""' → before:content-[''] (single-quote form, no escapes needed)
    "before:content-['']": 'k',
    relative: 'l',
    'after:absolute': 'm',
};

describe('mangleCodeClassesSync — Pass 1 (direct static className strings)', () => {
    it('mangles a simple double-quoted className', () => {
        expect(mangleCodeClassesSync('className="flex items-center"', TEST_MANGLE)).toBe(
            'className="z h"',
        );
    });

    it('mangles a simple single-quoted className', () => {
        expect(mangleCodeClassesSync("className='flex items-center'", TEST_MANGLE)).toBe(
            "className='z h'",
        );
    });

    it('leaves non-className strings untouched', () => {
        const code = 'const x = "flex items-center";';
        expect(mangleCodeClassesSync(code, TEST_MANGLE)).toBe(code);
    });

    it("mangles className with before:content-[''] (single-quote form, no escape sequences)", () => {
        // After compiler fix: content: '""' → before:content-[''] (single quotes, no \" in JS string)
        // Single quotes inside a double-quoted string literal need no escaping.
        const code = 'className="relative before:content-[\'\'] after:absolute"';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('className="l k m"');
    });
});

describe('mangleCodeClassesSync — Pass 1.5 (template literal quasi strings)', () => {
    it('mangles the static quasi prefix in a className template literal', () => {
        // Generated when sz={{ flex: true, items: 'center', flexDir: isRow ? 'row' : 'col' }}
        // Pre-plugin output (in bundle form):  className:`flex items-center ${isRow?"flex-row":"flex-col"}`
        const code = 'className:`flex items-center ${isRow?"flex-row":"flex-col"}`';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('className:`z h ${isRow?"a":"b"}`');
    });

    it('mangles multiple quasi segments (between several interpolations)', () => {
        // className:`flex ${c1?"flex-row":"flex-col"} items-center ${c2?"scale-75":"scale-100"}`
        const code =
            'className:`flex ${c1?"flex-row":"flex-col"} items-center ${c2?"scale-75":"scale-100"}`';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('className:`z ${c1?"a":"b"} h ${c2?"i":"j"}`');
    });

    it('does not mangle unknown classes in quasi (skips the quasi unchanged)', () => {
        const code = 'className:`unknown-class ${cond?"flex-row":"flex-col"}`';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        // unknown-class is not in map → mangleClassString returns it unchanged → quasi unchanged
        expect(result).toContain('unknown-class');
        // but the ternary strings are still mangled by Pass 2
        expect(result).toContain('"a"');
        expect(result).toContain('"b"');
    });

    it('leaves non-className template literals untouched', () => {
        const code = 'const x = `flex items-center ${a?"flex-row":"flex-col"}`;';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        // No className: prefix → pass 1.5 does not touch it
        expect(result).toBe(code);
    });

    it('handles trailing quasi (text after the last interpolation)', () => {
        const code = 'className:`${cond?"flex-row":"flex-col"} flex items-center`';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('className:`${cond?"a":"b"} z h`');
    });

    it('mangles unminified SSR bundle form with space after colon (className: `...`)', () => {
        // Unminified SSR bundles emit `className: \`...\`` (space after colon)
        // versus the minified client bundle form `className:\`...\`` (no space).
        const code = 'className: `flex items-center ${isRow?"flex-row":"flex-col"}`';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('className:`z h ${isRow?"a":"b"}`');
    });

    it('mangles chained ternary inside interpolation (size/variant pattern)', () => {
        // sz={{ flex: true, size: s==="sm" ? "rounded-xl" : s==="md" ? "rounded-full" : "p-4", items: "center" }}
        // Non-class strings ("sm", "md") are values of a comparison, not class names — preserved.
        const code =
            'className:`flex ${s==="sm"?"rounded-xl":s==="md"?"rounded-full":"p-4"} items-center`';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('className:`z ${s==="sm"?"d":s==="md"?"e":"c"} h`');
    });
});

describe('mangleCodeClassesSync — Pass 2 (ternary className expressions)', () => {
    it('mangles quoted strings in a simple ternary', () => {
        const code = 'className:cond?"flex":"items-center"';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('className:cond?"z":"h"');
    });

    it('skips expressions without a ternary operator', () => {
        const code = 'className:someVar';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe(code);
    });

    it('mangles ternary arg inside a call with a leading static string', () => {
        // _szMerge("flex", cond?"p-4":"rounded-xl") — the leading static string causes
        // the old regex (stopped at first comma) to miss the ternary branch strings
        const code = 'className:r("flex",cond?"p-4":"rounded-xl")';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('className:r("z",cond?"c":"d")');
    });

    it('mangles multi-arg call: static + && + ternary', () => {
        // sz array: [baseClass, cond && conditionalClass, ternaryClass]
        const code = 'className:r("flex",pe&&"p-4",cond?"rounded-xl":"rounded-full")';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('className:r("z",pe&&"c",cond?"d":"e")');
    });

    it('mangles ternary-only call (no leading static)', () => {
        const code = 'className:r(cond?"p-4":"rounded-xl")';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('className:r(cond?"c":"d")');
    });

    it('mangles chained ternary direct expression (3-way variant switcher)', () => {
        // sz={{ size: s==="sm" ? 4 : s==="md" ? "rounded-xl" : "rounded-full" }}
        // Compiler emits a direct ternary, no _szMerge wrapper.
        const code = 'className:s==="sm"?"p-4":s==="md"?"rounded-xl":"rounded-full"';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        // "sm" and "md" are comparison strings, not classes → preserved unchanged
        expect(result).toBe('className:s==="sm"?"c":s==="md"?"d":"e"');
    });

    it('handles multiple className: blocks in same line (minified multi-component)', () => {
        // Minified bundle often has many JSX elements on a single line.
        const code =
            '{className:isA?"flex":"items-center"},{className:isRow?"flex-row":"flex-col"}';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('{className:isA?"z":"h"},{className:isRow?"a":"b"}');
    });

    it('does not contaminate adjacent object props (depth-0 comma terminates scan)', () => {
        // Scanner must stop at the comma separating className from a neighbouring prop
        // such as id or title, otherwise it could corrupt those string values.
        const code = '{className:cond?"flex":"items-center",id:"flex-guide"}';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        // class strings mangled, "flex-guide" in id prop left untouched
        expect(result).toBe('{className:cond?"z":"h",id:"flex-guide"}');
    });

    it('preserves non-class condition strings (variant==="primary" pattern)', () => {
        // sz={{ bg: variant === 'primary' ? 'violet-500' : undefined, ... }}
        // "primary" is a comparison operand, not a CSS class — must not be altered.
        const code = 'className:variant==="primary"?"bg-violet-500 p-4":"flex items-center"';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('className:variant==="primary"?"g c":"z h"');
    });
});

describe('mangleCodeClassesSync — Pass 3 (runtime helper string args)', () => {
    it('mangles string after ( in _szMerge call', () => {
        const code = '_szMerge("flex items-center","p-4")';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('_szMerge("z h","c")');
    });

    it('mangles string after , in _szMerge call', () => {
        const code = '_szMerge("flex",pe&&"p-4")';
        // "flex" is after ( → mangled, "p-4" is after && → should be mangled
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('_szMerge("z",pe&&"c")');
    });

    it('mangles string after && — minified form (sz array conditional element)', () => {
        // pe&&"text-right" — compiled from sz={[..., pe && { textAlign: 'right' }]}
        // "p-4" stands in for any single-class string following &&
        const code = '_szMerge("flex items-center",pe&&"p-4 rounded-xl")';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('_szMerge("z h",pe&&"c d")');
    });

    it('mangles string after && with space — unminified SSR form', () => {
        const code = '_szMerge("flex items-center", pe && "p-4 rounded-xl")';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('_szMerge("z h", pe && "c d")');
    });

    it('skips string after && if any token is unknown', () => {
        const code = '_szMerge("flex",pe&&"unknown-class")';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('_szMerge("z",pe&&"unknown-class")');
    });

    it('mangles _szSwitch branch and fallback class strings', () => {
        const code =
            '_szSwitch([[variant==="primary","bg-violet-500 p-4"],[active,"rounded-xl"]],"flex items-center")';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('_szSwitch([[variant==="primary","g c"],[active,"d"]],"z h")');
    });
});

describe('mangleCodeClassesSync — real-world integration (multi-pass)', () => {
    // Button component: sz={[{ flex: true, items: 'center', rounded: 'full' },
    //   variant === 'primary' && { bg: 'violet-500' },
    //   size === 'lg' ? { scale: 100 } : { scale: 75 }]}
    // Minified bundle: className:_szMerge("flex items-center rounded-full",variant==="primary"&&"bg-violet-500",size==="lg"?"scale-100":"scale-75")
    it('Button — static base + && variant + size ternary (minified)', () => {
        const code =
            'className:_szMerge("flex items-center rounded-full",variant==="primary"&&"bg-violet-500",size==="lg"?"scale-100":"scale-75")';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        // Pass 2 sees ternary → mangles all "..." including the && string and ternary branches
        // Pass 3 is then a no-op (already-mangled tokens not in map)
        expect(result).toBe(
            'className:_szMerge("z h e",variant==="primary"&&"g",size==="lg"?"j":"i")',
        );
    });

    it('Button — SSR unminified form (spaces after colon + operators)', () => {
        const code =
            'className: _szMerge("flex items-center rounded-full", variant === "primary" && "bg-violet-500", size === "lg" ? "scale-100" : "scale-75")';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        // Pass 2: space after colon is accepted; expression mangled in full
        expect(result).toBe(
            'className: _szMerge("z h e", variant === "primary" && "g", size === "lg" ? "j" : "i")',
        );
    });

    it('Avatar — all-ternary _szMerge, no static base (size variant)', () => {
        // sz={[ isRow ? { flexDir: 'row' } : { flexDir: 'col' }, isBig ? { size: 24 } : { p: 4 } ]}
        const code = 'className:_szMerge(isRow?"flex-row":"flex-col",isBig?"size-24":"p-4")';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('className:_szMerge(isRow?"a":"b",isBig?"f":"c")');
    });

    it('Modal — 4-arg _szMerge: static + two && booleans + ternary', () => {
        // sz={[{ flex: true, items: 'center' }, open && { p: 4 }, active && { rounded: 'xl' },
        //       full ? { rounded: 'full' } : { scale: 75 }]}
        const code =
            'className:_szMerge("flex items-center",open&&"p-4",active&&"rounded-xl",full?"rounded-full":"scale-75")';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe('className:_szMerge("z h",open&&"c",active&&"d",full?"e":"i")');
    });

    it('full minified JSX line with two sibling elements', () => {
        // Two React.createElement calls on one line, as produced by esbuild
        const code =
            'n.createElement("div",{className:isA?"flex":"items-center"},n.createElement("span",{className:isRow?"flex-row":"flex-col"}))';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe(
            'n.createElement("div",{className:isA?"z":"h"},n.createElement("span",{className:isRow?"a":"b"}))',
        );
    });

    it('Pass 2 then Pass 3 — no double-mangling on already-mangled strings', () => {
        // Verifies idempotency: if Pass 2 already mangled the static string inside
        // _szMerge, Pass 3's lookbehind still runs but must not corrupt the result.
        // "flex items-center" is static (no ternary alone), so if we include a ternary
        // the whole expression goes through Pass 2 first.
        const code =
            'className:_szMerge("flex items-center",pe&&"p-4",cond?"rounded-xl":"rounded-full")';
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        // Run a second time — idempotent
        const result2 = mangleCodeClassesSync(result, TEST_MANGLE);
        expect(result).toBe('className:_szMerge("z h",pe&&"c",cond?"d":"e")');
        expect(result2).toBe(result); // second pass must be no-op
    });
});

/**
 * Tests for the unplugin's class extraction and mangling pipeline.
 * These test the regex-based extractClasses and mangleClasses used
 * inside the plugin transform hook.
 */
describe('unplugin class extraction & mangling', () => {
    // Simulate the plugin's extractClasses logic
    /**
     * Extracts CSS class names from source code strings.
     * @param code - The source code to extract classes from
     * @returns Set of extracted class names
     */
    function extractClasses(code: string): Set<string> {
        const classes = new Set<string>();
        const classPattern = /(?:class(?:Name)?|sz)[:=]\s*["']([^"']*)["']/g;
        for (const match of code.matchAll(classPattern)) {
            const parts = match[1].split(/\s+/).filter(Boolean);
            for (const cls of parts) {
                classes.add(cls);
            }
        }
        return classes;
    }

    it('should extract className values', () => {
        const code = 'className="p-4 bg-red-500 text-white"';
        const classes = extractClasses(code);
        expect(classes).toContain('p-4');
        expect(classes).toContain('bg-red-500');
        expect(classes).toContain('text-white');
    });

    it('should extract class values', () => {
        const code = 'class="flex items-center"';
        const classes = extractClasses(code);
        expect(classes).toContain('flex');
        expect(classes).toContain('items-center');
    });

    it('should extract from multiple occurrences', () => {
        const code = `
className="p-4 m-2"
className="text-lg font-bold"
`;
        const classes = extractClasses(code);
        expect(classes.size).toBe(4);
        expect(classes).toContain('p-4');
        expect(classes).toContain('m-2');
        expect(classes).toContain('text-lg');
        expect(classes).toContain('font-bold');
    });

    it('should deduplicate classes', () => {
        const code = `
className="p-4 bg-red-500"
className="p-4 text-white"
`;
        const classes = extractClasses(code);
        expect(classes.size).toBe(3); // p-4, bg-red-500, text-white
    });
});
