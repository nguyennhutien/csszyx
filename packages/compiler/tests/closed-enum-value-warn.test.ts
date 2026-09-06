/**
 * A value outside a closed enum is reported, on every engine artifact — and
 * the class it always produced is still emitted.
 *
 * `display`, `position`, `visibility` and `isolation` carry their value as the
 * bare Tailwind utility, so an unrecognised one is emitted verbatim:
 * `{ display: 'bogus' }` ships the class `bogus`. That is worse than a dead
 * class — a single unprefixed word is what a project's own component CSS is
 * made of, so the typo can MATCH a rule, just not the intended one. Field
 * report: a hybrid Tailwind + SCSS app whose stylesheets define `.card`,
 * `.active` and friends. CSS closes all four value sets, so the typo is
 * decidable at compile time and the diagnostic names the legal values.
 *
 * The class is emitted on purpose. The static collectors that produce the
 * diagnostic do not descend into a conditional branch or a parametric variant
 * (`data: { open: … }`), so a lowering that dropped the class would lose it
 * silently exactly where the diagnostic cannot reach — the one failure shape
 * a diagnostic exists to prevent. Emitting keeps every case at worst where
 * it was before the diagnostic existed.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES, type ParityEngine } from './engine-parity-harness.js';

/** One key under test: a value outside its enum, the class it still emits, and one inside. */
interface EnumCase {
    key: string;
    bad: string;
    bare: string;
    good: string;
    emits: string;
}

const CLOSED_ENUM_KEYS: readonly EnumCase[] = [
    { key: 'display', bad: 'bogus', bare: 'bogus', good: 'flex', emits: 'flex' },
    { key: 'position', bad: 'bogus', bare: 'bogus', good: 'absolute', emits: 'absolute' },
    { key: 'visibility', bad: 'bogus', bare: 'bogus', good: 'hidden', emits: 'invisible' },
    { key: 'isolation', bad: 'bogus', bare: 'isolation-bogus', good: 'isolate', emits: 'isolate' },
];

/** Every (artifact, key) pair, named so a failure says which lane and which key. */
const CASES = ENGINES.flatMap(([lane, engine]) =>
    CLOSED_ENUM_KEYS.map(row => ({ lane, engine, ...row })),
);

/**
 * Emit one sz object through one engine artifact.
 *
 * @param engine - The artifact under test.
 * @param sz - The sz object source, as written in JSX.
 * @returns The emitted className and the result's diagnostics.
 */
function run(engine: ParityEngine, sz: string): { emitted: string; diagnostics: string[] } {
    const result = engine(`export const A = () => <div sz={${sz}} />;`, 'closed-enum.tsx');
    return {
        emitted: /className="([^"]*)"/.exec(result.code ?? '')?.[1] ?? '',
        diagnostics: result.diagnostics ?? [],
    };
}

describe('closed-enum values', () => {
    it.each(CASES)(
        '$lane still emits an unrecognised $key value the way it always did',
        ({ engine, key, bad, bare }) => {
            expect(run(engine, `{ ${key}: '${bad}' }`).emitted).toBe(bare);
        },
    );

    it.each(CASES)(
        '$lane names the offending $key value and the class it emitted',
        ({ engine, key, bad, bare }) => {
            const { diagnostics } = run(engine, `{ ${key}: '${bad}' }`);
            const hit = diagnostics.find(message => message.includes(`"${key}: ${bad}"`));
            expect(hit, diagnostics.join('\n')).toBeDefined();
            expect(hit).toContain(`The class "${bare}" is still emitted`);
            expect(hit).toContain(`${key} takes one of:`);
        },
    );

    it.each(CASES)('$lane still emits a recognised $key value', ({ engine, key, good, emits }) => {
        const { emitted, diagnostics } = run(engine, `{ ${key}: '${good}' }`);
        expect(emitted).toBe(emits);
        expect(diagnostics).toEqual([]);
    });

    // The important modifier belongs to the class, not to the value: `flex!`
    // is a legal display value with a legal suffix, and a table lookup on the
    // raw string would refuse it — and, on the engine lane, refuse a class it
    // had just emitted correctly.
    it.each(CASES)('$lane reads the important modifier on $key', ({ engine, key, good, emits }) => {
        const { emitted, diagnostics } = run(engine, `{ ${key}: '${good}!' }`);
        expect(emitted).toBe(`${emits}!`);
        expect(diagnostics).toEqual([]);
    });

    it.each(CASES)(
        '$lane reports an unrecognised $key value under a variant, and emits it',
        ({ engine, key, bad, bare }) => {
            const { emitted, diagnostics } = run(engine, `{ hover: { ${key}: '${bad}' } }`);
            expect(emitted).toBe(`hover:${bare}`);
            expect(diagnostics.some(message => message.includes(`"${key}: ${bad}"`))).toBe(true);
        },
    );
});
