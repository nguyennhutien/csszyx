/**
 * `classify` reads the className string the APP wrote, not the one csszyx
 * emitted. The generated table is built from `PROPERTY_MAP`, so it knows every
 * utility csszyx can emit and nothing else — and those two sets are not equal.
 *
 * Three families measured missing against the pinned corpora in
 * `scripts/corpus/` (flowbite, shadcn, tremor) and confirmed served by the
 * installed `tailwindcss@4.3.3` compiler:
 *
 * - `placeholder-<color>` styles `::placeholder` directly. csszyx models the
 *   same CSS as a VARIANT (`placeholder:text-gray`), so no `PROPERTY_MAP` key
 *   ever emits the utility form and the table never learned it.
 * - `start-*` / `end-*` are the pre-v4.2 spelling of `inset-s-*` / `inset-e-*`.
 *   Deprecated upstream, still served, still all over existing code.
 * - `group` / `peer` emit no CSS at all, so no table built from CSS properties
 *   can contain them — but they are the anchor every `group-hover:` and
 *   `peer-checked:` utility resolves against, which makes WHICH NODE they land
 *   on a correctness question, not a classification one. The two anchor
 *   differently, measured on `tailwindcss@4.3.3`: `group` is a descendant
 *   relationship (`:is(:where(.group):hover *)`) and `peer` a general-sibling
 *   one (`:is(:where(.peer):hover ~ *)`).
 */
import { describe, expect, it } from 'vitest';
import { szcn } from '../src/merge-classes.js';
import { classify, pick, splitBox } from '../src/split-box.js';

describe('placeholder utilities', () => {
    it('classifies the utility form Tailwind still serves', () => {
        expect(classify('placeholder-gray-400')).toEqual({
            role: 'inner',
            category: 'placeholder',
        });
    });

    it('keeps the variant form on the category it lowers to', () => {
        // `placeholder:text-gray-400` IS text styling behind a pseudo-element
        // variant; only the bare utility gets the placeholder category.
        expect(classify('placeholder:text-gray-400')).toEqual({
            role: 'inner',
            category: 'text',
            property: 'color',
        });
    });

    it('survives a filter that does not name it', () => {
        expect(pick('p-4 placeholder-gray-400', 'padding')).toBe('p-4');
    });
});

describe('logical inset aliases', () => {
    it.each([
        ['start-2', 'start'],
        ['end-2', 'end'],
        ['end-2.5', 'end'],
        ['-start-2', 'negative start'],
        ['md:end-4', 'responsive end'],
    ])('classifies %s (%s) the way inset-e-* is classified', token => {
        expect(classify(token)).toEqual({ role: 'outer', category: 'position' });
    });

    it('does not drop the alias from a position filter', () => {
        expect(pick('top-2 end-2', 'position')).toBe('top-2 end-2');
    });

    it('leaves a longer word starting with the same letters alone', () => {
        expect(classify('ending-soon')).toBeUndefined();
    });
});

describe('scope markers', () => {
    it.each(['group', 'peer'])('classifies %s as an outer scope marker', token => {
        expect(classify(token)).toEqual({ role: 'outer', category: 'scope' });
    });

    it.each(['group/item', 'peer/email'])('classifies the named form %s too', token => {
        expect(classify(token)).toEqual({ role: 'outer', category: 'scope' });
    });

    it('pins group to the ancestor even when the fallback says inner', () => {
        // `group-hover:bg-red-500` is a bg utility, so it routes OUTER. If the
        // fallback carried `group` to the inner node the marker would no longer
        // be an ancestor of its own dependent, and the hover would stop firing.
        const { outer, inner } = splitBox('group relative p-4 group-hover:bg-red-500', {
            fallback: 'inner',
        });
        expect(outer.split(' ')).toContain('group');
        expect(inner.split(' ')).not.toContain('group');
    });

    it('pins peer to the sibling position even when the fallback says inner', () => {
        // `peer` reaches its dependents through `~`, not through descent, so
        // the question is not ancestry but position among siblings. The outer
        // node holds the position the author gave it; the inner node is a CHILD
        // of that box and a sibling of nothing the author wrote.
        const { outer, inner } = splitBox('peer p-4', { fallback: 'inner' });
        expect(outer.split(' ')).toContain('peer');
        expect(inner.split(' ')).not.toContain('peer');
    });

    it('does not treat an opacity modifier as a named marker', () => {
        expect(classify('bg-red-500/50')).toEqual({
            role: 'outer',
            category: 'bg',
            property: 'color',
        });
    });
});

describe('szcn reads the same table', () => {
    it('merges two spellings of the same alias', () => {
        expect(szcn('end-2', 'end-4')).toBe('end-4');
    });

    it('merges two placeholder colours', () => {
        expect(szcn('placeholder-gray-400', 'placeholder-red-500')).toBe('placeholder-red-500');
    });

    it('keeps a named marker beside the bare one', () => {
        // `group` and `group/item` are two different anchors — a
        // `group-hover/item:` descendant reads only the named one, so dropping
        // either would silently unhook a variant.
        expect(szcn('group', 'group/item')).toBe('group group/item');
    });

    it('keeps both spellings of the same logical inset', () => {
        // `start-*` and `inset-s-*` are the same CSS under two prefixes, so the
        // table cannot see them as one group and both survive the merge.
        //
        // Keeping both is conservative in the sense that nothing is deleted,
        // but it does NOT mean the author's order wins: the two selectors have
        // equal specificity, so the STYLESHEET decides, and Tailwind 4.3.3
        // emits `.inset-s-4` before `.start-2`. Writing `inset-s-4` last to
        // override a `start-2` silently loses. Merging them would need the two
        // prefixes declared as one group, which is `szcn`'s question, not this
        // table's.
        expect(szcn('start-2', 'inset-s-4')).toBe('start-2 inset-s-4');
    });
});
