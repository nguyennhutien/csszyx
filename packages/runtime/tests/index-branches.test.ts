/**
 * Branch coverage for initRuntime()'s two conditionals that index.test.ts
 * does not exercise: the already-initialized short-circuit when `debug` is
 * NOT set (no warning should fire), and `allowCSRRecovery` actually wiring
 * up CSR recovery through hydration.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { disableCSRRecovery, isCSRRecoveryAllowed } from '../src/hydration.js';
import { initRuntime, isRuntimeInitialized, resetRuntime } from '../src/index.js';

describe('initRuntime — re-initialization without debug', () => {
    afterEach(() => {
        resetRuntime();
    });

    it('re-init is silent (no console.warn) when debug was never enabled', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        initRuntime(); // debug defaults to false
        expect(isRuntimeInitialized()).toBe(true);

        initRuntime({ debug: true }); // ignored — already initialized
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('initRuntime — allowCSRRecovery', () => {
    afterEach(() => {
        resetRuntime();
        // hydration module keeps its own module-level state; restore it too.
        disableCSRRecovery();
    });

    it('enables CSR recovery when allowCSRRecovery is true', () => {
        expect(isCSRRecoveryAllowed()).toBe(false);
        initRuntime({ allowCSRRecovery: true });
        expect(isCSRRecoveryAllowed()).toBe(true);
    });
});
