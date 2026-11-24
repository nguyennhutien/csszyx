/**
 * Migrate, then lower: the class a user had must be the class they get back.
 *
 * A wrong migrate is silent. `block-1/2` became `{ blockSize: 1 }` and
 * `content-center-safe` became the CSS `content` property: both compile, both
 * emit a class, and neither is the class the user wrote. Lowering the migrated
 * object on both engine artifacts and comparing against the original catches
 * that shape, where a migrate-only assertion would just pin the wrong answer.
 */
import { describe, expect, it } from 'vitest';

import { escapeUnsafeChars } from '../../core/tests/helpers/sz-fuzz.js';
import { migrateRustClassName } from '../src/migrate-rust.js';
import { captureWarnings, ENGINES, expectParity } from './engine-parity-harness.js';

/**
 * Migrate one class and lower the result on both artifacts.
 *
 * @param className - One Tailwind utility class.
 * @param lowered - The class the lowering writes back, when it spells the
 *   utility another way every Tailwind v4 serves (`inset-s-4` → `start-4`).
 */
function expectRoundTrip(className: string, lowered = className): void {
    const { szObject } = migrateRustClassName(className);
    expectParity(JSON.stringify(szObject), lowered);
}

/** Every logical size key, by its Tailwind prefix. */
const LOGICAL_SIZE_PREFIXES = [
    'block',
    'inline',
    'min-block',
    'max-block',
    'min-inline',
    'max-inline',
] as const;

/**
 * Every logical inset side that takes a fraction, and the prefix the lowering
 * writes for it: `inset-s-*` / `inset-e-*` are Tailwind 4.2+'s names for
 * `start-*` / `end-*`, which every v4 serves, so migrate reads either and the
 * lowering writes the one every v4 serves.
 */
const LOGICAL_INSET_PREFIXES = [
    ['inset-s', 'start'],
    ['inset-e', 'end'],
    ['start', 'start'],
    ['end', 'end'],
    ['inset-bs', 'inset-bs'],
    ['inset-be', 'inset-be'],
] as const;

/** Every align-content keyword Tailwind 4.3 serves on `content-*`. */
const ALIGN_CONTENT_KEYWORDS = [
    'normal',
    'center',
    'center-safe',
    'start',
    'end',
    'end-safe',
    'between',
    'around',
    'evenly',
    'baseline',
    'stretch',
] as const;

/**
 * A negative of each utility the compiler writes one for, which migrate read
 * from its own hand copy of the list until that copy fell behind.
 */
const NEGATIVE_CLASSES = [
    '-scale-50',
    '-scale-x-50',
    '-scale-y-50',
    '-scale-z-50',
    '-translate-z-4',
    '-outline-offset-2',
    '-underline-offset-2',
    '-scroll-ms-4',
    '-scroll-me-4',
    '-scroll-mbs-4',
    '-scroll-mbe-4',
] as const;

describe('migrate → lower reproduces the original class', () => {
    it.each(NEGATIVE_CLASSES)('%s', className => {
        expectRoundTrip(className);
    });

    describe.each(LOGICAL_SIZE_PREFIXES)('%s', prefix => {
        it.each(['1/2', '1/3', '2/3', '3/4', '4', 'full'])(`${prefix}-%s`, value => {
            expectRoundTrip(`${prefix}-${value}`);
        });
    });

    describe.each(LOGICAL_INSET_PREFIXES)('%s', (prefix, written) => {
        it.each(['1/2', '1/4', '4'])(`${prefix}-%s`, value => {
            expectRoundTrip(`${prefix}-${value}`, `${written}-${value}`);
        });
    });

    it.each(ALIGN_CONTENT_KEYWORDS)('content-%s', keyword => {
        expectRoundTrip(`content-${keyword}`);
    });
});

/**
 * Classes whose bracket, type hint or `!` migrate read onto the wrong key or
 * spelling: each must lower back to the class written, or one Tailwind reads
 * as the same utility, with nothing reported on any lane.
 */
const BRACKETED_CLASSES = [
    // class, the class the migrated object writes
    ['text-[length:13px]', 'text-[13px]'],
    ['text-[color:red]', 'text-[red]'],
    ['font-[700]', 'font-[700]'],
    ['font-[family-name:x]', 'font-[x]'],
    ['!p-[10px]', 'p-[10px]!'],
    ['!font-bold', 'font-bold!'],
    ['bg-[var(--v)]', 'bg-(--v)'],
    ['p-[var(--my-pad)]', 'p-(--my-pad)'],
    ['origin-[0]', 'origin-[0]'],
    ['transition-[width]', 'transition-[width]'],
    ['bg-[top]', 'bg-[top]'],
    ['font-[Inter]', 'font-[Inter]'],
    ['break-words', 'break-words'],
] as const;

describe('migrate → lower writes a bracketed class back with no report', () => {
    it.each(BRACKETED_CLASSES)('%s → %s', (className, lowered) => {
        const { szObject, unrecognized } = migrateRustClassName(className);
        expect(unrecognized).toEqual([]);
        const sz = JSON.stringify(szObject);
        expectParity(sz, lowered);
        for (const [name, engine] of ENGINES) {
            const run = captureWarnings(
                engine,
                `export const A = () => <div sz={${escapeUnsafeChars(sz)}} />;`,
                '/p/src/M.tsx',
            );
            expect(run.warnings, `${name} — ${sz}`).toEqual([]);
        }
    });

    it.each(['text-[length:var(--x)]', '!p-4!'])('%s stays in className', className => {
        expect(migrateRustClassName(className).unrecognized).toEqual([className]);
    });
});
