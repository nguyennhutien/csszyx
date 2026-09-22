/**
 * The engine reads the merge-table format this plugin writes.
 *
 * The two numbers are kept apart on purpose — a plugin and an engine from
 * different releases must not merge on a table one of them misreads — so the
 * only thing that ties them in one release is this test.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES } from '../../compiler/tests/engine-parity-harness.js';
import { ENGINE_MERGE_TABLE_FORMAT } from '../src/merge-signature.js';

describe('the engine merge table format', () => {
    it.each(ENGINES)('is the one the %s engine reads', (_name, transform) => {
        const result = transform('export const A = () => <div sz={{ pb: 2, p: 4 }} />;', 'a.tsx', {
            mergeTable: {
                format: ENGINE_MERGE_TABLE_FORMAT,
                signatures: { 'p-4': 0, 'pb-2': 1 },
                coverage: [[1], []],
            },
        });

        expect(result.diagnostics ?? []).toEqual([]);
        expect(result.code).toContain('className="p-4"');
    });
});
