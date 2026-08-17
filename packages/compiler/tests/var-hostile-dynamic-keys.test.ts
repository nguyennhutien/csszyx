/**
 * A runtime value on a key Tailwind has no arbitrary-value form for.
 *
 * `sz={{ textAlign: align }}` compiled to `text-(--_sz-text-align)` plus a
 * style variable, and Tailwind reads `text-(--…)` as a COLOR — so the element
 * got `color: var(--_sz-text-align)` holding `"center"`, an invalid value that
 * unsets an inherited colour, and no alignment at all. Nothing reported it.
 *
 * The same lane produces the milder shape for keys with no `-(--var)` form
 * whatsoever — `display-(--_sz-display)` matches no Tailwind utility, so the
 * class reached the safelist, generated no rule, and styled nothing silently.
 *
 * Both are the csszyx→Tailwind→CSS contract failing, which is why the report
 * is a production diagnostic and not a dev nicety, and why the class and the
 * variable are dropped: 0.14.1 already learned that warning while still
 * emitting a dead class makes broken usage look like it works.
 *
 * The boundary this suite defends is the sibling key on the SAME prefix.
 * `color` and `textAlign` both lower to `text-*`, and only one of them has a
 * var form — a rule written against the prefix rather than the key would take
 * the working one down with the broken one.
 */
import { describe, expect, it } from 'vitest';

import { captureWarnings, ENGINES } from './tri-engine-harness.js';

/**
 * Compile one sz object on one engine.
 *
 * @param engine - Engine entry under test.
 * @param szObject - The object source, without the surrounding braces.
 * @returns The captured run.
 */
function compile(engine: (source: string, filename?: string) => unknown, szObject: string) {
    const source = `export const A = ({ v }) => <div sz={${szObject}} />;`;
    return captureWarnings(engine as never, source, '/p/App.tsx');
}

describe.each(ENGINES)('a runtime value Tailwind cannot read (%s)', (_name, engine) => {
    it('drops the class that would have styled the wrong property', () => {
        const run = compile(engine, '{ textAlign: v }');

        expect(run.result.code).not.toContain('--_sz-text-align');
        expect([...(run.result.classes ?? [])]).toEqual([]);
    });

    it('drops the class that would have matched no utility at all', () => {
        const run = compile(engine, '{ display: v }');

        expect(run.result.code).not.toContain('--_sz-display');
        expect([...(run.result.classes ?? [])]).toEqual([]);
    });

    it('names the key and the way out', () => {
        const run = compile(engine, '{ textAlign: v }');

        expect(run.warnings).toHaveLength(1);
        expect(run.warnings[0]).toContain('"textAlign"');
        expect(run.warnings[0]).toContain('App.tsx:1');
        expect(run.warnings[0]).toContain('szv()');
    });

    it('reports a key nested in a variant, which fails the same way', () => {
        const run = compile(engine, '{ hover: { textAlign: v } }');

        expect(run.result.code).not.toContain('--_sz-hover-text-align');
        expect(run.warnings).toHaveLength(1);
    });

    it('keeps the static siblings that were never in question', () => {
        const run = compile(engine, '{ p: 4, textAlign: v }');

        expect([...(run.result.classes ?? [])]).toEqual(['p-4']);
    });
});

describe.each(ENGINES)('what the same lane must keep doing (%s)', (_name, engine) => {
    it('leaves a static value on the same key untouched', () => {
        // Only the RUNTIME value is unrepresentable. A literal lowers to the
        // keyword utility and always has.
        const run = compile(engine, "{ textAlign: 'center' }");

        expect([...(run.result.classes ?? [])]).toEqual(['text-center']);
        expect(run.warnings).toEqual([]);
    });

    it('leaves a conditional with static branches untouched', () => {
        // The refusal sits AFTER the static and conditional lanes on purpose.
        // Moving it earlier — where the removed-key refusal lives — would drop
        // this, and both of its classes are perfectly compilable.
        const run = compile(engine, "{ textAlign: on ? 'left' : 'center' }");

        expect([...(run.result.classes ?? [])]).toEqual(['text-left', 'text-center']);
        expect(run.warnings).toEqual([]);
    });

    it('leaves a runtime colour on the very same `text-` prefix untouched', () => {
        // `text-(--v)` IS a colour in Tailwind v4, so this key is exactly the
        // one the utility supports. Keying the refusal off the prefix instead
        // of the key would break it.
        const run = compile(engine, '{ color: v }');

        expect([...(run.result.classes ?? [])]).toEqual(['text-(--_sz-color)']);
        expect(run.result.code).toContain('__szColorVar(v)');
        expect(run.warnings).toEqual([]);
    });

    it('leaves the spacing lane untouched', () => {
        const run = compile(engine, '{ p: v }');

        expect([...(run.result.classes ?? [])]).toEqual(['p-(--_sz-p)']);
        expect(run.warnings).toEqual([]);
    });
});
