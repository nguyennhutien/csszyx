/**
 * The shape the chaos repository must keep, or the benchmarks that run on it
 * stop measuring what they were written to measure.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { chaosRepoFiles, writeChaosRepo } from './chaos-repo-fixture.ts';

const SMALL = chaosRepoFiles({ files: 2000 });

test('is deterministic for a seed and differs across seeds', () => {
    const again = chaosRepoFiles({ files: 200, seed: 7 });
    const other = chaosRepoFiles({ files: 200, seed: 8 });
    assert.deepEqual(again, chaosRepoFiles({ files: 200, seed: 7 }));
    assert.notDeepEqual(again.files, other.files);
});

test('sizes are heavy-tailed: a few files carry most of the bytes', () => {
    const { stats } = SMALL;
    // The bands the generator draws from give roughly p99 150 KB, max
    // 1.4 MB and half the bytes in the top 1 %; the bounds below are what a
    // chunking strategy by count and one by bytes need to be told apart.
    assert.ok(
        stats.p99Bytes > stats.medianBytes * 20,
        `p99 ${stats.p99Bytes} vs median ${stats.medianBytes}`,
    );
    assert.ok(stats.maxBytes >= 200_000, `max ${stats.maxBytes}`);
    assert.ok(stats.topOnePercentShare >= 0.4, `top 1 % share ${stats.topOnePercentShare}`);
});

test('the largest files sit together, as the directory that grew them would have them', () => {
    // Walk order is size order, so the last 1 % of components - the God
    // files - carry the same share of bytes the stats report for the largest
    // 1 %; spread across the walk they would not.
    const components = SMALL.files.filter(file => /Card\d+\.tsx$/.test(file.path));
    const total = components.reduce((sum, file) => sum + file.source.length, 0);
    const lastOnePercent = components
        .slice(-Math.ceil(components.length * 0.01))
        .reduce((sum, file) => sum + file.source.length, 0);
    assert.ok(lastOnePercent / total >= 0.4, `last 1 % carry ${lastOnePercent / total}`);
});

test('every component feeds the variable-mangle map and the legacy accumulator', () => {
    for (const file of SMALL.files.filter(f => /Card\d+\.tsx$/.test(f.path))) {
        assert.match(file.source, /sz=\{\{ w, /, `${file.path} has no dynamic sz value`);
        assert.match(file.source, /__element--modifier-/, `${file.path} has no legacy class`);
        assert.match(file.source, /from '\.\/tokens\d+'/, `${file.path} imports no provider`);
    }
    assert.ok(SMALL.stats.unrecognisedOccurrences >= SMALL.stats.files);
});

test('barrels carry both forward shapes and providers carry both registry kinds', () => {
    const barrels = SMALL.files.filter(file => /index\d+\.ts$/.test(file.path));
    const providers = SMALL.files.filter(file => /tokens\d+\.ts$/.test(file.path));
    assert.equal(barrels.length, SMALL.stats.barrels);
    assert.equal(providers.length, SMALL.stats.providers);
    for (const barrel of barrels) {
        assert.match(barrel.source, /export \{ \w+ as \w+ \} from '\.\//, 'no re-export clause');
        assert.match(
            barrel.source,
            /import \{ (\w+) \} from '[^']+';\nexport \{ \1 \};/,
            'no list-form forward',
        );
    }
    for (const provider of providers) {
        assert.match(provider.source, /export const cardSz = \{/, 'no static sz object');
        assert.match(provider.source, /export const badgeSz = szv\(/, 'no szv factory');
    }
});

test('writes the repository to disk', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'csszyx-chaos-'));
    try {
        const stats = writeChaosRepo(dir, { files: 30, groupSize: 10 });
        assert.equal(stats.files, 36);
        assert.ok(existsSync(path.join(dir, 'src/Card000029.tsx')));
        assert.match(readFileSync(path.join(dir, 'src/index2.ts'), 'utf8'), /Card29 as Last2/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
