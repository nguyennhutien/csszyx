/**
 * The production guard on the warning analysis, pinned where nothing else can
 * pin it.
 *
 * `devWarn` refuses to print in production on its own, so a test that only
 * watches `console.warn` stays green even with the guard in `splitBoxUncached`
 * deleted — and deleting it is not free. The guard is what lets a bundler drop
 * `warnUnusableSplit` and every message string it holds: with the guard, an
 * app bundled for production carries none of that text; without it, the whole
 * analysis is reachable code that runs on every uncached split.
 *
 * So this file replaces `devWarn` with a spy that prints nothing and refuses
 * nothing. The only thing that can keep it uncalled is the caller's own guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const devWarn = vi.fn();

vi.mock('../src/dev-warn.js', () => ({
    devWarn,
    resetDevWarnCache: () => {},
}));

const { splitBox } = await import('../src/split-box.js');

/** A className that trips all three warnings, unique per test to skip the memo. */
const TRIPWIRE = 'rounded-xl overflow-y-auto hidden';

beforeEach(() => {
    devWarn.mockClear();
});

afterEach(() => {
    process.env.NODE_ENV = 'test';
});

describe('the warning analysis in a production build', () => {
    it('is never reached', () => {
        process.env.NODE_ENV = 'production';
        splitBox(`prod-only-1 ${TRIPWIRE}`);
        expect(devWarn).not.toHaveBeenCalled();
    });

    // The other half of the claim: with the guard open, this exact className
    // does reach the analysis. Without it the test above passes for any reason
    // at all — a typo in the className, a memo hit, a warning that never fires.
    it('is reached everywhere else', () => {
        process.env.NODE_ENV = 'development';
        splitBox(`dev-only-1 ${TRIPWIRE}`);
        expect(devWarn).toHaveBeenCalled();
    });
});

describe('the placement-name warning in a production build', () => {
    // The placement list is filtered before the partition runs and takes the
    // uncached path every time, so this is a separate guard from the one on
    // the warning analysis above and needs its own pin.
    it('is never reached', () => {
        process.env.NODE_ENV = 'production';
        splitBox('prod-only-2 md:hidden', { outer: ['md:hidden'] });
        expect(devWarn).not.toHaveBeenCalled();
    });

    it('is reached everywhere else', () => {
        process.env.NODE_ENV = 'development';
        splitBox('dev-only-2 md:hidden', { outer: ['md:hidden'] });
        expect(devWarn).toHaveBeenCalledWith(expect.stringContaining("'md:hidden' never matches"));
    });
});
