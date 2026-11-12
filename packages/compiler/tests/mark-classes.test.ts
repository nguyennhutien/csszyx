/**
 * A build that mangles renames only the class strings the compiler marks
 * (ADR 0034): with `markClasses`, both engine artifacts wrap each class string
 * they emit in `__szCss(…)` and report the helper, byte for byte alike; without
 * it the output carries no call at all.
 */
import { describe, expect, it } from 'vitest';

import { transformRust } from '../src/transform-rust.js';
import { transformWasm } from '../src/transform-wasm.js';

const ENGINES = [
    ['native', transformRust],
    ['wasm', transformWasm],
] as const;

const SOURCE = [
    'export const A = ({ on, c }) => <>',
    '<div sz={{ p: 4 }} />',
    '<b className={c} sz={{ m: 2 }} />',
    '<i sz={{ borderB: on }} />',
    '<a sz={on ? { bg: "blue-500" } : { bg: "red-500" }} />',
    '</>;',
].join('\n');

describe.each(ENGINES)('markClasses (%s)', (_name, transform) => {
    it('wraps each emitted class string and reports the helper', () => {
        const result = transform(SOURCE, { filename: 'probe.tsx', markClasses: true });

        expect(result.code).toContain('className={(/*#__PURE__*/__szCss("p-4"))}');
        expect(result.code).toContain('_szMerge(c, /*#__PURE__*/__szCss("m-2"))');
        expect(result.code).toContain(
            '__szBoolClass(on, "borderB", /*#__PURE__*/__szCss("border-b"))',
        );
        expect(result.code).toContain(
            'on ? /*#__PURE__*/__szCss("bg-blue-500") : /*#__PURE__*/__szCss("bg-red-500")',
        );
        expect(result.usesClassMark).toBe(true);
    });

    it('emits no call when the build does not mangle', () => {
        const result = transform(SOURCE, { filename: 'probe.tsx' });

        expect(result.code).not.toContain('__szCss');
        expect(result.code).toContain('className="p-4"');
        expect(result.usesClassMark).toBe(false);
    });
});

describe('markClasses across artifacts', () => {
    it('gives the same marked code from native and wasm', () => {
        const options = { filename: 'probe.tsx', markClasses: true };
        expect(transformWasm(SOURCE, options).code).toBe(transformRust(SOURCE, options).code);
    });
});
