/**
 * Branch-level edge cases for `mangleCodeClassesSync` and the szsc string-literal
 * mangler. These exercise the no-change short-circuits, whitespace-only quasis,
 * empty ternary strings, nested-brace interpolations, whitespace-only argument
 * strings, self-mapping tokens, and escaped / unterminated szsc string bodies —
 * the paths the happy-path mangle tests never reach.
 */
import { describe, expect, it } from 'vitest';

import { inlineClassMarks } from '../src/class-mark-inline.js';
import { mangleCodeClassesSync } from '../src/unplugin.js';

it('preserves a trailing escape in an unfinished szs string', () => {
    const source = 'const view = { szs: { root: "p-4' + '\\' + '} };';
    expect(mangleCodeClassesSync(source, new Map([['p-4', 'a']]))).toBe(source);
});

const MAP: Record<string, string> = {
    flex: 'z',
    'items-center': 'h',
    'p-4': 'c',
    'bg-red-500': 'g',
};

describe('mangleCodeClassesSync — no-change short circuits', () => {
    it('Pass 1 double-quoted: leaves an all-unknown className string untouched', () => {
        const code = 'className="totally-unknown another-unknown"';
        expect(mangleCodeClassesSync(code, MAP)).toBe(code);
    });

    it('Pass 1 single-quoted: leaves an all-unknown className string untouched', () => {
        const code = "className='totally-unknown another-unknown'";
        expect(mangleCodeClassesSync(code, MAP)).toBe(code);
    });

    it('Pass 3: leaves an argument string whose tokens all map to themselves', () => {
        // Self-mapping tokens are "known" (in the map) but produce no change,
        // so Pass 3 must return the original match rather than a rewrite.
        const identity = { 'p-4': 'p-4', flex: 'flex' };
        const code = '_szMerge("p-4 flex")';
        expect(mangleCodeClassesSync(code, identity)).toBe(code);
    });
});

describe('mangleCodeClassesSync — template literal (Pass 1.5) edges', () => {
    it.each([
        [
            'a whitespace-only trailing quasi',
            'className:`${cond?"flex":"p-4"}   `',
            'className:`${cond?"z":"c"}   `',
        ],
        [
            'a whitespace-only leading quasi',
            'className:`   ${cond?"flex":"p-4"}`',
            'className:`   ${cond?"z":"c"}`',
        ],
        [
            'nested interpolation braces',
            'className:`flex ${f({x:1})?"p-4":"items-center"}`',
            'className:`z ${f({x:1})?"c":"h"}`',
        ],
        [
            'an empty interpolation branch',
            'className:`flex ${cond?"":"p-4"}`',
            'className:`z ${cond?"":"c"}`',
        ],
    ])('preserves %s while mangling classes', (_label, code, expected) => {
        expect(mangleCodeClassesSync(code, MAP)).toBe(expected);
    });

    it('leaves an unterminated interpolation with no known classes unchanged', () => {
        const code = 'className:`unknown ${cond?"other":"fallback"`';
        expect(mangleCodeClassesSync(code, MAP)).toBe(code);
    });
});

describe('mangleCodeClassesSync — ternary (Pass 2) edges', () => {
    it('leaves an empty quoted branch string untouched', () => {
        const code = 'className:cond?"":"p-4"';
        const result = mangleCodeClassesSync(code, MAP);
        expect(result).toBe('className:cond?"":"c"');
    });
});

describe('mangleCodeClassesSync — Pass 2.5 (quoted attribute-name arg)', () => {
    it('skips a static string argument after a "class" attribute name', () => {
        // firstChar is a quote → Pass 2.5 defers to Pass 3, leaving this to the
        // argument heuristic; Pass 2.5 itself must not rewrite it.
        const code = 'ssrAttribute("class","p-4",false)';
        const result = mangleCodeClassesSync(code, MAP);
        // Pass 3 does mangle the static arg because all tokens are known.
        expect(result).toBe('ssrAttribute("class","c",false)');
    });

    it('mangles a ternary argument after a "className" attribute name', () => {
        const code = 'l(el,"className",cond?"flex":"p-4")';
        const result = mangleCodeClassesSync(code, MAP);
        expect(result).toBe('l(el,"className",cond?"z":"c")');
    });
});

