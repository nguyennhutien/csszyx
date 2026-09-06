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

    it('stops admitting warnings after 512 unique messages, and says so once', () => {
        process.env.NODE_ENV = 'development';
        for (let index = 0; index < 1024; index++) {
            devWarn(`user-data-${index}`);
        }
        // 512 real messages plus the one line announcing the cap — never more,
        // however many distinct messages arrive after it.
        expect(warn).toHaveBeenCalledTimes(513);
        expect(warn).toHaveBeenNthCalledWith(512, '[csszyx] user-data-511');
        expect(warn).toHaveBeenLastCalledWith(
            expect.stringContaining('512 distinct development warnings have been printed'),
        );

        devWarn('user-data-0');
        devWarn('user-data-512');
        expect(warn).toHaveBeenCalledTimes(513);
    });

    it('admits a previously suppressed warning after resetting a full cache', () => {
        process.env.NODE_ENV = 'development';
        for (let index = 0; index <= 512; index++) {
            devWarn(`user-data-${index}`);
        }
        expect(warn).not.toHaveBeenCalledWith('[csszyx] user-data-512');
        expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('suppressed'));

        resetDevWarnCache();
        warn.mockClear();
        devWarn('user-data-512');
        devWarn('user-data-512');
        expect(warn).toHaveBeenCalledExactlyOnceWith('[csszyx] user-data-512');
    });
});
