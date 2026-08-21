/**
 * Which stylesheet the scan treats as the Tailwind entry.
 *
 * `findTailwindCssEntries` returns the shallowest first, because a stylesheet
 * nearer the project root is the one a build actually imports. Depth was
 * counted by splitting on `path.sep`, and `fast-glob` returns posix paths on
 * every platform — so on Windows the split found no separator, every path
 * measured depth 1, and the ordering silently fell back to alphabetical.
 *
 * These are a regression guard, NOT a red-first test, and the difference is
 * worth stating: on posix `path.sep` IS `/`, so the two spellings are the same
 * function and nothing here can fail against the old one. The platform the bug
 * exists on is the platform this repo has never run on. Proving it needs the
 * Windows runner that is already planned; until then these pin the invariant
 * so the next edit cannot reintroduce a platform lookup unnoticed.
 */
import { describe, expect, it } from 'vitest';

import { comparePathDepth } from '../src/scanner/emitted-class-oracle.js';

describe('comparePathDepth', () => {
    it('puts the shallower path first', () => {
        expect(comparePathDepth('/p/app.css', '/p/src/styles/app.css')).toBeLessThan(0);
    });

    it('falls back to name order at equal depth', () => {
        expect(comparePathDepth('/p/a.css', '/p/b.css')).toBeLessThan(0);
    });

    it('counts depth from the posix separator, whatever the platform uses', () => {
        // fast-glob returns `/` on Windows too, so a comparator that consults
        // `path.sep` measures every path as depth 1 there and stops ordering.
        const sorted = ['/p/src/deep/app.css', '/p/app.css', '/p/src/app.css'].sort(
            comparePathDepth,
        );

        expect(sorted).toEqual(['/p/app.css', '/p/src/app.css', '/p/src/deep/app.css']);
    });

    it('does not read a backslash as a separator', () => {
        // A literal backslash is a legal filename character on posix, so it
        // must not add depth. On Windows the old comparator read it as one.
        expect(comparePathDepth('/p/a\\b\\c.css', '/p/src/app.css')).toBeLessThan(0);
    });
});
