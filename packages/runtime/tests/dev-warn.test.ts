/**
 * Direct tests for the shared devWarn helper: the dedup cache and the
 * production no-op branch. `szv-validation.test.ts` exercises devWarn
 * indirectly through szv, but never with an actually-invalid config while
 * NODE_ENV is production, so the early-return branch was never real-behavior
 * tested — this pins it directly at the source.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { devWarn, resetDevWarnCache } from '../src/dev-warn.js';

describe('devWarn', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    const prevEnv = process.env.NODE_ENV;

    beforeEach(() => {
        resetDevWarnCache();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warn.mockRestore();
        process.env.NODE_ENV = prevEnv;
    });

    it('warns with the [csszyx] prefix outside production', () => {
        process.env.NODE_ENV = 'development';
        devWarn('something is off');
        expect(warn).toHaveBeenCalledWith('[csszyx] something is off');
    });

    it('is a no-op in production, even for a message never seen before', () => {
        process.env.NODE_ENV = 'production';
        devWarn('a brand-new message');
        expect(warn).not.toHaveBeenCalled();
    });

    it('dedupes repeated messages within the same cache generation', () => {
        process.env.NODE_ENV = 'development';
        devWarn('repeat me');
        devWarn('repeat me');
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('warns again after resetDevWarnCache clears the dedup set', () => {
        process.env.NODE_ENV = 'development';
        devWarn('reset test');
        resetDevWarnCache();
        devWarn('reset test');
        expect(warn).toHaveBeenCalledTimes(2);
    });
});
