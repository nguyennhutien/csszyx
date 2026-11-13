/**
 * The bundle pass of ADR 0034: each `__szCss("…")` call the compiler marked is
 * replaced by its string, renamed through the map; nothing else in the chunk
 * moves. The shapes below are what Vite and webpack hand the pass before any
 * minifier, as measured on a real build.
 */
import { __szCss, clearMangleRegistry, installMangleRuntime } from '@csszyx/runtime';
import { afterEach, describe, expect, it } from 'vitest';

import { collectUnmarkedNames, inlineClassMarks } from '../src/class-mark-inline.js';

const MAP = { 'p-4': 'a', flex: 'b', 'hover:m-2': 'c' };

afterEach(() => clearMangleRegistry());

describe('inlineClassMarks', () => {
    it.each([
        ['an ESM import', '/*#__PURE__*/ __szCss("p-4 flex")'],
        [
            'an import renamed apart from a local of the same name',
            '/*#__PURE__*/__szCss$1("p-4 flex")',
        ],
        ['a namespace call', '/*#__PURE__*/ (0, import_dist.__szCss)("p-4 flex")'],
        [
            'a webpack namespace call',
            '/*#__PURE__*/(0,_csszyx_runtime__WEBPACK_IMPORTED_MODULE_0__.__szCss)("p-4 flex")',
        ],
        ['a member call', '/*#__PURE__*/ runtime.__szCss( "p-4 flex" )'],
        // webpack production shortens the export name of a module it does not
        // concatenate, and writes the original after it as a comment.
        [
            'a webpack call through a shortened export',
            '/*#__PURE__*/(0,_rt_index_js__WEBPACK_IMPORTED_MODULE_0__/* .__szCss */ .$t)("p-4 flex")',
        ],
        [
            'a shortened export with no dot in the comment',
            '/*#__PURE__*/(0,fake_rt/* __szCss */.$)("p-4 flex")',
        ],
        [
            'a shortened export called as a member',
            '/*#__PURE__*/x__WEBPACK_IMPORTED_MODULE_0__/* .__szCss */ .$("p-4 flex")',
        ],
        ['a single-quoted argument', "/*#__PURE__*/ __szCss('p-4 flex')"],
    ])('replaces the call from %s with the renamed string', (_shape, call) => {
        expect(inlineClassMarks(`x = ${call};`, MAP)).toEqual({
            code: 'x = "a b";',
            inlined: 1,
            missed: 0,
        });
    });

    it('keeps a class the map does not hold, and the spacing a browser reads', () => {
        const { code } = inlineClassMarks('/*#__PURE__*/__szCss("p-4\\tcustom  hover:m-2")', MAP);
        expect(code).toBe('"a custom c"');
    });

    it('leaves a class holding a no-break space whole, as the DOM reads it', () => {
        const { code } = inlineClassMarks('/*#__PURE__*/__szCss("p-4\\u00a0flex")', MAP);
        expect(code).toBe('"p-4 flex"');
    });

    it('reads escapes in the argument as JavaScript does', () => {
        const { code } = inlineClassMarks(
            String.raw`/*#__PURE__*/__szCss("before:content-['\"\"'] p-4")`,
            { ...MAP, 'before:content-[\'""\']': 'd' },
        );
        expect(code).toBe('"d a"');
    });

    it.each([
        ['a hex escape', String.raw`/*#__PURE__*/__szCss("p\x2d4")`, '"a"'],
        ['a code-point escape', String.raw`/*#__PURE__*/__szCss("p-4 \u{66}lex")`, '"a b"'],
        [
            'a code point with leading zeros',
            String.raw`/*#__PURE__*/__szCss("\u{0000070}-4")`,
            '"a"',
        ],
        ['a null escape', String.raw`/*#__PURE__*/__szCss("p-4\0")`, '"p-4\\u0000"'],
        [
            'an astral code point',
            String.raw`/*#__PURE__*/__szCss("\u{1F600} p-4")`,
            '"\u{1F600} a"',
        ],
    ])('reads %s as JavaScript does', (_case, call, expected) => {
        expect(inlineClassMarks(call, MAP).code).toBe(expected);
    });

    it.each([
        ['a code point past Unicode', String.raw`/*#__PURE__*/__szCss("\u{110000}")`],
        ['an unclosed code point', String.raw`/*#__PURE__*/__szCss("\u{66")`],
        ['a short hex escape', String.raw`/*#__PURE__*/__szCss("\x4")`],
        ['a short unicode escape', String.raw`/*#__PURE__*/__szCss("\u66")`],
        ['a legacy octal escape', String.raw`/*#__PURE__*/__szCss("\01")`],
        ['a numeric escape', String.raw`/*#__PURE__*/__szCss("\1")`],
        ['a carriage return', '/*#__PURE__*/__szCss("p-4\rflex")'],
    ])('leaves %s to the runtime', (_case, call) => {
        expect(inlineClassMarks(call, MAP)).toEqual({ code: call, inlined: 0, missed: 1 });
    });

    it('never reads a name off the object prototype', () => {
        const { code } = inlineClassMarks('/*#__PURE__*/__szCss("constructor toString")', MAP);
        expect(code).toBe('"constructor toString"');
    });

    it('inlines the call with an empty map, so no call reaches the browser', () => {
        expect(inlineClassMarks('a(/*#__PURE__*/__szCss("p-4"))', {})).toEqual({
            code: 'a("p-4")',
            inlined: 1,
            missed: 0,
        });
    });

    it('fills a template placeholder with the string', () => {
        const { code } = inlineClassMarks('`${/*#__PURE__*/__szCss("p-4")} ${x}`', MAP);
        expect(code).toBe('`${"a"} ${x}`');
    });

    it.each([
        // A transformer between the compiler and the bundle can drop the
        // annotation (SWC did, first in a JSX container): such a call is left
        // to the runtime, and reported, never renamed on a guess.
        ['an unannotated call', 'x = __szCss("p-4")'],
        ['an unannotated call that opens the chunk', '__szCss("p-4")'],
        ['a local function of the same name', 'const __szCss = s => s; __szCss("p-4")'],
        ['an unannotated renamed import', 'x = __szCss$1("p-4")'],
    ])('counts %s as missed and leaves it', (_case, code) => {
        expect(inlineClassMarks(code, MAP)).toEqual({ code, inlined: 0, missed: 1 });
    });

    it('does not count the helper declared, exported or named in text', () => {
        const code =
            'function __szCss(classes) { return classes; } exports.__szCss = __szCss; t("calls to `__szCss`")';
        expect(inlineClassMarks(code, MAP)).toEqual({ code, inlined: 0, missed: 0 });
    });

    it.each([
        [
            'an annotation on the call around a mark',
            'f(/*#__PURE__*/ g(/*#__PURE__*/__szCss("p-4")))',
            'f(/*#__PURE__*/ g("a"))',
        ],
        [
            'an annotation on a JSX call holding a mark',
            '/*#__PURE__*/jsx("div",{className:/*#__PURE__*/__szCss("p-4")})',
            '/*#__PURE__*/jsx("div",{className:"a"})',
        ],
        [
            'an annotation on a call with the name in a string',
            '/*#__PURE__*/f({"data-x":"__szCss"})',
            '/*#__PURE__*/f({"data-x":"__szCss"})',
        ],
    ])('counts nothing missed for %s', (_case, code, out) => {
        const result = inlineClassMarks(code, MAP);
        expect(result.code).toBe(out);
        expect(result.missed).toBe(0);
    });

    it.each([
        ['a string that only mentions the helper', 'f("__szCss(p-4)")'],
        ['a data string', 'el.style.setProperty("display","flex"); t("p-4")'],
        ['another annotated call', '/*#__PURE__*/ makeThing("p-4")'],
        ['a receiver call of another function', '/*#__PURE__*/(0, foo)("p-4")'],
        ['a callee that only ends in the name', '/*#__PURE__*/ my__szCss("p-4")'],
    ])('leaves %s as written', (_case, code) => {
        expect(inlineClassMarks(code, MAP)).toEqual({ code, inlined: 0, missed: 0 });
    });

    it.each([
        ['an argument that is not a literal', '/*#__PURE__*/__szCss(cls)'],
        ['a template argument', '/*#__PURE__*/__szCss(`p-4`)'],
        ['a second argument', '/*#__PURE__*/__szCss("p-4", x)'],
        ['an unterminated string', '/*#__PURE__*/__szCss("p-4'],
        ['a line continuation', '/*#__PURE__*/__szCss("p-4\\\nflex")'],
        ['a callee shape the pass does not know', '/*#__PURE__*/ Object(rt.__szCss)("p-4")'],
        ['an unknown callee with no string after it', '/*#__PURE__*/ Object(rt.__szCss)(cls)'],
        ['a receiver call left open', '/*#__PURE__*/(0,rt.__szCss("p-4")'],
        ['a null escape at the end of an open string', String.raw`/*#__PURE__*/__szCss("p-4\0`],
    ])('counts %s as missed and leaves the call to the runtime', (_case, code) => {
        expect(inlineClassMarks(code, MAP)).toEqual({ code, inlined: 0, missed: 1 });
    });

    it('gives the string the runtime helper returns for the same map', () => {
        // The inlined string and a missed call that runs must agree, or a page
        // would differ by whether the pass found the call.
        installMangleRuntime({ mangleMap: MAP, checksum: 'inline' });
        const inputs = ['p-4', 'p-4 flex', ' flex  p-4\n', 'custom hover:m-2', '', 'p-4 flex'];
        for (const input of inputs) {
            const { code } = inlineClassMarks(
                `/*#__PURE__*/__szCss(${JSON.stringify(input)})`,
                MAP,
            );
            expect(JSON.parse(code)).toBe(__szCss(input));
        }
    });

    it('agrees with the runtime on any class string, and moves no byte around the call', () => {
        // Seeded so a failure reproduces; the alphabet mixes the separators a
        // browser splits on, ones it does not (NBSP, BOM, U+2028), map keys,
        // quotes and backslashes, which the literal has to escape.
        let seed = 0x5eed;
        const next = (): number => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const pieces = [
            'p-4',
            'flex',
            'hover:m-2',
            'x',
            ' ',
            '\t',
            '\n',
            '\u00a0',
            '\ufeff',
            '\u2028',
            '"',
            "'",
            '\\',
            'é',
            '`',
        ];
        installMangleRuntime({ mangleMap: MAP, checksum: 'property' });
        for (let run = 0; run < 2000; run++) {
            let input = '';
            for (let length = Math.floor(next() * 8); length > 0; length--) {
                input += pieces[Math.floor(next() * pieces.length)];
            }
            const before = `f(${JSON.stringify(input)}, `;
            const after = `, "p-4");`;
            const { code, inlined } = inlineClassMarks(
                `${before}/*#__PURE__*/__szCss(${JSON.stringify(input)})${after}`,
                MAP,
            );
            expect(inlined, JSON.stringify(input)).toBe(1);
            expect(code.startsWith(before) && code.endsWith(after)).toBe(true);
            const inner = code.slice(before.length, code.length - after.length);
            expect(JSON.parse(inner), JSON.stringify(input)).toBe(__szCss(input));
        }
    });

    it('scans long runs of spaces and many helper names in linear time', () => {
        const chunk = `${' '.repeat(2_000_000)}${'x(__szCss); '.repeat(100_000)}`;
        const started = performance.now();
        expect(inlineClassMarks(chunk, MAP).missed).toBe(0);
        expect(performance.now() - started).toBeLessThan(1000);
    });

    it('scans a chunk of many annotations in linear time', () => {
        const chunk = '/*#__PURE__*/ new Map();'.repeat(200_000);
        const started = performance.now();
        expect(inlineClassMarks(chunk, MAP).inlined).toBe(0);
        expect(performance.now() - started).toBeLessThan(1000);
    });
});

