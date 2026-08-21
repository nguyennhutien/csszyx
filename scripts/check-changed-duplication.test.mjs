// Unit tests for the changed-lines duplication gate.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clonesOnChangedLines } from './check-changed-duplication.mjs';

/**
 * Build one clone record in the shape jscpd reports.
 *
 * @param first - Path, start and end of the first block.
 * @param second - Path, start and end of the second block.
 * @returns The record.
 */
function clone(first, second) {
    return {
        lines: first.end - first.start + 1,
        firstFile: { name: first.path, start: first.start, end: first.end },
        secondFile: { name: second.path, start: second.start, end: second.end },
    };
}

describe('changed-line duplication', () => {
    const both = clone(
        { path: 'a/src/x.ts', start: 10, end: 24 },
        { path: 'a/src/y.ts', start: 80, end: 94 },
    );

    it('keeps a clone whose first block covers a changed line', () => {
        const touched = new Map([['packages/a/src/x.ts', new Set([12])]]);

        assert.equal(clonesOnChangedLines([both], touched, 'packages').length, 1);
    });

    it('keeps a clone whose second block covers a changed line', () => {
        const touched = new Map([['packages/a/src/y.ts', new Set([94])]]);

        assert.equal(clonesOnChangedLines([both], touched, 'packages').length, 1);
    });

    it('drops a clone the diff did not touch', () => {
        // The tree already holds duplication this change is not responsible
        // for, and a gate that failed on all of it would be turned off.
        const touched = new Map([['packages/a/src/x.ts', new Set([200])]]);

        assert.deepEqual(clonesOnChangedLines([both], touched, 'packages'), []);
    });

    it('drops a clone in a file the diff never names', () => {
        const touched = new Map([['packages/b/src/z.ts', new Set([12])]]);

        assert.deepEqual(clonesOnChangedLines([both], touched, 'packages'), []);
    });

    it('counts the boundary lines of a block as covered by it', () => {
        const touched = new Map([['packages/a/src/x.ts', new Set([10])]]);

        assert.equal(clonesOnChangedLines([both], touched, 'packages').length, 1);
    });
});
