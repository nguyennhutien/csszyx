/**
 * The ignore patterns of the Next commands, matched against paths under a root.
 *
 * The command line and the loader both ask this question, and a second matcher
 * that read `legacy/**` differently would let a stylesheet vote in one lane and
 * not in the other.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRootIgnoreMatcher } from '../src/root-ignore-matcher.js';

const ROOT = join('/', 'work', 'app');

describe('createRootIgnoreMatcher', () => {
    it.each([
        ['legacy/old.css', true],
        ['legacy/nested/deep/new.css', true],
        ['legacy', true],
        ['app/globals.css', false],
        ['app/legacy.css', false],
        ['.hidden/file.css', true],
    ])('%s -> %s', (relative, expected) => {
        const { ignoresFile: isIgnored } = createRootIgnoreMatcher(ROOT, [
            'legacy/**',
            '.hidden/**',
        ]);

        expect(isIgnored(join(ROOT, relative))).toBe(expected);
    });

    // Measured against fast-glob 3.3.3, which reads the same list for the source
    // scan; `packages/cli/tests/ignore-matcher-parity.test.ts` runs the two side
    // by side. A pattern reaches below a directory it matches only when it ends
    // in `/**` or its last segment is static.
    it.each([
        ['legacy', 'legacy/old.css', true],
        ['legacy', 'legacy/nested/deep/new.css', true],
        ['./legacy/**', 'legacy/old.css', true],
        ['**/__skip__', 'src/__skip__/inner/file.css', true],
        ['l*/nested', 'legacy/nested/deep/new.css', true],
        ['{legacy,docs}', 'docs/sub/f.css', true],
        ['legacy/*', 'legacy/old.css', true],
        ['legacy/*', 'legacy/nested/new.css', false],
        ['leg*', 'legacy/old.css', false],
        ['legacy/', 'legacy/old.css', false],
    ])('%s on %s -> %s', (pattern, relative, expected) => {
        expect(createRootIgnoreMatcher(ROOT, [pattern]).ignoresFile(join(ROOT, relative))).toBe(
            expected,
        );
    });

    it('answers the same for a path it has seen before', () => {
        // Verdicts for directories are remembered: files share their ancestors.
        const { ignoresFile: isIgnored } = createRootIgnoreMatcher(ROOT, ['legacy']);
        const first = [
            isIgnored(join(ROOT, 'legacy/a/b.css')),
            isIgnored(join(ROOT, 'app/a/b.css')),
        ];
        const again = [
            isIgnored(join(ROOT, 'legacy/a/c.css')),
            isIgnored(join(ROOT, 'app/a/c.css')),
        ];

        expect(first).toEqual([true, false]);
        expect(again).toEqual([true, false]);
    });

    // A directory is pruned only when nothing under it can be kept.
    it.each([
        ['legacy', 'legacy', true],
        ['legacy/**', 'legacy', true],
        ['legacy/**', 'legacy/deep', true],
        ['{legacy,docs}', 'docs/sub', true],
        ['legacy/*', 'legacy/deep', false],
        ['legacy/*', 'legacy', false],
        ['leg*', 'legacy', false],
        ['docs/*', 'docs/sub', false],
    ])('%s covers the tree at %s -> %s', (pattern, directory, expected) => {
        expect(createRootIgnoreMatcher(ROOT, [pattern]).coversTree(join(ROOT, directory))).toBe(
            expected,
        );
    });

    it('does not read a directory pattern as covering a sibling that shares its prefix', () => {
        const { ignoresFile: isIgnored } = createRootIgnoreMatcher(ROOT, ['legacy']);

        expect(isIgnored(join(ROOT, 'legacy-next/old.css'))).toBe(false);
    });

    it('answers the same after the directory memo fills and starts over', () => {
        // A watcher lives for the whole session, so the memo is bounded rather
        // than left to grow with every directory it is ever shown. Every answer
        // is checked, the ones given while it fills and starts over included,
        // then each directory is asked again once it is gone from the memo.
        const { ignoresFile: isIgnored } = createRootIgnoreMatcher(ROOT, ['legacy']);
        const directories = Array.from({ length: 50_002 }, (_, index) => `app/d${index}`);
        const ask = () => directories.filter(dir => isIgnored(join(ROOT, dir, 'x.css')));

        expect(ask()).toEqual([]);
        expect(ask()).toEqual([]);
        expect(isIgnored(join(ROOT, 'legacy/deep/x.css'))).toBe(true);
    });

    it('refuses a negated pattern rather than ignore everything else', () => {
        // Each pattern is matched on its own, so `!legacy/keep.css` would match
        // every path but that one, the app's real entry included.
        expect(() => createRootIgnoreMatcher(ROOT, ['legacy/**', '!legacy/keep.css'])).toThrow(
            /`!legacy\/keep\.css`.*negated/s,
        );
    });

    it('never matches the root itself or a path outside it', () => {
        const { ignoresFile: isIgnored } = createRootIgnoreMatcher(ROOT, ['**']);

        expect(isIgnored(ROOT)).toBe(false);
        expect(isIgnored(join('/', 'work', 'other', 'legacy', 'old.css'))).toBe(false);
    });

    it('reads a backslash in a pattern as an escape, the way the source glob does', () => {
        // The command line turns `legacy\**` into `legacy/**` before either reader sees it.
        const { ignoresFile: isIgnored } = createRootIgnoreMatcher(ROOT, ['legacy\\**']);

        expect(isIgnored(join(ROOT, 'legacy/old.css'))).toBe(false);
    });

    it('matches nothing when there are no patterns', () => {
        expect(createRootIgnoreMatcher(ROOT, []).ignoresFile(join(ROOT, 'legacy/old.css'))).toBe(
            false,
        );
        expect(createRootIgnoreMatcher(ROOT, []).coversTree(join(ROOT, 'legacy'))).toBe(false);
    });
});