describe('mangleCodeClassesSync — unmarked helper argument strings', () => {
    it('leaves a whitespace-only argument string untouched', () => {
        const code = '_szMerge("   ")';
        expect(mangleCodeClassesSync(code, MAP)).toBe(code);
    });

    it('skips an argument string containing any unknown token', () => {
        const code = '_szMerge("flex not-in-map")';
        // one unknown token → whole string skipped
        expect(mangleCodeClassesSync(code, MAP)).toBe(code);
    });
});

describe('mangleCodeClassesSync — Pass 4 (szsc slot maps)', () => {
    it('mangles quoted slot values in a szsc map', () => {
        const code = 'szsc:{ header: "flex items-center", body: "p-4" }';
        const result = mangleCodeClassesSync(code, MAP);
        expect(result).toBe('szsc:{ header: "z h", body: "c" }');
    });

    it('preserves an escaped quote inside a szsc slot value', () => {
        // The literal scanner must consume the backslash + escaped char as one
        // unit instead of treating the escaped quote as a terminator.
        const code = 'szsc:{ header: "flex \\" p-4" }';
        const result = mangleCodeClassesSync(code, MAP);
        // The whole inner text (including the escaped quote) is one literal;
        // known tokens flex/p-4 are mangled, the escape survives.
        expect(result).toContain('szsc:');
        expect(result).toContain('\\"');
        expect(result).toContain('z');
        expect(result).toContain('c');
    });

    it('leaves an unterminated string in a szsc body unchanged', () => {
        // The brace scanner stops at the first `}`, leaving an unterminated
        // quote in the captured body; the literal mangler emits the opening
        // quote and resumes rather than rewriting a broken literal.
        const code = 'szsc:{ header: "flex }';
        const result = mangleCodeClassesSync(code, MAP);
        expect(result).toBe(code);
    });
});

describe('mangleCodeClassesSync — strings the compiler did not mark (ADR 0034)', () => {
    // A `clsx` map or array the author wrote is not the compiler's: the chunk
    // pass cannot tell it from data, so it is left as written, and the census
    // keeps each name it holds out of the map, so its CSS keeps the name too.
    it.each([
        ['every key of an object literal', 'const c={"p-4":e,"flex":t,"bg-red-500":u};'],
        ['a key that is not a class', 'const o={"not-a-class":1,"p-4":2};'],
        ['every element of an array literal', 'clsx(["p-4","flex"])'],
        ['a braced string', 'if(x){"p-4"}'],
        ['a template placeholder', 'const s=`${"p-4"}`;'],
    ])('leaves %s as written', (_label, code) => {
        expect(mangleCodeClassesSync(code, MAP)).toBe(code);
    });
});

describe('mangleCodeClassesSync — a class holding a BOM', () => {
    // The engine keeps a BOM inside a class (it is not Unicode White_Space),
    // and a class list splits on ASCII whitespace, as the DOM splits it.
    const bom = 'content-[a﻿b]';
    const map = { [bom]: 'q', 'p-4': 'c' };

    it.each([
        [`className="${bom} p-4"`, 'className="q c"'],
        [`className: \`${bom} p-4\``, 'className:`q c`'],
        ['className: `p-4 ${on ? "' + bom + ' p-4" : ""}`', 'className:`c ${on ? "q c" : ""}`'],
        [`className: on ? "${bom} p-4" : "p-4"`, 'className: on ? "q c" : "c"'],
        [`_szMerge(/*#__PURE__*/__szCss("${bom} p-4"))`, '_szMerge("q c")'],
    ])('mangles %s whole', (code, mangled) => {
        expect(mangleCodeClassesSync(inlineClassMarks(code, map).code, map)).toBe(mangled);
    });
});
