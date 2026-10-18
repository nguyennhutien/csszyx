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

import { ENGINES, type EngineParityResult, type ParityEngine } from './engine-parity-harness.js';

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
 * @returns The emitted className, the result's diagnostics and the issues beside them.
 */
function run(
    engine: ParityEngine,
    sz: string,
): { emitted: string; diagnostics: string[]; issues: NonNullable<EngineParityResult['issues']> } {
    const result = engine(`export const A = () => <div sz={${sz}} />;`, 'closed-enum.tsx');
    return {
        emitted: /className="([^"]*)"/.exec(result.code ?? '')?.[1] ?? '',
        diagnostics: result.diagnostics ?? [],
        issues: result.issues ?? [],
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
            const { diagnostics, issues } = run(engine, `{ ${key}: '${bad}' }`);
            expect(issues.map(issue => [issue.code, issue.args])).toEqual([
                ['closed-enum-value', expect.objectContaining({ key, value: bad })],
            ]);
            expect(diagnostics).toHaveLength(1);
            const [hit] = diagnostics;
            expect(hit).toContain(`\`${key}: ${bad}\` is not a \`${key}\` value.`);
            expect(hit).toContain(`the class \`${bare}\` is still emitted`);
            expect(hit).toContain('help: use one of: ');
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
            const { emitted, issues } = run(engine, `{ hover: { ${key}: '${bad}' } }`);
            expect(emitted).toBe(`hover:${bare}`);
            expect(
                issues.some(
                    issue =>
                        issue.code === 'closed-enum-value' &&
                        (issue.args as { key?: string; value?: string }).key === key &&
                        (issue.args as { key?: string; value?: string }).value === bad,
                ),
            ).toBe(true);
        },
    );
});

/**
 * The values the runtime lane names that no closed-enum table holds: a CSS
 * longhand on an alignment key, which lowers to a dead class, and a font style
 * or smoothing Tailwind has no class for, which lowers to nothing. The build
 * ships what the runtime ships, and says so as the runtime does.
 */
describe('closed-enum values the runtime lane names', () => {
    const LANES = ENGINES.map(([lane, engine]) => ({ lane, engine }));

    it.each(LANES)('$lane names a CSS longhand on an alignment key', ({ engine }) => {
        const { emitted, diagnostics, issues } = run(engine, "{ justify: 'flex-start' }");
        expect(emitted).toBe('justify-flex-start');
        expect(issues.map(issue => [issue.code, issue.args])).toEqual([
            [
                'closed-enum-value',
                { form: 'css-value', key: 'justify', value: 'flex-start', suggestion: 'start' },
            ],
        ]);
        expect(diagnostics[0]).toContain(
            "`justify: 'flex-start'` is a CSS value, and `justify-flex-start` generates no CSS.",
        );
        expect(diagnostics[0]).toContain("help: use the short form: `{ justify: 'start' }`.");
    });

    it.each(LANES)('$lane names a font style Tailwind has no class for', ({ engine }) => {
        const { emitted, issues } = run(engine, "{ fontStyle: 'oblique', p: 4 }");
        expect(emitted).toBe('p-4');
        expect(issues.map(issue => [issue.code, issue.args])).toEqual([
            ['closed-enum-value', { form: 'font-style', key: 'fontStyle', value: 'oblique' }],
        ]);
    });

    it.each(LANES)('$lane names a font smoothing Tailwind has no class for', ({ engine }) => {
        const { emitted, issues } = run(engine, "{ hover: { fontSmoothing: 'auto' }, p: 4 }");
        expect(emitted).toBe('p-4');
        expect(issues.map(issue => [issue.code, issue.args])).toEqual([
            ['closed-enum-value', { form: 'font-smoothing', key: 'fontSmoothing', value: 'auto' }],
        ]);
    });

    it.each(LANES)('$lane stays quiet on the values with a class', ({ engine }) => {
        const { emitted, issues } = run(
            engine,
            "{ justify: 'start', fontStyle: 'italic', fontSmoothing: 'grayscale' }",
        );
        expect(emitted).toBe('justify-start italic antialiased');
        expect(issues).toEqual([]);
    });
});
