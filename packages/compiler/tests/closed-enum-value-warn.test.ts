/**
 * A value outside a closed enum is refused, on every engine artifact.
 *
 * `display`, `position`, `visibility` and `isolation` carry their value as the
 * bare Tailwind utility, so an unrecognised one used to be emitted verbatim:
 * `{ display: 'bogus' }` shipped the class `bogus`. That is worse than a dead
 * class — a single unprefixed word is what a project's own component CSS is
 * made of, so the typo can MATCH a rule, just not the intended one. Field
 * report: a hybrid Tailwind + SCSS app whose stylesheets define `.card`,
 * `.active` and friends.
 *
 * These four keys have closed value sets, so the typo is decidable at compile
 * time. The class is dropped and a diagnostic names the legal values.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES, type ParityEngine } from './engine-parity-harness.js';

/** One key under test: a value outside its enum, and one inside with its class. */
interface EnumCase {
    key: string;
    bad: string;
    good: string;
    emits: string;
}

const CLOSED_ENUM_KEYS: readonly EnumCase[] = [
    { key: 'display', bad: 'bogus', good: 'flex', emits: 'flex' },
    { key: 'position', bad: 'bogus', good: 'absolute', emits: 'absolute' },
    { key: 'visibility', bad: 'bogus', good: 'hidden', emits: 'invisible' },
    { key: 'isolation', bad: 'bogus', good: 'isolate', emits: 'isolate' },
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
        '$lane drops an unrecognised $key value instead of emitting it bare',
        ({ engine, key, bad }) => {
            expect(run(engine, `{ ${key}: '${bad}' }`).emitted).toBe('');
        },
    );

    it.each(CASES)(
        '$lane names the offending $key value in a diagnostic',
        ({ engine, key, bad }) => {
            const { diagnostics } = run(engine, `{ ${key}: '${bad}' }`);
            const hit = diagnostics.find(message => message.includes(`"${key}: ${bad}"`));
            expect(hit, diagnostics.join('\n')).toBeDefined();
            expect(hit).toContain('nothing is emitted for it');
        },
    );

    it.each(CASES)('$lane still emits a recognised $key value', ({ engine, key, good, emits }) => {
        const { emitted, diagnostics } = run(engine, `{ ${key}: '${good}' }`);
        expect(emitted).toBe(emits);
        expect(diagnostics).toEqual([]);
    });
});
