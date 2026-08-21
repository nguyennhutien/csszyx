/**
 * A branch that styles nothing is a branch worth compiling.
 *
 * `sz={on ? { color: 'muted' } : {}}` folded to a class ternary, but writing
 * the same intent as `: undefined` — the spelling TypeScript pushes authors
 * toward, since `{}` widens badly against a typed style — dropped the whole
 * attribute onto `_sz(...)`: a helper call and an object allocation on every
 * render, for a value the compiler could name. `cond && { … }` failed the same
 * way.
 *
 * The two shapes fold for one reason: every falsy JS value lowers to the empty
 * class string, so an absent branch is the EMPTY style rather than an unknown
 * one. `||` is left alone deliberately — see the refusal below.
 *
 * Parity matters here beyond the emit. A fallback still collects its classes
 * into the safelist, so an engine that folded while the other fell back would
 * ship identical CSS and differ only in per-render cost — invisible to any
 * assertion that reads CSS alone. These read the emitted code.
 */
import { describe, expect, it } from 'vitest';

import { captureWarnings, ENGINES } from './engine-parity-harness.js';

/**
 * Wrap an sz attribute value in the smallest component that carries it.
 *
 * @param szValue - The expression to place inside `sz={…}`.
 * @returns A module declaring one component with that attribute.
 */
function component(szValue: string): string {
    return `export const A = ({ on, a, b, textAlign }) => <div sz={${szValue}} />;`;
}

describe.each(ENGINES)('a falsy ternary branch is the empty style (%s)', (_name, engine) => {
    // `false` is in this table because it is the spelling a `&&` chain collapses
    // to, and the array lane has skipped it as an element since before this
    // change; the three must fold identically or a `&&` reads differently.
    it.each(['undefined', 'null', 'false'])('folds a %s alternate', falsy => {
        const run = captureWarnings(engine, component(`on ? { color: 'muted' } : ${falsy}`));

        expect(run.result.code).toContain('className={on ? "text-muted" : undefined}');
    });

    it('folds a falsy consequent, which is the same question asked backwards', () => {
        const run = captureWarnings(engine, component("on ? undefined : { color: 'muted' }"));

        expect(run.result.code).toContain('className={on ? undefined : "text-muted"}');
    });

    it('keeps the class in the safelist, so Tailwind still emits its rule', () => {
        const run = captureWarnings(engine, component("on ? { color: 'muted' } : undefined"));

        expect([...(run.result.classes ?? [])]).toEqual(['text-muted']);
    });

    it('stops reporting a fallback for a shape it now compiles', () => {
        const run = captureWarnings(engine, component("on ? { color: 'muted' } : undefined"));

        expect(run.warnings).toEqual([]);
    });

    it.each([
        ["on ? { color: 'muted' } : ", 'a plain alternate'],
        ["on ? { color: 'muted', p: 4 } : ", 'a multi-class alternate'],
        ["a ? { color: 'muted' } : b ? { color: 'fg' } : ", 'a chained alternate'],
    ])('compiles %s the same whether it is spelled undefined or {}', prefix => {
        // The claim this change makes is equivalence, not folding: `undefined`
        // and `{}` say the same thing, so they must produce the same module.
        // The chained case is the one that holds the pair together — a chain
        // keeps the runtime path either way, because `StaticTernaryIr` carries
        // flat class lists and cannot express a second test. Asserting only the
        // shapes that fold would let a later chain-folding change quietly
        // reintroduce the split this test exists to forbid.
        // A fallback splices the authored bytes back, so the two modules differ
        // by the branch text itself; what must match is every decision the
        // compiler made about them.
        const verdict = (sz: string) => {
            const run = captureWarnings(engine, component(sz));
            return {
                compiled: !(run.result.code ?? '').includes('_sz('),
                classes: [...(run.result.classes ?? [])],
                warnings: run.warnings,
            };
        };

        expect(verdict(`${prefix}undefined`)).toEqual(verdict(`${prefix}{}`));
    });
});

describe.each(ENGINES)('a guarded style is a ternary with an empty arm (%s)', (_name, engine) => {
    it('folds `cond && { … }`', () => {
        const run = captureWarnings(engine, component("on && { color: 'muted' }"));

        expect(run.result.code).toContain('className={on ? "text-muted" : undefined}');
    });

    it('keeps the guarded class in the safelist', () => {
        const run = captureWarnings(engine, component("on && { color: 'muted' }"));

        expect([...(run.result.classes ?? [])]).toEqual(['text-muted']);
    });

    it('stops reporting a fallback for a guarded style', () => {
        const run = captureWarnings(engine, component("on && { color: 'muted' }"));

        expect(run.warnings).toEqual([]);
    });

    it('folds a guard the formatter has wrapped in parentheses', () => {
        const run = captureWarnings(engine, component("(on && { color: 'muted' })"));

        expect(run.result.code).toContain('className={on ? "text-muted" : undefined}');
    });

    it('folds a guard held by a const, the way a ternary already was', () => {
        const run = captureWarnings(
            engine,
            "const guarded = on && { color: 'muted' };\nexport const A = ({ on }) => <div sz={guarded} />;",
        );

        expect(run.result.code).toContain('className={on ? "text-muted" : undefined}');
    });

    it('carries the whole left side into the test when the guard is a chain', () => {
        // `a && b && obj` parses as `(a && b) && obj`, so the test is the left
        // subtree verbatim — taking only its rightmost operand would drop `a`
        // and style the element on the wrong condition.
        const run = captureWarnings(engine, component("a && b && { color: 'muted' }"));

        expect(run.result.code).toContain('className={a && b ? "text-muted" : undefined}');
    });
});

describe.each(ENGINES)('what a falsy arm still does not license (%s)', (_name, engine) => {
    it('refuses `cond || { … }`, whose other arm can itself be a style', () => {
        // `&&` folds because every value it can yield in place of the object is
        // falsy, and every falsy value lowers to no classes. `||` yields its
        // LEFT operand, which may be a style object — `base || { p: 4 }` must
        // still apply `base`. Folding it would silently drop that arm.
        const run = captureWarnings(engine, component("on || { color: 'muted' }"));

        expect(run.result.code).toContain('_sz(');
    });

    it('refuses a branch holding a value only the runtime knows', () => {
        // `text-(--_sz-text-align)` is `color: var(…)` in Tailwind v4, not an
        // alignment — so a fold here would not merely miss an optimization, it
        // would name a class that styles the wrong property.
        const run = captureWarnings(engine, component('textAlign ? { textAlign } : undefined'));

        expect(run.result.code).toContain('_sz(');
        expect(run.result.code).not.toContain('--_sz-text-align');
    });
});
