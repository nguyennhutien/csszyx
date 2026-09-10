import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
    coefficientOfVariation,
    formatDispersion,
    historyPath,
    machineState,
    mean,
    median,
    percentile,
    recordBenchRun,
    standardDeviation,
    summarize,
} from './bench-stats.ts';

describe('median', () => {
    it('returns the middle value of an odd sample', () => {
        assert.equal(median([3, 1, 2]), 2);
    });

    it('averages the two middle values of an even sample', () => {
        assert.equal(median([4, 1, 3, 2]), 2.5);
    });

    it('does not mutate the caller sample', () => {
        const values = [3, 1, 2];
        median(values);
        assert.deepEqual(values, [3, 1, 2]);
    });

    it('has no median for an empty sample', () => {
        // The six harness-local copies disagreed here — 0, NaN, undefined.
        // NaN is the honest answer and it propagates instead of reading as a
        // measurement of zero.
        assert.ok(Number.isNaN(median([])));
    });
});

describe('percentile', () => {
    it('takes the nearest rank rather than interpolating', () => {
        // 95th of ten samples is rank ceil(9.5) - 1 = 9, the largest.
        assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
        assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5), 5);
    });

    it('never leaves the sample', () => {
        assert.equal(percentile([7], 0.95), 7);
        assert.equal(percentile([1, 2], 0), 1);
        assert.equal(percentile([1, 2], 1), 2);
    });

    it('is undefined for an empty sample', () => {
        assert.ok(Number.isNaN(percentile([], 0.95)));
    });
});

describe('dispersion', () => {
    it('is zero for a constant sample', () => {
        assert.equal(standardDeviation([5, 5, 5, 5]), 0);
        assert.equal(coefficientOfVariation([5, 5, 5, 5]), 0);
    });

    it('scales with spread, not with magnitude', () => {
        // The point of a unitless figure: 10x the values, same CV.
        const small = coefficientOfVariation([9, 10, 11]);
        const large = coefficientOfVariation([90, 100, 110]);
        assert.ok(Math.abs(small - large) < 1e-9);
    });

    it('separates two samples with an identical median', () => {
        const tight = summarize([11, 12, 12, 13]);
        const wide = summarize([4, 12, 12, 90]);
        assert.equal(tight.median, wide.median);
        assert.ok(tight.cvPercent < wide.cvPercent);
        assert.ok(tight.p95 < wide.p95);
    });

    it('needs two samples for a standard deviation', () => {
        assert.ok(Number.isNaN(standardDeviation([5])));
        assert.ok(Number.isNaN(coefficientOfVariation([5])));
    });

    it('is undefined when the mean is zero', () => {
        assert.ok(Number.isNaN(coefficientOfVariation([-1, 1])));
    });

    it('reports mean alongside', () => {
        assert.equal(mean([1, 2, 3]), 2);
        assert.ok(Number.isNaN(mean([])));
    });
});

describe('formatDispersion', () => {
    it('names every figure and the sample size', () => {
        const line = formatDispersion(summarize([10, 12, 14]));
        assert.match(line, /12\.00 ms median/);
        assert.match(line, /p95 14\.00 ms/);
        assert.match(line, /min 10\.00 ms/);
        assert.match(line, /CV \d+\.\d%/);
        assert.match(line, /n=3/);
    });

    it('prints n/a rather than NaN for an undefined statistic', () => {
        const line = formatDispersion(summarize([]));
        assert.match(line, /n\/a/);
        assert.doesNotMatch(line, /NaN/);
    });

    it('carries the unit it was given', () => {
        assert.match(formatDispersion(summarize([1, 2]), 'KiB'), /KiB median/);
    });
});

describe('machineState', () => {
    it('agrees with the container marker on disk', () => {
        // A run recorded as host when it was containerised joins the wrong
        // series: container CPU and memory limits are not the host's. The
        // editor-set env vars are absent in a shell started any other way, so
        // the marker file is what this must follow.
        assert.equal(machineState().container, existsSync('/.dockerenv'));
    });

    it('carries enough to tell two machines apart', () => {
        const state = machineState();
        assert.ok(state.cpuCount > 0);
        assert.ok(state.totalMemoryGiB > 0);
        assert.match(state.nodeVersion, /^v\d+\./);
        assert.equal(state.arch, process.arch);
    });
});

describe('recordBenchRun', () => {
    it('appends one JSON line per run, carrying commit and machine', () => {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-bench-history-'));
        process.env.CSSZYX_BENCH_HISTORY_DIR = dir;
        delete process.env.CSSZYX_BENCH_HISTORY;
        try {
            const first = recordBenchRun('probe', [{ label: 'a', medianMs: 1 }]);
            const second = recordBenchRun('probe', [{ label: 'a', medianMs: 2 }]);
            assert.equal(first, join(dir, 'probe.jsonl'));
            assert.equal(second, first);

            const lines = readFileSync(first as string, 'utf8')
                .trim()
                .split('\n');
            assert.equal(lines.length, 2);
            const record = JSON.parse(lines[0] as string);
            assert.equal(record.schema, 1);
            assert.equal(record.benchmark, 'probe');
            assert.deepEqual(record.rows, [{ label: 'a', medianMs: 1 }]);
            assert.ok(typeof record.machine.arch === 'string');
            assert.ok(typeof record.machine.cpuCount === 'number');
            assert.ok(!Number.isNaN(Date.parse(record.recordedAt)));
            // A dirty tree must be visible: the code measured is unnamed, so
            // the line cannot honestly join a series keyed by commit.
            assert.ok(record.git === null || typeof record.git.dirty === 'boolean');
        } finally {
            delete process.env.CSSZYX_BENCH_HISTORY_DIR;
        }
    });

    it('skips recording when switched off', () => {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-bench-history-'));
        process.env.CSSZYX_BENCH_HISTORY_DIR = dir;
        process.env.CSSZYX_BENCH_HISTORY = '0';
        try {
            assert.equal(recordBenchRun('probe', [{}]), null);
        } finally {
            delete process.env.CSSZYX_BENCH_HISTORY;
            delete process.env.CSSZYX_BENCH_HISTORY_DIR;
        }
    });

    it('puts history under the repo by default', () => {
        delete process.env.CSSZYX_BENCH_HISTORY_DIR;
        assert.match(historyPath('transform-cache'), /\.bench-history\/transform-cache\.jsonl$/);
    });
});
