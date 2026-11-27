/**
 * Every CSS unit a value can carry is an arbitrary value, on every lane.
 *
 * The unit list was a copy per lane, and both copies stopped short of CSS
 * Values 4: `w: '2lh'` wrote `w-2lh` and `text: '1cqi'` wrote `text-1cqi`,
 * classes Tailwind serves nothing for, and a sign took the bare-class path
 * (`text: '-.25cqi'` wrote `-text-.25cqi`). The TypeScript lane also bracketed
 * a leading decimal (`.5vmin`) for seven units only, where the engine
 * bracketed it for any.
 */
import { describe, expect, it } from 'vitest';
import { escapeUnsafeChars } from '../../core/tests/helpers/sz-fuzz.js';
import { __resetSzWarnDedupForTests, transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

/** One sz object. */
type Sz = Record<string, unknown>;

const LANES: ReadonlyArray<readonly [string, (sz: Sz) => string]> = [
    [
        'runtime',
        (sz: Sz): string => {
            __resetSzWarnDedupForTests();
            return transform(sz as never).className;
        },
    ],
    ...ENGINES.map(
        ([name, engine]) =>
            [
                name,
                (sz: Sz): string =>
                    captureWarnings(
                        engine,
                        `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify(sz))}} />;`,
                        '/p/src/Units.jsx',
                    ).className ?? '',
            ] as const,
    ),
];

describe.each(LANES)('a value with a CSS unit — %s', (_name, lower) => {
    it.each<[Sz, string]>([
        // Container query, viewport, font-relative and absolute lengths.
        [{ text: '1cqi' }, 'text-[1cqi]'],
        [{ w: '10cqmin' }, 'w-[10cqmin]'],
        [{ h: '50cqb' }, 'h-[50cqb]'],
        [{ w: '20vmin' }, 'w-[20vmin]'],
        [{ h: '100dvb' }, 'h-[100dvb]'],
        [{ w: '2lh' }, 'w-[2lh]'],
        [{ mt: '1ex' }, 'mt-[1ex]'],
        [{ w: '3ic' }, 'w-[3ic]'],
        [{ w: '1in' }, 'w-[1in]'],
        [{ w: '12pt' }, 'w-[12pt]'],
        [{ w: '10Q' }, 'w-[10Q]'],
        // A leading decimal, on any unit.
        [{ p: '.5vmin' }, 'p-[.5vmin]'],
        [{ text: '.25cqi' }, 'text-[.25cqi]'],
        // A sign stays inside the bracket.
        [{ text: '-.25cqi' }, 'text-[-.25cqi]'],
        [{ m: '-1lh' }, 'm-[-1lh]'],
        // Unchanged.
        [{ w: '10px' }, 'w-[10px]'],
        [{ p: 4 }, 'p-4'],
        [{ text: 'lg' }, 'text-lg'],
    ])('%j writes %s', (sz, className) => {
        expect(lower(sz)).toBe(className);
    });
});
