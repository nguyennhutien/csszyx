// Unit tests for the diagnostic cost gate's pure parts. The child runs
// themselves are the gate (`pnpm check:diagnostic-cost`).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    CLEAN_SCAVENGE_CEILING,
    cleanModule,
    countScavenges,
    judge,
    noisyModule,
    SCAVENGE_DELTA_BUDGETS,
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
    const limits = { ceiling: CLEAN_SCAVENGE_CEILING, budgets: SCAVENGE_DELTA_BUDGETS };
    const at = {
        clean: CLEAN_SCAVENGE_CEILING,
        eager: CLEAN_SCAVENGE_CEILING + SCAVENGE_DELTA_BUDGETS.eager,
        lane: CLEAN_SCAVENGE_CEILING + SCAVENGE_DELTA_BUDGETS.lane,
    };

    it('passes at the ceiling and each budget, and fails a workload just past its budget', () => {
        assert.equal(judge(at, limits).ok, true);
        const over = judge({ ...at, lane: at.lane + 1 }, limits);
        assert.equal(over.ok, false);
        assert.match(over.lines[2] ?? '', /^diagnostic cost \(lane\): .*over budget/);
        assert.doesNotMatch(over.lines[0] ?? '', /over/);
        assert.doesNotMatch(over.lines[1] ?? '', /over/);
    });

    it('fails a clean control past its ceiling, though the differences shrink', () => {
        // The 0.18.0 shape: clean grew, and every ratio to it fell.
        const grown = { clean: at.clean + 11, eager: at.eager, lane: at.lane };
        const verdict = judge(grown, limits);
        assert.equal(verdict.ok, false);
        assert.match(verdict.lines[0] ?? '', /^transform cost \(clean\): .*over the ceiling/);
        assert.doesNotMatch(verdict.lines[1] ?? '', /over/);
    });

    it('budgets the diagnostic path as a difference, so a cheaper control does not fail it', () => {
        // Measured: 88e1b319 against the baseline, the control fell by 14 and
        // the diagnostic path stayed within 2 scavenges.
        assert.equal(judge({ clean: 111, eager: 262, lane: 164 }, limits).ok, true);
        assert.equal(judge({ clean: 80, eager: 231, lane: 133 }, limits).ok, true);
    });
});

describe('the workload modules', () => {
    it('names fresh unknown keys per salt and keeps the clean module free of them', () => {
        assert.match(noisyModule(3, '3p1'), /fooBar3p1: 1/);
        assert.notEqual(noisyModule(3, '3p1'), noisyModule(3, '3p2'));
        assert.doesNotMatch(cleanModule(3), /fooBar|zzTop|qqq|xyzw|workBreak|padding/);
    });
});
