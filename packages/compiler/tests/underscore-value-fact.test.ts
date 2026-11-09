/**
 * The engine says which emitted class carries an `_` the author wrote.
 *
 * csszyx writes a space in an arbitrary value as `_`, so `content-['a_b']`
 * comes from `'a b'` as well as from `'a_b'`, and the class alone cannot tell
 * which. Tailwind reads that `_` as a space in most places, so `'a_b'` styles
 * `a b`. Whether it does is the project's Tailwind's answer, asked by the
 * build and `csszyx check` (PROJECT-RULES §4); the engine only reports the
 * fact, on every artifact, and judges nothing: it reports a `url()` too.
 */
import { describe, expect, it } from 'vitest';
import { escapeUnsafeChars } from '../../core/tests/helpers/sz-fuzz.js';
import { UNRENDERED_ENGINES } from './engine-parity-harness.js';

/** One `underscore-space` fact as the engine reports it. */
interface UnderscoreFact {
    key: string;
    value: string;
    className: string;
}

/**
 * @param sz - An `sz` object.
 * @returns A module that writes it on one element.
 */
function moduleOf(sz: Record<string, unknown>): string {
    return `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify(sz))}} />;`;
}

/**
 * The `underscore-space` facts of one `sz` object, on one artifact. They are
 * no diagnostic yet, so they stay out of `issues`: a lane that renders every
 * issue would print a verdict nobody asked Tailwind for.
 *
 * @param transform - The artifact's unrendered transform.
 * @param sz - The object.
 * @returns Its facts, in order.
 */
function factsOf(
    transform: (typeof UNRENDERED_ENGINES)[number][2],
    sz: Record<string, unknown>,
): UnderscoreFact[] {
    const result = transform(moduleOf(sz), { filename: '/p/src/Underscore.jsx' });
    expect((result.issues ?? []).map(issue => issue.code)).not.toContain('underscore-space');
    return (result.underscoreValues ?? []).map(({ key, value, className }) => ({
        key,
        value,
        className,
    }));
}

describe.each(UNRENDERED_ENGINES)('underscore-space on %s', (_name, rendered, transform) => {
    it.each([
        [{ content: "'a_b'" }, 'content', "'a_b'", "content-['a_b']"],
        [{ gridCols: '1fr_2fr' }, 'gridCols', '1fr_2fr', 'grid-cols-[1fr_2fr]'],
        [{ w: 'calc(100%_-_2rem)' }, 'w', 'calc(100%_-_2rem)', 'w-[calc(100%_-_2rem)]'],
        [{ bgImg: 'url(/a_b.png)' }, 'bgImg', 'url(/a_b.png)', 'bg-[url(/a_b.png)]'],
        [{ '--x': 'a_b' }, '--x', 'a_b', '[--x:a_b]'],
        // A colour object, at its `color`, as the class it is emitted as.
        [
            { bg: { color: 'oklch(0.5_0.1_10)', op: 50 } },
            'color',
            'oklch(0.5_0.1_10)',
            'bg-[oklch(0.5_0.1_10)]/50',
        ],
        // The class as emitted, its space already an `_`.
        [{ content: "'a b_c'" }, 'content', "'a b_c'", "content-['a_b_c']"],
    ])('reports %j', (sz, key, value, className) => {
        expect(factsOf(transform, sz)).toEqual([{ key, value, className }]);
    });

    it('reports the declaration a `css` object writes', () => {
        expect(factsOf(transform, { css: { content: "'a_b'" } })).toEqual([
            { key: 'content', value: "'a_b'", className: "[content:'a_b']" },
        ]);
    });

    it('places each fact at its key', () => {
        const result = transform(moduleOf({ p: 4, content: "'a_b'" }), {
            filename: '/p/src/Underscore.jsx',
        });
        expect(result.underscoreValues?.[0]).toMatchObject({ line: 1, column: 38 });
    });

    it('names the class with the project prefix, as the build emits it', () => {
        const result = transform(moduleOf({ content: "'a_b'" }), {
            filename: '/p/src/Underscore.jsx',
            classPrefix: 'tw',
        });
        expect(result.underscoreValues?.map(({ className }) => className)).toEqual([
            "tw:content-['a_b']",
        ]);
    });

    it('prints nothing for it on the lane that renders every issue', () => {
        const result = rendered(moduleOf({ content: "'a_b'" }), {
            filename: '/p/src/Underscore.jsx',
        });
        expect(result.diagnostics).toEqual([]);
    });

    it.each([
        // A space the author wrote: csszyx's own `_`.
        [{ content: "'a b'" }],
        [{ gridCols: '1fr 2fr' }],
        // An escaped underscore stays one on every Tailwind.
        [{ content: "'a\\_b'" }],
        // No brackets: a theme name, which Tailwind reads as written.
        [{ fontFamily: 'my_font' }],
        // No underscore.
        [{ p: 4 }],
    ])('reports nothing for %j', sz => {
        expect(factsOf(transform, sz)).toEqual([]);
    });
});
