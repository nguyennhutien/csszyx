/**
 * The parity harness refuses to run without the native lane.
 *
 * A missing native binding used to leave every parity suite green on the wasm
 * artifact alone outside CI, so a RED run could be red on one artifact and the
 * TDD rule (red on both) was satisfied by accident.
 */
import { describe, expect, it } from 'vitest';

import { assertRustLane, WASM_ONLY_ENV } from './engine-parity-harness.js';

describe('assertRustLane', () => {
    it('passes when the native binding is present', () => {
        expect(assertRustLane(true, {})).toBe(true);
        expect(assertRustLane(true, { CI: 'true' })).toBe(true);
    });

    it('fails without the binding and names the way out', () => {
        expect(() => assertRustLane(false, {})).toThrow(WASM_ONLY_ENV);
    });

    it('runs wasm alone only when the way out is set explicitly', () => {
        expect(assertRustLane(false, { [WASM_ONLY_ENV]: '1' })).toBe(false);
        expect(() => assertRustLane(false, { [WASM_ONLY_ENV]: 'true' })).toThrow(WASM_ONLY_ENV);
    });

    it('ignores the way out under CI, where the native build must have run', () => {
        expect(() => assertRustLane(false, { CI: 'true', [WASM_ONLY_ENV]: '1' })).toThrow(/CI/);
    });
});
