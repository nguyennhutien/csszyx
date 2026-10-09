/**
 * Migrate, then lower: the class a user had must be the class they get back.
 *
 * A wrong migrate is silent. `block-1/2` became `{ blockSize: 1 }` and
 * `content-center-safe` became the CSS `content` property: both compile, both
 * emit a class, and neither is the class the user wrote. Lowering the migrated
 * object on both engine artifacts and comparing against the original catches
 * that shape, where a migrate-only assertion would just pin the wrong answer.
 */
import { describe, it } from 'vitest';

import { migrateRustClassName } from '../src/migrate-rust.js';
import { expectParity } from './engine-parity-harness.js';

/**
 * Migrate one class and lower the result on both artifacts.
 *
 * @param className - One Tailwind utility class.
 */
function expectRoundTrip(className: string): void {
    const { szObject } = migrateRustClassName(className);
    expectParity(JSON.stringify(szObject), className);
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

/** Every logical inset side that takes a fraction. */
const LOGICAL_INSET_PREFIXES = ['inset-s', 'inset-e', 'inset-bs', 'inset-be'] as const;

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

    describe.each(LOGICAL_INSET_PREFIXES)('%s', prefix => {
        it.each(['1/2', '1/4', '4'])(`${prefix}-%s`, value => {
            expectRoundTrip(`${prefix}-${value}`);
        });
    });

    it.each(ALIGN_CONTENT_KEYWORDS)('content-%s', keyword => {
        expectRoundTrip(`content-${keyword}`);
    });
});
