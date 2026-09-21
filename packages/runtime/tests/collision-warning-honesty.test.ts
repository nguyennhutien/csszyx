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
 * `szcn` merges on the compiled CSS, so it reads that class correctly: it sets
 * `color` and the two `text-wrap` longhands. A colour class written AFTER it
 * covers only one of those, so both classes stay, both set `color`, and the
 * stylesheet's order picks the winner rather than the order of the arguments.
 * Written BEFORE it, the colour class is covered and dropped, which is right.
 *
 * The warning used to blame `szcn` for not telling the two meanings apart. It
 * can; what it cannot do is make one class stop meaning two things. The
 * registry the warning comes from now feeds `classify` only, and the message
 * has to say what is true of both.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    clearSzcnGroups,
    registerMergeSignatures,
    registerSzcnGroups,
    szcn,
} from '../src/index.js';
import { __resetMergeSignaturesForTests } from '../src/merge-signatures.js';

// A DIFFERENT colliding token per case. The warning is emitted through
// `warnOnce`, which keys on the message, so reusing one name would leave the
// second case asserting against a warning that was suppressed rather than one
// that was never produced.
describe('the warning for a token that shadows a built-in', () => {
    afterEach(() => {
        clearSzcnGroups();
        __resetMergeSignaturesForTests();
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

    it('names the helper the registry still feeds, not the one that no longer reads it', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        registerSzcnGroups({ colors: ['cover'] }, 'honesty-test-4');

        const message = warn.mock.calls.map(call => String(call[0])).join('\n');
        expect(message).toContain('`classify`');
        expect(message).not.toContain('szcn cannot');
    });

    it('describes what szcn does with the class the token produces', () => {
        // The signatures Tailwind 4.3.3 compiles with `--color-balance`
        // declared: `text-balance` sets `color` and both `text-wrap` longhands,
        // so it covers a colour class and a colour class does not cover it.
        registerMergeSignatures([{ 'text-red-500': 0, 'text-balance': 1 }, [[0], [0, 1]]]);

        expect(szcn('text-red-500', 'text-balance')).toBe('text-balance');
        // Both set `color` here, and the stylesheet's order decides: the case
        // the warning tells the author about.
        expect(szcn('text-balance', 'text-red-500')).toBe('text-balance text-red-500');
    });
});

describe('the warning for a token declared in two categories', () => {
    afterEach(() => {
        clearSzcnGroups();
        vi.restoreAllMocks();
    });

    it.each([
        [{ colors: ['honest-a'], textSizes: ['honest-a'] }, 'text-honest-a'],
        [{ fontFamilies: ['honest-b'], fontWeights: ['honest-b'] }, 'font-honest-b'],
    ])('says classify cannot name the property, and leaves szcn out of it', (groups, cls) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        registerSzcnGroups(groups, 'honesty-test-5');

        const message = warn.mock.calls.map(call => String(call[0])).join('\n');
        expect(message).toContain(`\`${cls}\``);
        expect(message).toContain('`classify`');
        expect(message).not.toContain('szcn');
    });
});
