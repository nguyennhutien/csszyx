/**
 * A suite that compares against the native addon when it loads may skip that
 * lane on a developer's machine, never where the native build must have run.
 *
 * The runtime/engine differential used to drop the native lane silently when
 * the addon was missing or stale, so a CI run whose native build broke still
 * passed on the wasm artifact alone.
 */
import { describe, expect, it, vi } from 'vitest';

import { nativeLaneRequired, REQUIRE_NATIVE_ENV, settleNativeLane } from './helpers/native-lane.js';

/**
 * A stand-in for a native lane that loaded.
 *
 * @returns Its name.
 */
const lane = (): string => 'native';

describe('nativeLaneRequired', () => {
    it('is required under CI or when asked for by name', () => {
        expect(nativeLaneRequired({ CI: 'true' })).toBe(true);
        expect(nativeLaneRequired({ [REQUIRE_NATIVE_ENV]: '1' })).toBe(true);
        expect(nativeLaneRequired({})).toBe(false);
        expect(nativeLaneRequired({ [REQUIRE_NATIVE_ENV]: 'true' })).toBe(false);
    });
});

describe('settleNativeLane', () => {
    it('keeps a lane that loaded, wherever it runs', () => {
        const warn = vi.fn();
        expect(settleNativeLane('suite', lane, { CI: 'true' }, warn)).toBe(lane);
        expect(settleNativeLane('suite', lane, {}, warn)).toBe(lane);
        expect(warn).not.toHaveBeenCalled();
    });

    it('fails where the native lane is required, naming why it is missing', () => {
        const warn = vi.fn();
        for (const env of [{ CI: 'true' }, { [REQUIRE_NATIVE_ENV]: '1' }]) {
            expect(() =>
                settleNativeLane('suite', 'the native addon is not built', env, warn),
            ).toThrow(/^suite: the native lane is required here .*the native addon is not built/);
        }
        expect(warn).not.toHaveBeenCalled();
    });

    it('skips locally, and says so where the run is read', () => {
        const warn = vi.fn();
        expect(
            settleNativeLane('suite', 'the native addon is not built', {}, warn),
        ).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(
            expect.stringMatching(
                /^suite: native lane skipped — the native addon is not built\. .*CSSZYX_REQUIRE_NATIVE=1/,
            ),
        );
    });
});
