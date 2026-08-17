/**
 * A border-style keyword on a per-SIDE border key.
 *
 * `borderB: 'none'` compiled to `border-b-none`, which Tailwind serves no rule
 * for — the element kept whatever border it had and nothing said so.
 *
 * It is a trap rather than a gap because the same concatenation on the root
 * prefix lands on a class that exists: `border: 'none'` reaches `border-none`.
 * Both come from the same place — a key maps to a Tailwind PREFIX and the value
 * is appended, with no notion of which values that key accepts — and they differ
 * only in whether the result happens to be a class Tailwind serves.
 *
 * This suite fixes the half that produces a dead class. The half that lands on a
 * sibling key's utility is a separate, open question about per-key value domains
 * and is deliberately not settled here.
 *
 * Asked of the pinned Tailwind, the whole family behaves the same way. All six
 * style keywords Tailwind spells at the root are dead on all ten side keys:
 *
 *     value    root  b  t  l  r  x  y  s  e  bs be
 *     solid    .     X  X  X  X  X  X  X  X  X  X
 *     dashed   .     X  X  X  X  X  X  X  X  X  X
 *     dotted   .     X  X  X  X  X  X  X  X  X  X
 *     double   .     X  X  X  X  X  X  X  X  X  X
 *     hidden   .     X  X  X  X  X  X  X  X  X  X
 *     none     .     X  X  X  X  X  X  X  X  X  X
 *
 * CSS has per-side border styles; Tailwind has no utility for them. So this is
 * not a value csszyx should lower differently — there is nothing to lower it
 * to, and the class has to go, like every other class this build cannot back
 * with CSS.
 *
 * The boundary that matters is the rest of the same keys: widths, colours and
 * theme tokens all resolve per side and must be untouched.
 */
import { describe, expect, it } from 'vitest';

import { captureWarnings, ENGINES } from './tri-engine-harness.js';

/** Every per-side border key, including the logical ones. */
const SIDE_KEYS = [
    'borderT',
    'borderR',
    'borderB',
    'borderL',
    'borderX',
    'borderY',
    'borderS',
    'borderE',
    'borderBs',
    'borderBe',
] as const;

/** The style keywords Tailwind spells at the root and nowhere else. */
const STYLE_VALUES = ['solid', 'dashed', 'dotted', 'double', 'hidden', 'none'] as const;

/**
 * Compile one sz object on one engine.
 *
 * @param engine - Engine entry under test.
 * @param szObject - The object source, without the surrounding braces.
 * @returns The captured run.
 */
function compile(engine: (source: string, filename?: string) => unknown, szObject: string) {
    return captureWarnings(
        engine as never,
        `export const A = () => <div sz={${szObject}} />;`,
        '/p/App.tsx',
    );
}

describe.each(ENGINES)('a style keyword on a side border key (%s)', (_name, engine) => {
    const pairs = SIDE_KEYS.flatMap(key => STYLE_VALUES.map(value => [key, value] as const));

    it.each(pairs)('drops the dead class for %s: %s', (key, value) => {
        const run = compile(engine, `{ ${key}: '${value}' }`);

        expect([...(run.result.classes ?? [])]).toEqual([]);
    });

    it('says which key, and what to write instead', () => {
        const run = compile(engine, "{ borderB: 'none' }");

        expect(run.warnings).toHaveLength(1);
        expect(run.warnings[0]).toContain('"borderB"');
        expect(run.warnings[0]).toContain('App.tsx:1');
        // Both ways out: the style for every side, or a width for this one.
        expect(run.warnings[0]).toContain('borderStyle');
    });
});

describe.each(ENGINES)('what the same keys must keep compiling (%s)', (_name, engine) => {
    it('lowers a width on every side', () => {
        for (const key of SIDE_KEYS) {
            const run = compile(engine, `{ ${key}: 2 }`);
            expect([...(run.result.classes ?? [])], key).not.toEqual([]);
        }
    });

    it('lowers a colour on every side', () => {
        for (const key of SIDE_KEYS) {
            const run = compile(engine, `{ ${key}: 'red-500' }`);
            expect([...(run.result.classes ?? [])], key).not.toEqual([]);
        }
    });

    it('leaves the canonical style key alone', () => {
        // `borderStyle` is the key the snippets document for the style, and the
        // one this refusal points authors at.
        for (const value of STYLE_VALUES) {
            const run = compile(engine, `{ borderStyle: '${value}' }`);
            expect([...(run.result.classes ?? [])], value).toEqual([`border-${value}`]);
            expect(run.warnings, value).toEqual([]);
        }
    });

    it('does not touch the root key either way', () => {
        // `border: '<style>'` reaches `border-none` through the prefix, not
        // through a documented spelling — `border` is the WIDTH key, and
        // `borderStyle` and `borderColor` are its prefix siblings. Whether a
        // value belonging to a sibling should be refused there is an open
        // per-key value-domain question, and NOT decided by this refusal.
        // Asserting only that this change left it untouched keeps the test from
        // ruling on it by accident.
        for (const value of STYLE_VALUES) {
            const run = compile(engine, `{ border: '${value}' }`);
            expect([...(run.result.classes ?? [])], value).toEqual([`border-${value}`]);
        }
    });

    it('keeps the sibling keys in the same object', () => {
        // Dropping the whole attribute would cost more than the dead class did.
        const run = compile(engine, "{ p: 4, borderB: 'none', bg: 'red-500' }");

        expect([...(run.result.classes ?? [])]).toEqual(['p-4', 'bg-red-500']);
    });
});
