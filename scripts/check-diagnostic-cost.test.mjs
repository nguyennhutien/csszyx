// Unit tests for the diagnostic cost gate's pure parts. The child runs
// themselves are the gate (`pnpm check:diagnostic-cost`).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    cleanModule,
    countScavenges,
    judge,
    noisyModule,
    SCAVENGE_RATIO_BUDGETS,
} from './check-diagnostic-cost.mjs';

describe('countScavenges', () => {
    it('counts only the collections between the markers', () => {
        const output = [
            '[1:0x1]  3 ms: Scavenge 1.0 (2.0) -> 0.5 (2.0) MB',
            '--- measured passes start',
            '[1:0x1]  9 ms: Scavenge 1.0 (2.0) -> 0.5 (2.0) MB',
            '[1:0x1] 12 ms: Mark-Compact 4.0 (6.0) -> 2.0 (6.0) MB',
            '[1:0x1] 15 ms: Scavenge 1.0 (2.0) -> 0.5 (2.0) MB',
            '--- measured passes end true',
            '[1:0x1] 20 ms: Scavenge 1.0 (2.0) -> 0.5 (2.0) MB',
        ].join('\n');
        assert.equal(countScavenges(output), 2);
        assert.equal(countScavenges('--- measured passes start\n--- measured passes end'), 0);
    });

    it('answers null when a marker is missing or out of order', () => {
        assert.equal(countScavenges('Scavenge'), null);
        assert.equal(countScavenges('--- measured passes end\n--- measured passes start'), null);
    });
});

describe('judge', () => {
    it('passes at each budget and fails just above it', () => {
        const at = {
            clean: 100,
            eager: 100 * SCAVENGE_RATIO_BUDGETS.eager,
            lane: 100 * SCAVENGE_RATIO_BUDGETS.lane,
        };
        assert.equal(judge(at, SCAVENGE_RATIO_BUDGETS).ok, true);
        const over = judge({ ...at, lane: at.lane + 1 }, SCAVENGE_RATIO_BUDGETS);
        assert.equal(over.ok, false);
        assert.match(over.lines[1] ?? '', /^diagnostic cost \(lane\): .*over budget/);
        assert.doesNotMatch(over.lines[0] ?? '', /over budget/);
    });
});

describe('the workload modules', () => {
    it('names fresh unknown keys per salt and keeps the clean module free of them', () => {
        assert.match(noisyModule(3, '3p1'), /fooBar3p1: 1/);
        assert.notEqual(noisyModule(3, '3p1'), noisyModule(3, '3p2'));
        assert.doesNotMatch(cleanModule(3), /fooBar|zzTop|qqq|xyzw|workBreak|padding/);
    });
});
