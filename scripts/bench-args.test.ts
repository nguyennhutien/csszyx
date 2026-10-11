import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAllowlistedCsv, parseCsv } from './bench-args.ts';

const MODES = ['wasm', 'rust', 'no-csszyx'] as const;

describe('parseCsv', () => {
    it('trims items and drops empty ones', () => {
        assert.deepEqual(parseCsv(' rust, ,wasm ,'), ['rust', 'wasm']);
    });
});

describe('parseAllowlistedCsv', () => {
    it('keeps allowed values in input order without duplicates', () => {
        assert.deepEqual(parseAllowlistedCsv('rust,wasm,rust', MODES, '--modes'), ['rust', 'wasm']);
    });

    it('rejects an unknown value', () => {
        assert.throws(
            () => parseAllowlistedCsv('rust,turbo', MODES, '--modes'),
            /^Error: Unknown --modes value "turbo"\.$/,
        );
    });

    it('rejects a removed lane and names the wasm replacement', () => {
        for (const lane of ['oxc', 'babel']) {
            assert.throws(() => parseAllowlistedCsv(`rust,${lane}`, MODES, '--modes'), {
                message: `Unknown --modes value "${lane}". The ${lane} lane was removed; use "wasm" to measure the wasm artifact.`,
            });
        }
    });

    it('omits the replacement hint when wasm is not an allowed value', () => {
        assert.throws(
            () => parseAllowlistedCsv('oxc', ['cold', 'warm'] as const, '--shapes'),
            /^Error: Unknown --shapes value "oxc"\.$/,
        );
    });

    it('rejects an empty list', () => {
        assert.throws(() => parseAllowlistedCsv(' , ', MODES, '--modes'), /must not be empty/);
    });
});
