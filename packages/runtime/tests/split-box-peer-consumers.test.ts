/**
 * A `peer-*` rule reaches its target through the general sibling combinator.
 * Measured on `tailwindcss@4.3.3`, every served `peer-*` variant compiles to
 * the shape `:is(:where(.peer):hover ~ *)`, and `not-peer-*` to its negation;
 * `group-*`, `has-*` and `in-*` do not use `~`.
 *
 * `splitBox` renders the inner node as a CHILD of the outer one, so the inner
 * node is a sibling of nothing the author wrote. A `peer-*` utility whose base
 * belongs inside — `peer-hover:p-4` is padding — therefore landed on a node its
 * own selector could never match, and did so silently. Worse, `not-peer-*`
 * there is permanently ON, because the negation of an impossible match is
 * always true. The only node where such a rule can apply is the outer one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDevWarnCache } from '../src/dev-warn.js';
import { classify, pick, splitBox } from '../src/split-box.js';

describe('a peer consumer routes to the node its selector can reach', () => {
    it.each([
        'peer-hover:p-4',
        'peer-checked:block',
        'peer-focus:text-red-500',
        'peer-hover/email:p-4',
        'not-peer-hover:p-4',
        'md:peer-checked:block',
        'peer-hover:md:p-4',
    ])('%s goes to the frame', token => {
        expect(classify(token)?.role).toBe('outer');
        const { outer, inner } = splitBox(`${token} p-2`);
        expect(outer.split(' ')).toContain(token);
        expect(inner).toBe('p-2');
    });

    it('keeps the category, so a category query still finds it', () => {
        expect(classify('peer-hover:p-4')).toMatchObject({ role: 'outer', category: 'padding' });
        expect(pick('peer-hover:p-4 m-2', 'padding')).toBe('peer-hover:p-4');
    });

    it.each(['group-hover:p-4', 'has-[a]:p-4', 'in-focus:p-4', '[.peer:hover_&]:p-4'])(
        'leaves %s inside — its rule reaches descendants, not siblings',
        token => {
            expect(classify(token)?.role).toBe('inner');
        },
    );

    it('leaves a marker where the marker rule put it', () => {
        expect(splitBox('peer p-2')).toEqual({ outer: 'peer', inner: 'p-2' });
    });

    it('does not move a property that already belongs outside', () => {
        expect(classify('peer-hover:bg-red-500')).toMatchObject({ role: 'outer', category: 'bg' });
    });
});

describe('the move is said, not silent', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        resetDevWarnCache();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());
    const messages = (): string[] =>
        warn.mock.calls.map(c => String(c[0])).filter(m => m.includes('splitBox'));

    it('names the token that stayed on the frame and why', () => {
        splitBox('peer-hover:p-4 m-2');
        const all = messages().join('\n');
        expect(all).toContain("'peer-hover:p-4'");
        expect(all).toContain('sibling');
    });

    it('offers the arbitrary variant that reaches the content from the frame', () => {
        // A distinct className per test: the partition memo serves a repeat
        // without re-running the analysis, so a repeat is silent by design.
        splitBox('peer-hover:p-4 m-3');
        expect(messages().join('\n')).toContain('peer-hover:[&>*]:p-4');
    });

    it('splits at the variant boundary, not at a colon inside a value', () => {
        // `text-[length:2rem]` is a font size, so it belongs inside and moves;
        // the colon in its value must not be mistaken for the variant boundary.
        splitBox('peer-hover:text-[length:2rem] m-4');
        expect(messages().join('\n')).toContain('peer-hover:[&>*]:text-[length:2rem]');
    });

    it('stays quiet when nothing had to move', () => {
        splitBox('peer-checked:bg-red-500 p-2');
        expect(messages()).toEqual([]);
    });
});
