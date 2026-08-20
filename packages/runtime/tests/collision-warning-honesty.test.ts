/**
 * What the collision warning promises, measured against what happens.
 *
 * The message told authors that a shadowed token "keeps the safe keep-both
 * behaviour". Keep-both is not safe when the two classes set the SAME CSS
 * property, which is exactly what a shadowing colour token produces: measured
 * on tailwindcss 4.3.3, declaring `--color-balance` makes `.text-balance` carry
 * BOTH `text-wrap: balance` and `color: var(--color-balance)`, so it competes
 * with any other colour class on `color`.
 *
 * szcn's contract is that the last argument wins. With both classes kept, the
 * winner is decided by stylesheet order instead — and `.text-red-500` is
 * emitted after `.text-balance`, so `szcn('text-red-500', 'text-balance')`
 * renders red. The author gets the opposite colour, having been told the
 * fallback was safe.
 *
 * Keeping both is still the right FALLBACK — dropping one would guess. What
 * was wrong was calling it safe.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearSzcnGroups, registerSzcnGroups, szcn } from '../src/index.js';

// A DIFFERENT colliding token per case. The warning is emitted through
// `warnOnce`, which keys on the message, so reusing one name would leave the
// second case asserting against a warning that was suppressed rather than one
// that was never produced.
describe('the warning for a token that shadows a built-in', () => {
    afterEach(() => {
        clearSzcnGroups();
        vi.restoreAllMocks();
    });

    it('does not call the fallback safe, because it is not', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        registerSzcnGroups({ colors: ['balance'] }, 'honesty-test');

        const message = warn.mock.calls.map(call => String(call[0])).join('\n');
        expect(message).toContain('shadows a built-in');
        expect(message).not.toContain('safe keep-both');
    });

    it('says what the author actually loses — the argument order stops deciding', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        registerSzcnGroups({ colors: ['collapse'] }, 'honesty-test-2');

        const message = warn.mock.calls.map(call => String(call[0])).join('\n');
        expect(message).toContain('stylesheet order');
    });

    it('still keeps both classes, which remains the right fallback', () => {
        // Dropping one would be a guess. The fix is the wording, not the
        // behaviour — this locks the behaviour so the next edit cannot
        // "fix" the warning by changing what it warns about.
        registerSzcnGroups({ colors: ['balance'] }, 'honesty-test-3');

        expect(szcn('text-red-500', 'text-balance')).toBe('text-red-500 text-balance');
    });
});
