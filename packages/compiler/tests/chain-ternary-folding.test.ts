/**
 * A conditional whose else-branch is another conditional.
 *
 * `a ? X : Y` compiled; `a ? X : b ? Y : Z` fell back to the `_sz()` runtime,
 * because the IR modelled a conditional as one test with two flat class lists
 * and a chain needs exactly one of THREE branches to win. The classes were still
 * safelisted, so nothing was missing from the CSS — the cost was a runtime helper
 * call on an attribute the compiler had, in fact, read completely.
 *
 * A chain is a choice, not a join. Two independent conditionals in one object
 * both contribute; a chain contributes exactly one branch, and the tests after
 * the first must only be evaluated when every test before them was falsy. The
 * emitted form keeps JavaScript's own short-circuit rather than reconstructing
 * it: `a ? "X" : b ? "Y" : "Z"`.
 */
import { describe, expect, it } from 'vitest';

import { captureWarnings, ENGINES } from './engine-parity-harness.js';

/**
 * Compile one sz expression on one engine.
 *
 * @param engine - Engine entry under test.
 * @param expression - The sz attribute value, without the braces.
 * @returns The captured run.
 */
function compile(engine: (source: string, filename?: string) => unknown, expression: string) {
    return captureWarnings(
        engine as never,
        `export const A = ({ a, b, c }) => <div sz={${expression}} />;`,
        '/p/App.tsx',
    );
}

describe.each(ENGINES)('a chained conditional (%s)', (_name, engine) => {
    it('compiles instead of falling back', () => {
        const run = compile(engine, 'a ? { p: 1 } : b ? { p: 2 } : { p: 3 }');

        expect(run.warnings).toEqual([]);
        expect(run.result.code).not.toContain('_sz(');
    });

    it('emits the chain, so exactly one branch can win', () => {
        const run = compile(engine, 'a ? { p: 1 } : b ? { p: 2 } : { p: 3 }');

        expect(run.result.code).toContain('a ? "p-1" : b ? "p-2" : "p-3"');
    });

    it('keeps every branch in the safelist', () => {
        const run = compile(engine, 'a ? { p: 1 } : b ? { p: 2 } : { p: 3 }');

        expect([...(run.result.classes ?? [])]).toEqual(['p-1', 'p-2', 'p-3']);
    });

    it('folds a chain three deep', () => {
        const run = compile(engine, 'a ? { p: 1 } : b ? { p: 2 } : c ? { p: 3 } : { p: 4 }');

        expect(run.warnings).toEqual([]);
        expect([...(run.result.classes ?? [])]).toEqual(['p-1', 'p-2', 'p-3', 'p-4']);
    });

    it('treats a nothing tail like the empty style', () => {
        // `undefined` and `{}` both lower to no classes, which is what the
        // two-branch form already established.
        for (const tail of ['undefined', '{}']) {
            const run = compile(engine, `a ? { p: 1 } : b ? { p: 2 } : ${tail}`);
            expect(run.warnings, tail).toEqual([]);
            expect([...(run.result.classes ?? [])], tail).toEqual(['p-1', 'p-2']);
        }
    });

    it('lowers multi-key branches whole', () => {
        const run = compile(
            engine,
            "a ? { p: 1, bg: 'red-500' } : b ? { m: 2 } : { rounded: 'lg' }",
        );

        expect([...(run.result.classes ?? [])]).toEqual(['p-1', 'bg-red-500', 'm-2', 'rounded-lg']);
    });
});

describe.each(ENGINES)('what the chain must not change (%s)', (_name, engine) => {
    it('leaves the two-branch form byte-identical', () => {
        const run = compile(engine, 'a ? { p: 1 } : { p: 2 }');

        expect(run.result.code).toContain('a ? "p-1" : "p-2"');
    });

    it('leaves two independent conditionals joined, not chained', () => {
        // The distinction this suite exists for: these both contribute, and
        // folding them into a choice would drop one.
        const run = compile(engine, '{ p: a ? 1 : 2, m: b ? 3 : 4 }');
        const classes = [...(run.result.classes ?? [])];

        expect(classes).toContain('p-1');
        expect(classes).toContain('m-3');
    });

    it('still falls back when a branch is unreadable', () => {
        const run = compile(engine, 'a ? { p: 1 } : b ? someUnknownThing : { p: 3 }');

        expect(run.warnings.length).toBeGreaterThan(0);
    });
});