describe('collectUnmarkedNames', () => {
    // A name the compiler did not mark may reach a class at runtime through a
    // variable, a `clsx` key or a vendor helper, and the chunk pass leaves it
    // as written; the census reads every such name so the map never renames
    // one, and its CSS keeps the name the code still uses (ADR 0034).
    const names = (code: string) => collectUnmarkedNames(code);

    it.each([
        [
            'a string handed to a helper',
            "clsx('btn__content relative inline-flex', on && 'p-4')",
            ['relative', 'inline-flex', 'p-4'],
        ],
        ['a variable', 'const base = "relative inline-flex";', ['relative', 'inline-flex']],
        ['an object key', 'clsx({ flex: on, "p-4": x, hidden })', ['flex', 'p-4', 'hidden']],
        ['an array element', '["p-4","flex"].includes(v)', ['p-4', 'flex']],
        ['a template quasi', 'cn(`p-4 ${x} hover:m-2`)', ['p-4', 'hover:m-2']],
        [
            'an arbitrary value',
            '"grid-cols-[repeat(2,1fr)] p-4"',
            ['grid-cols-[repeat(2,1fr)]', 'p-4'],
        ],
        ['an escaped quote', String.raw`"before:content-['\"\"']"`, [`before:content-['""']`]],
        ['a string joined by a no-break space', '"m-3\u00a0x"', ['m-3', 'x', 'm-3\u00a0x']],
        ['a data string', 'el.style.setProperty("display","flex")', ['flex']],
    ])('reads %s', (_case, code, expected) => {
        const found = names(code);
        for (const name of expected) expect(found.has(name), name).toBe(true);
    });

    it('reads a template whose text holds an escape, and one left open', () => {
        expect(names('cn(`p-4\\nhover:m-2`)').has('hover:m-2')).toBe(true);
        expect(names('cn(`x \\` p-4').has('p-4')).toBe(true);
        // A string left open still has its runs read.
        expect(names('const c = "p-4 flex').has('flex')).toBe(true);
        // A line continuation, and a placeholder holding braces of its own.
        expect(names('cn(`a\\\nb p-4`)').has('p-4')).toBe(true);
        expect(names('cn(`${f({ a: 1 })} hover:m-2`)').has('hover:m-2')).toBe(true);
    });

    it('does not read the classes inside a mark', () => {
        const found = names('a(/*#__PURE__*/__szCss("p-4 flex"), "m-2")');
        expect(found.has('p-4')).toBe(false);
        expect(found.has('flex')).toBe(false);
        expect(found.has('m-2')).toBe(true);
    });

    it('reads the classes of a mark it cannot inline, which run as written', () => {
        expect(names('/*#__PURE__*/__szCss(cls + " p-4")').has('p-4')).toBe(true);
    });
});
