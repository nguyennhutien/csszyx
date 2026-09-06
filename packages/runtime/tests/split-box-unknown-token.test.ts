/**
 * A class csszyx does not recognise gets the exclusive policy: `pick` does not
 * return it, `omit` keeps it, and `splitBox` leaves it on the fallback node.
 * That is a decision, not a gap — a custom `@utility` that declares margin AND
 * padding has no correct side, and the only way to be right would be to rewrite
 * the author's CSS. See
 * `.agent/decisions/0021-atomic-only-class-vocabulary.md`.
 *
 * What the decision owes the author is the other half: being TOLD, and having a
 * way to place the token by hand. Neither existed — `{ inner: ['card'] }` was
 * silently inert, because selector matching returned `false` before reading the
 * selector whenever the token was unclassified.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDevWarnCache } from '../src/dev-warn.js';
import { omit, pick, splitBox } from '../src/split-box.js';

describe('placing an unrecognised token by hand', () => {
    it('honours an exact name in the inner list', () => {
        expect(splitBox('card p-4', { inner: ['card'] })).toEqual({
            outer: '',
            inner: 'card p-4',
        });
    });

    it('honours an exact name in the outer list against an inner fallback', () => {
        expect(splitBox('card p-4', { fallback: 'inner', outer: ['card'] })).toEqual({
            outer: 'card',
            inner: 'p-4',
        });
    });

    it('reads through a variant to the base name', () => {
        expect(splitBox('md:card p-4', { inner: ['card'] })).toEqual({
            outer: '',
            inner: 'md:card p-4',
        });
    });

    it('matches the whole name only, never a prefix', () => {
        // csszyx knows nothing about an unrecognised token's structure, so
        // reading `card` as a prefix of `card-lg` would be a guess.
        expect(splitBox('card-lg p-4', { inner: ['card'] })).toEqual({
            outer: 'card-lg',
            inner: 'p-4',
        });
    });

    it('does not turn a query selector into a literal name', () => {
        // `pick`/`omit` ask a category question, where an unknown string is far
        // more likely to be a typo than a custom utility — that warning is a
        // deliberate feature and the escape hatch must not cost it. Placement
        // is the other case: there the caller is naming a class they wrote.
        expect(pick('card p-4', 'card')).toBe('');
        expect(omit('card p-4', 'card')).toBe('card p-4');
    });
});

describe('warning that a token was placed by the fallback', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        resetDevWarnCache();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warn.mockRestore();
    });

    /** @returns Every warning message that names `splitBox`. */
    const messages = (): string[] =>
        warn.mock.calls.map(call => String(call[0])).filter(m => m.includes('splitBox'));

    it('names the token it could not classify', () => {
        splitBox('card p-4');
        expect(messages().join('\n')).toContain("'card'");
    });

    it('says which node the token landed on', () => {
        // A distinct className per test on purpose: the whole-partition memo
        // means an identical string never re-enters the uncached path, so a
        // repeated call is silent by design and `devWarn` dedupes on top.
        splitBox('panel p-4');
        expect(messages().join('\n')).toContain('frame');
    });

    it('points at the option that places it by hand', () => {
        splitBox('sheet p-4');
        expect(messages().join('\n')).toContain("inner: ['sheet']");
    });

    it('stays quiet when the caller already placed the token', () => {
        splitBox('card p-4', { inner: ['card'] });
        expect(messages()).toEqual([]);
    });

    it('stays quiet for a className csszyx fully understands', () => {
        splitBox('m-4 p-2 md:flex');
        expect(messages()).toEqual([]);
    });

    it('names every unrecognised token, not just the first', () => {
        splitBox('card widget p-4');
        const all = messages().join('\n');
        expect(all).toContain("'card'");
        expect(all).toContain("'widget'");
    });
});
