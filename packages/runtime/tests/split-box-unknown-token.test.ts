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
import { clearMangleRegistry, installMangleRuntime } from '../src/mangle-registry.js';
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

    it('pins a name the caller wrote even against a mangled className', () => {
        // The DOM carries the mangled token, the author's options object
        // carries the name they wrote. `tokenBase` decodes before comparing, so
        // the placement list is written in the source spelling — the only one
        // the author can know.
        installMangleRuntime({ mangleMap: { widget: 'a1' }, checksum: 'x' });
        try {
            expect(splitBox('a1 p-4', { inner: ['widget'] })).toEqual({
                outer: '',
                inner: 'a1 p-4',
            });
        } finally {
            clearMangleRegistry();
        }
    });

    it('still honours an object selector in the same list', () => {
        // Accepting a literal class name did not replace the selector forms a
        // placement list already took — an object selector is still validated,
        // and still matches by category and value.
        expect(splitBox('overflow-hidden p-4', { inner: [{ overflow: 'hidden' }] })).toEqual({
            outer: '',
            inner: 'overflow-hidden p-4',
        });
    });

    it('ignores an empty name in a placement list', () => {
        // An empty string would otherwise match every token whose base is also
        // empty, which is how a malformed `md:` reaches a node it was not sent
        // to.
        expect(splitBox('md: p-4', { inner: [''] })).toEqual({ outer: 'md:', inner: 'p-4' });
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

    it.each([
        ['outer', { outer: ['placed1'] }, 'placed1'],
        ['inner', { fallback: 'inner' as const, inner: ['placed2'] }, 'placed2'],
    ])(
        'stays quiet when the caller placed the token on the %s node, which is also the fallback',
        (_side, options, token) => {
            // The combination the first test cannot see: a deliberate placement
            // onto the side the fallback would have chosen anyway. Reporting it
            // does not just add noise — the help line tells the author to move
            // the class to the OTHER node, undoing a decision they made.
            splitBox(`${token} p-4`, options);
            expect(messages()).toEqual([]);
        },
    );

    it('does not name a token whose base is empty', () => {
        // `md:` and `!` normalise to nothing, so there is no class to name and
        // no placement list that could hold one.
        splitBox('md: p-1');
        expect(messages()).toEqual([]);
    });

    it('accepts a placement name the className does not happen to carry', () => {
        // A component builds its options once and splits many classNames. A
        // render without `shared1` must not report the name as a typo.
        splitBox('p-4 m-2', { inner: ['shared1'] });
        expect(warn.mock.calls.map(c => String(c[0]))).toEqual([]);
    });

    it('stays quiet for a className csszyx fully understands', () => {
        splitBox('m-4 p-2 md:flex');
        expect(messages()).toEqual([]);
    });

    it.each(['md:hidden', 'hover:hidden', '[&:hover]:hidden', '!hidden', 'hidden!'])(
        'explains why the variant-qualified placement %s cannot match',
        selector => {
            expect(splitBox(`${selector} p-4`, { outer: [selector] })).toEqual({
                outer: '',
                inner: `${selector} p-4`,
            });
            expect(messages().join('\n')).toContain(`'${selector}'`);
            expect(messages().join('\n')).toContain("outer: ['hidden']");
        },
    );

    it('names the base for a negative placement too', () => {
        // `-mt-4` is margin and routes outer on its own; the point is the
        // message, which must name `mt-4` — the form that would have matched.
        splitBox('-mt-4 p-4', { inner: ['-mt-4'] });
        expect(messages().join('\n')).toContain("'-mt-4'");
        expect(messages().join('\n')).toContain("inner: ['mt-4']");
    });

    it('does not mistake a colon in an arbitrary value for a variant', () => {
        splitBox('[color:red] p-4', { inner: ['[color:red]'] });
        expect(messages()).toEqual([]);
    });

    it('names every unrecognised token, not just the first', () => {
        splitBox('card widget p-4');
        const all = messages().join('\n');
        expect(all).toContain("'card'");
        expect(all).toContain("'widget'");
    });
});
