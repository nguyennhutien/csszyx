import { describe, expect, it } from 'vitest';

import { handleBatch } from '../src/tools/batch';

describe('csszyx_batch', () => {
    it('expands multiple sz objects', () => {
        const data = JSON.parse(
            handleBatch({ items: [{ p: 4 }, { m: 2, bg: 'red-500' }] }).content[0].text,
        );
        expect(data.results[0].className).toBe('p-4');
        expect(data.results[1].className).toContain('m-2');
        expect(data.results[1].className).toContain('bg-red-500');
        expect(data.totalItems).toBe(2);
        expect(data.successful).toBe(2);
    });

    it('handles empty array', () => {
        const data = JSON.parse(handleBatch({ items: [] }).content[0].text);
        expect(data.results).toEqual([]);
        expect(data.totalItems).toBe(0);
        expect(data.successful).toBe(0);
    });

    it('preserves index and continues on per-item error', () => {
        // An invalid sz value may cause transform to throw; batch should not abort.
        const items = [{ p: 4 }, { flex: true }, { p: 2 }];
        const data = JSON.parse(handleBatch({ items }).content[0].text);
        expect(data.results).toHaveLength(3);
        expect(data.results[0].index).toBe(0);
        expect(data.results[2].className).toContain('p-2');
    });

    it('includes index in each result for stable ordering', () => {
        const data = JSON.parse(
            handleBatch({ items: [{ m: 1 }, { m: 2 }, { m: 3 }] }).content[0].text,
        );
        expect(data.results.map((r: { index: number }) => r.index)).toEqual([0, 1, 2]);
    });
});
