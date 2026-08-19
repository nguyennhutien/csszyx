/**
 * The wrapper trap: `className` and `sz` on one element, precedence unstated.
 *
 * When an element carries both, the compiler fuses them as
 * `_szMerge(className, sz)` — sz last, so sz wins per conflicting utility, and
 * JSX attribute order does not change that. For a wrapper that forwards a
 * consumer's `className`, this inverts what the author expects: a consumer
 * writes `sz={{ my: 0 }}` on the component, that demotes to `className`, and
 * the wrapper's own defaults then delete it. Everything stays green — the class
 * is safelisted, the CSS ships, tsc is happy — and only the render is wrong.
 *
 * The compiler cannot know whether the two conflict: `props.className` is a
 * runtime value. So this reports the SHAPE, not a proven conflict, which is why
 * it is advisory rather than a build warning.
 *
 * What makes it fair to report a shape is that the fix is strictly better. The
 * sz array states the precedence, safelists identically, and lowers through one
 * memoised `szcn` instead of an un-memoised `_szMerge` over a memoised `szcn`.
 * Measured on the runtime: 4.2 ms vs 372.7 ms for 200k merges with a warm
 * cache, 100.8 ms vs 137.1 ms with the cache defeated.
 *
 * And it stops on its own. Both intents are spellable as an array — defaults
 * first for consumer-wins, className first for defaults-win — and either
 * rewrite removes the `className` attribute, so the trigger is gone. No
 * suppression flag exists because none is needed.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES } from './engine-parity-harness.js';

const PREAMBLE = "import { szcn } from 'csszyx';\n";

/**
 * Compile one element and return its precedence advisories.
 *
 * @param engine - Engine entry under test.
 * @param element - The JSX element source.
 * @returns Diagnostics mentioning the precedence advisory.
 */
function advisories(
    engine: (source: string, filename?: string) => { diagnostics?: string[] },
    element: string,
): string[] {
    const source = `${PREAMBLE}export const W = ({ className }) => ${element};`;
    return (engine(source, '/p/W.tsx').diagnostics ?? [])
        .map(String)
        .filter(message => message.includes('takes precedence over'));
}

describe.each(ENGINES)('className and sz on one element (%s)', (_name, engine) => {
    it('reports a forwarded className, naming both rewrites', () => {
        const messages = advisories(engine, '<div className={className} sz={{ my: 2 }} />');

        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain('/p/W.tsx:2');
        // Both intents, because the compiler cannot know which one is meant.
        expect(messages[0]).toContain('sz={[{ … }, className]}');
        expect(messages[0]).toContain('sz={[className, { … }]}');
    });

    it('reports it through szcn too, which states no precedence either', () => {
        expect(
            advisories(engine, '<div className={szcn(className)} sz={{ my: 2 }} />'),
        ).toHaveLength(1);
    });

    it('reports it on a component, where the demotion makes the trap', () => {
        expect(
            advisories(engine, '<Row className={szcn(className)} sz={{ my: 2 }} />'),
        ).toHaveLength(1);
    });

    it('reports it whichever order the attributes are written', () => {
        // Attribute order does not change the emitted precedence, so it must
        // not change the report either — otherwise the advisory would teach an
        // ordering rule the compiler does not honour.
        const first = advisories(engine, '<div className={className} sz={{ my: 2 }} />');
        const second = advisories(engine, '<div sz={{ my: 2 }} className={className} />');
        expect(second).toEqual(first);
    });

    it('stays silent once the precedence is stated — consumer wins', () => {
        expect(advisories(engine, '<div sz={[{ my: 2 }, className]} />')).toEqual([]);
    });

    it('stays silent once the precedence is stated — defaults win', () => {
        expect(advisories(engine, '<div sz={[className, { my: 2 }]} />')).toEqual([]);
    });

    it('stays silent for a literal className, which states its own order', () => {
        // A literal is written right there beside the sz, so the author can see
        // both and there is nothing forwarded to be surprised by.
        expect(advisories(engine, '<div className="p-0" sz={{ my: 2 }} />')).toEqual([]);
    });

    it('stays silent for sz alone', () => {
        expect(advisories(engine, '<div sz={{ my: 2 }} />')).toEqual([]);
    });

    it('stays silent for className alone', () => {
        expect(advisories(engine, '<div className={className} />')).toEqual([]);
    });
});
