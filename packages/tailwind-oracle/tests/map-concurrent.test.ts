import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { mapConcurrent, readTextFiles } from '../src/map-concurrent.js';

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('mapConcurrent', () => {
    it('keeps the input order and never runs more than the bound at once', async () => {
        let running = 0;
        let peak = 0;
        // Later items finish first, so completion order is the reverse.
        const results = await mapConcurrent([5, 4, 3, 2, 1], 2, async delay => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise(resolve => setTimeout(resolve, delay));
            running -= 1;
            return delay * 10;
        });

        expect(results).toEqual([50, 40, 30, 20, 10]);
        expect(peak).toBe(2);
    });

    it('answers an empty list without starting a worker', async () => {
        await expect(mapConcurrent([], 4, () => Promise.reject(new Error('ran')))).resolves.toEqual(
            [],
        );
    });

    it.each([0, -1, Number.NaN, 1.5])('refuses a concurrency of %s', async concurrency => {
        await expect(
            mapConcurrent([1], concurrency, item => Promise.resolve(item)),
        ).rejects.toThrow(RangeError);
    });

    it('rejects with the first failure', async () => {
        await expect(
            mapConcurrent([1, 2], 2, item =>
                item === 2 ? Promise.reject(new Error('two')) : Promise.resolve(item),
            ),
        ).rejects.toThrow('two');
    });
});

describe('readTextFiles', () => {
    it('returns the readable files in the order given and leaves out the rest', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-read-text-'));
        dirs.push(dir);
        const first = join(dir, 'b.css');
        const second = join(dir, 'a.css');
        writeFileSync(first, '.b {}');
        writeFileSync(second, '.a {}');

        const read = await readTextFiles([first, join(dir, 'gone.css'), second]);

        expect(read).toEqual([
            { path: first, text: '.b {}' },
            { path: second, text: '.a {}' },
        ]);
    });
});
