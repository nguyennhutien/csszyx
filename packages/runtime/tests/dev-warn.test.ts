/**
 * Direct tests for the shared devWarn helper: the dedup cache, the cap, and
 * the production no-op branch. `szv-validation.test.ts` exercises devWarn
 * indirectly through szv, but never with an actually-invalid config while
 * NODE_ENV is production, so the production branch was never real-behavior
 * tested — this pins it directly at the source.
 */
import { SZV_UNKNOWN_VARIANT } from '@csszyx/compiler/report';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runtimeMessage } from '../../compiler/tests/engine-message.js';
import { devWarn, resetDevWarnCache } from '../src/dev-warn.js';

/**
 * What `szv-unknown-variant` prints for one key.
 *
 * @param key - The dimension the selection named.
 * @returns The line.
 */
const unknownVariant = (key: string): string =>
    runtimeMessage(
        'szv-unknown-variant',
        `The \`szv\` selection names the variant \`${key}\`, which \`variants\` does not declare, so it is ignored.`,
        `help: declare \`variants.${key}\`, or remove \`${key}\` from the selection.`,
    );

/**
 * Report `szv-unknown-variant` for one key.
 *
 * @param key - The dimension the selection named.
 */
function report(key: string): void {
    devWarn({ diagnostic: SZV_UNKNOWN_VARIANT, args: { key } });
}

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

    it("prints the registry's words for the id outside production", () => {
        process.env.NODE_ENV = 'development';
        report('tone');
        expect(warn.mock.calls).toEqual([[unknownVariant('tone')]]);
    });

    it('is a no-op in production, even for a report never seen before', () => {
        process.env.NODE_ENV = 'production';
        report('brand-new');
        expect(warn).not.toHaveBeenCalled();
    });

    it('dedupes a repeated id and args within the same cache generation', () => {
        process.env.NODE_ENV = 'development';
        report('repeat');
        report('repeat');
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('warns again after resetDevWarnCache clears the dedup set', () => {
        process.env.NODE_ENV = 'development';
        report('reset');
        resetDevWarnCache();
        report('reset');
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('stops admitting reports after 512 unique ones, and says so once', () => {
        process.env.NODE_ENV = 'development';
        for (let index = 0; index < 1024; index++) {
            report(`user-data-${index}`);
        }
        // 512 real reports plus the one line announcing the cap — never more,
        // however many distinct reports arrive after it.
        expect(warn).toHaveBeenCalledTimes(513);
        expect(warn).toHaveBeenNthCalledWith(512, unknownVariant('user-data-511'));
        expect(warn).toHaveBeenLastCalledWith(
            runtimeMessage(
                'diagnostics-capped',
                'This session has printed 512 distinct development warnings, so further ones are suppressed.',
                'help: look above for one warning repeating with different values; a className built from data is the usual cause.',
            ),
        );

        report('user-data-0');
        report('user-data-512');
        expect(warn).toHaveBeenCalledTimes(513);
    });

    it('admits a previously suppressed report after resetting a full cache', () => {
        process.env.NODE_ENV = 'development';
        for (let index = 0; index <= 512; index++) {
            report(`user-data-${index}`);
        }
        expect(warn).not.toHaveBeenCalledWith(unknownVariant('user-data-512'));

        resetDevWarnCache();
        warn.mockClear();
        report('user-data-512');
        report('user-data-512');
        expect(warn).toHaveBeenCalledExactlyOnceWith(unknownVariant('user-data-512'));
    });
});
