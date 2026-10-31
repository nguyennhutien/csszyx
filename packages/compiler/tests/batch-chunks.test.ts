/**
 * Batches the wasm artifact reads in one call are cut by source length, since
 * each call crosses as one JSON string and an engine's strings stop well short
 * of a large repository.
 */
import { describe, expect, it } from 'vitest';

import { chunksByLength } from '../src/batch-chunks.js';

const file = (source: string): { filename: string; source: string } => ({
    filename: `/p/${source}.ts`,
    source,
});

describe('chunksByLength', () => {
    it('keeps the files in order and starts a chunk where the next would pass the limit', () => {
        const files = ['aaaa', 'bb', 'cccc', 'd', 'eeeeeeee', 'f'].map(file);
        expect(chunksByLength(files, 6).map(chunk => chunk.map(entry => entry.source))).toEqual([
            ['aaaa', 'bb'],
            ['cccc', 'd'],
            ['eeeeeeee'],
            ['f'],
        ]);
    });

    it('puts a first file longer than the limit in a chunk of its own', () => {
        expect(chunksByLength(['eeeeeeee', 'a'].map(file), 6).map(chunk => chunk.length)).toEqual([
            1, 1,
        ]);
    });

    it('answers no chunk for no files, and one for files under the limit', () => {
        expect(chunksByLength([], 6)).toEqual([]);
        expect(chunksByLength(['a', 'b'].map(file), 6)).toHaveLength(1);
    });
});
