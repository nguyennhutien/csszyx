import { transformSource } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import { mangleCodeClassesSync } from '../src/unplugin.js';

/**
 * Tests for the compiler's transformSource function as used by the unplugin.
 *
 * The pre-plugin calls transformSource() on .tsx/.jsx files containing
 * sz props. These tests verify the AST transform produces correct output.
 */
describe('transformSource (compiler AST transform)', () => {
    describe('static string sz prop', () => {
        it('should convert sz="..." to className="..."', () => {
            const source = 'const el = <div sz="p-4 bg-red-500" />;';
            const result = transformSource(source);
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
            const result = transformSource(source);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('className=');
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('bg-red-500');
        });

        it('should handle nested variant objects', () => {
            const source = 'const el = <div sz={{ p: 4, hover: { bg: "blue-600" } }} />;';
            const result = transformSource(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('className=');
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('hover:bg-blue-600');
        });

        it('should handle multiple properties', () => {
            const source = 'const el = <div sz={{ m: 2, p: 4, text: "lg", font: "bold" }} />;';
            const result = transformSource(source);
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
            const result = transformSource(source);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(true);
            expect(result.code).toContain('_sz(dynamicStyles)');
            expect(result.code).toContain('className=');
        });

        it('should wrap function call with _sz()', () => {
            const source = 'const el = <div sz={getStyles()} />;';
            const result = transformSource(source);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(true);
            expect(result.code).toContain('_sz(getStyles())');
        });
    });

    describe('files without sz', () => {
        it('should skip files without sz keyword', () => {
            const source = 'const el = <div className="p-4" />;';
            const result = transformSource(source);
            expect(result.transformed).toBe(false);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toBe(source);
        });

        it('should skip plain JS files', () => {
            const source = 'export const config = { key: "value" };';
            const result = transformSource(source);
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
            const result = transformSource(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('text-lg');
        });

        it('should handle sz with empty object', () => {
            const source = 'const el = <div sz={{}} />;';
            const result = transformSource(source);
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
    it.each([
        [
            'a static prefix',
            'className:`flex items-center ${isRow?"flex-row":"flex-col"}`',
            'className:`z h ${isRow?"a":"b"}`',
        ],
        [
            'multiple quasi segments',
            'className:`flex ${c1?"flex-row":"flex-col"} items-center ${c2?"scale-75":"scale-100"}`',
            'className:`z ${c1?"a":"b"} h ${c2?"i":"j"}`',
        ],
        [
            'an unknown quasi class',
            'className:`unknown-class ${cond?"flex-row":"flex-col"}`',
            'className:`unknown-class ${cond?"a":"b"}`',
        ],
        [
            'a non-className template',
            'const x = `flex items-center ${a?"flex-row":"flex-col"}`;',
            'const x = `flex items-center ${a?"flex-row":"flex-col"}`;',
        ],
        [
            'a trailing quasi',
            'className:`${cond?"flex-row":"flex-col"} flex items-center`',
            'className:`${cond?"a":"b"} z h`',
        ],
        [
            'an unminified className separator',
            'className: `flex items-center ${isRow?"flex-row":"flex-col"}`',
            'className:`z h ${isRow?"a":"b"}`',
        ],
        [
            'a chained interpolation ternary',
            'className:`flex ${s==="sm"?"rounded-xl":s==="md"?"rounded-full":"p-4"} items-center`',
            'className:`z ${s==="sm"?"d":s==="md"?"e":"c"} h`',
        ],
    ])('mangles %s', (_label, code, expected) => {
        expect(mangleCodeClassesSync(code, TEST_MANGLE)).toBe(expected);
    });
});

describe('mangleCodeClassesSync — Pass 2 (ternary className expressions)', () => {
    it.each([
        ['a simple ternary', 'className:cond?"flex":"items-center"', 'className:cond?"z":"h"'],
        ['a non-ternary expression', 'className:someVar', 'className:someVar'],
        [
            'a call with a static prefix',
            'className:r("flex",cond?"p-4":"rounded-xl")',
            'className:r("z",cond?"c":"d")',
        ],
        [
            'a multi-argument call',
            'className:r("flex",pe&&"p-4",cond?"rounded-xl":"rounded-full")',
            'className:r("z",pe&&"c",cond?"d":"e")',
        ],
        [
            'a ternary-only call',
            'className:r(cond?"p-4":"rounded-xl")',
            'className:r(cond?"c":"d")',
        ],
        [
            'a chained direct ternary',
            'className:s==="sm"?"p-4":s==="md"?"rounded-xl":"rounded-full"',
            'className:s==="sm"?"c":s==="md"?"d":"e"',
        ],
        [
            'multiple className blocks',
            '{className:isA?"flex":"items-center"},{className:isRow?"flex-row":"flex-col"}',
            '{className:isA?"z":"h"},{className:isRow?"a":"b"}',
        ],
        [
            'an adjacent object property',
            '{className:cond?"flex":"items-center",id:"flex-guide"}',
            '{className:cond?"z":"h",id:"flex-guide"}',
        ],
        [
            'a non-class condition operand',
            'className:variant==="primary"?"bg-violet-500 p-4":"flex items-center"',
            'className:variant==="primary"?"g c":"z h"',
        ],
    ])('mangles %s', (_label, code, expected) => {
        expect(mangleCodeClassesSync(code, TEST_MANGLE)).toBe(expected);
    });
});

describe('mangleCodeClassesSync — Pass 2.5 (quoted class-attribute arguments)', () => {
    it.each([
        [
            'Solid SSR attributes',
            'ssrAttribute("class", props.tone === "warn" ? "flex items-center" : "p-4 rounded-xl", false)',
            'ssrAttribute("class", props.tone === "warn" ? "z h" : "c d", false)',
        ],
        [
            'Solid client properties',
            'l(e,"className",r.tone==="warn"?"flex items-center":"p-4 rounded-xl")',
            'l(e,"className",r.tone==="warn"?"z h":"c d")',
        ],
        [
            'a colliding condition operand',
            'ssrAttribute("class", kind === "flex" ? "p-4" : "rounded-xl", false)',
            'ssrAttribute("class", kind === "z" ? "c" : "d", false)',
        ],
        [
            'a quoted object key',
            '{"className": cond?"flex":"p-4"}',
            '{"className": cond?"flex":"p-4"}',
        ],
        [
            'a non-ternary argument',
            'ssrAttribute("class", someVar, false)',
            'ssrAttribute("class", someVar, false)',
        ],
        [
            'multiple SSR attributes',
            'ssrAttribute("class", a ? "flex" : "p-4", false) + ssrAttribute("class", b ? "items-center" : "rounded-xl", false)',
            'ssrAttribute("class", a ? "z" : "c", false) + ssrAttribute("class", b ? "h" : "d", false)',
        ],
    ])('mangles %s', (_label, code, expected) => {
        expect(mangleCodeClassesSync(code, TEST_MANGLE)).toBe(expected);
    });
});

describe('mangleCodeClassesSync — Pass 3 (runtime helper string args)', () => {
    it.each([
        ['a leading argument', '_szMerge("flex items-center","p-4")', '_szMerge("z h","c")'],
        ['a conditional argument', '_szMerge("flex",pe&&"p-4")', '_szMerge("z",pe&&"c")'],
        [
            'a minified conditional string',
            '_szMerge("flex items-center",pe&&"p-4 rounded-xl")',
            '_szMerge("z h",pe&&"c d")',
        ],
        [
            'an unminified conditional string',
            '_szMerge("flex items-center", pe && "p-4 rounded-xl")',
            '_szMerge("z h", pe && "c d")',
        ],
        [
            'an unknown conditional string',
            '_szMerge("flex",pe&&"unknown-class")',
            '_szMerge("z",pe&&"unknown-class")',
        ],
    ])('mangles %s', (_label, code, expected) => {
        expect(mangleCodeClassesSync(code, TEST_MANGLE)).toBe(expected);
    });
});

describe('mangleCodeClassesSync — real-world integration (multi-pass)', () => {
    it.each([
        [
            'a minified Button',
            'className:_szMerge("flex items-center rounded-full",variant==="primary"&&"bg-violet-500",size==="lg"?"scale-100":"scale-75")',
            'className:_szMerge("z h e",variant==="primary"&&"g",size==="lg"?"j":"i")',
            false,
        ],
        [
            'an SSR Button',
            'className: _szMerge("flex items-center rounded-full", variant === "primary" && "bg-violet-500", size === "lg" ? "scale-100" : "scale-75")',
            'className: _szMerge("z h e", variant === "primary" && "g", size === "lg" ? "j" : "i")',
            false,
        ],
        [
            'an all-ternary Avatar',
            'className:_szMerge(isRow?"flex-row":"flex-col",isBig?"size-24":"p-4")',
            'className:_szMerge(isRow?"a":"b",isBig?"f":"c")',
            false,
        ],
        [
            'a four-argument Modal',
            'className:_szMerge("flex items-center",open&&"p-4",active&&"rounded-xl",full?"rounded-full":"scale-75")',
            'className:_szMerge("z h",open&&"c",active&&"d",full?"e":"i")',
            false,
        ],
        [
            'minified sibling elements',
            'n.createElement("div",{className:isA?"flex":"items-center"},n.createElement("span",{className:isRow?"flex-row":"flex-col"}))',
            'n.createElement("div",{className:isA?"z":"h"},n.createElement("span",{className:isRow?"a":"b"}))',
            false,
        ],
        [
            'an idempotent multi-pass expression',
            'className:_szMerge("flex items-center",pe&&"p-4",cond?"rounded-xl":"rounded-full")',
            'className:_szMerge("z h",pe&&"c",cond?"d":"e")',
            true,
        ],
    ])('mangles %s', (_label, code, expected, verifyIdempotency) => {
        const result = mangleCodeClassesSync(code, TEST_MANGLE);
        expect(result).toBe(expected);
        if (verifyIdempotency) expect(mangleCodeClassesSync(result, TEST_MANGLE)).toBe(result);
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

describe('mangleCodeClassesSync — Pass 4 (compiled szsc slot maps)', () => {
    it('mangles each quoted value of a bundled szsc slot map per-token', () => {
        expect(
            mangleCodeClassesSync(
                'jsx(Card,{szsc:{header:"flex items-center",icon:"p-4"},x:1})',
                TEST_MANGLE,
            ),
        ).toBe('jsx(Card,{szsc:{header:"z h",icon:"c"},x:1})');
    });

    it('keeps unknown tokens and stays idempotent', () => {
        const once = mangleCodeClassesSync('szsc:{a:"flex custom-thing"}', TEST_MANGLE);
        expect(once).toBe('szsc:{a:"z custom-thing"}');
        expect(mangleCodeClassesSync(once, TEST_MANGLE)).toBe(once);
    });

    it('handles single-quoted values and spaced maps', () => {
        expect(mangleCodeClassesSync("szsc: { header: 'flex-row p-4' }", TEST_MANGLE)).toBe(
            "szsc: { header: 'a c' }",
        );
    });

    it('does not touch look-alike keys, including the raw authoring prop', () => {
        // `szs:` maps only exist pre-compile (the build rewrites them to
        // `szsc:`); a bundle-level `szs:` key is user data, never mangled.
        for (const input of ['foo({szsomething:{a:"flex"}})', 'foo({szs:{a:"flex"}})']) {
            expect(mangleCodeClassesSync(input, TEST_MANGLE)).toBe(input);
        }
    });
});
