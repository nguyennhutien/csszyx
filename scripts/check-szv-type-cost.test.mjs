// Unit tests for the szv type-cost gate's pure parts. The tsc run itself is
// the gate (`pnpm check:szv-type-cost`).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    FIXTURE_CALLS,
    fixtureSource,
    INSTANTIATION_BUDGET,
    judge,
    parseInstantiations,
} from './check-szv-type-cost.mjs';

describe('parseInstantiations', () => {
    it('reads the count tsc prints, with or without separators', () => {
        assert.equal(
            parseInstantiations('Types:  100\nInstantiations:  57911\nMemory used: 1K'),
            57_911,
        );
        assert.equal(parseInstantiations('Instantiations:  57,911\n'), 57_911);
    });

    it('answers null when the line is missing', () => {
        assert.equal(parseInstantiations('error TS2322: nope'), null);
    });
});

describe('judge', () => {
    it('passes at the budget and fails one above it', () => {
        assert.equal(judge(INSTANTIATION_BUDGET, INSTANTIATION_BUDGET).ok, true);
        const over = judge(INSTANTIATION_BUDGET + 1, INSTANTIATION_BUDGET);
        assert.equal(over.ok, false);
        assert.match(over.message, /over budget/);
    });
});

describe('fixtureSource', () => {
    it('declares FIXTURE_CALLS factories from the given variants module', () => {
        const source = fixtureSource('/abs/variants.ts');
        assert.match(source, /from "\/abs\/variants\.ts"/);
        assert.equal(source.match(/= szv\(/g)?.length, FIXTURE_CALLS);
    });
});
