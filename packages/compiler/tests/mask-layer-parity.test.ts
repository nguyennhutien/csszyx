/**
 * Mask layer parity across both engine artifacts.
 *
 * `mask-image` composites three custom properties, so the sz surface is one key
 * per layer and the lowering has to reproduce Tailwind's naming exactly: stops
 * split a position from a colour, a bare CSS variable reads as a position while
 * a colour needs the `(color:--x)` hint, and several keyword mappings are
 * renamed or re-prefixed by Tailwind.
 *
 * Every shape here is pinned lane-for-lane rather than against one engine. The
 * parity corpus carries no fixture for these shapes, which is exactly how the
 * negative-hoist divergence reached a release before, so the guard has to be a
 * test that names the shapes directly.
 */
import { describe, it } from 'vitest';

import { ENGINES, expectParity } from './engine-parity-harness.js';

describe('mask layers — three-engine parity', () => {
    it('linear angles, including the negative and variable forms', () => {
        expectParity('{ maskLinear: { angle: 45 } }', 'mask-linear-45');
        expectParity('{ maskLinear: { angle: -45 } }', '-mask-linear-45');
        expectParity("{ maskLinear: { angle: '--a' } }", 'mask-linear-(--a)');
    });

    it('layer stops', () => {
        expectParity(
            "{ maskLinear: { angle: 45, from: '20%', to: '80%' } }",
            'mask-linear-45 mask-linear-from-20% mask-linear-to-80%',
        );
        expectParity(
            "{ maskConic: { from: '20%', to: '80%' } }",
            'mask-conic-from-20% mask-conic-to-80%',
        );
    });

    it('a stop splits its position from its colour — separate custom properties', () => {
        expectParity(
            "{ maskLinear: { from: { at: '20%', color: 'red-500' } } }",
            'mask-linear-from-20% mask-linear-from-red-500',
        );
        expectParity(
            "{ maskLinear: { from: { color: 'red-500', op: 30 } } }",
            'mask-linear-from-red-500/30',
        );
    });

    it('a bare variable is a position; a colour variable takes the type hint', () => {
        expectParity("{ maskLinear: { b: { from: { at: '--c' } } } }", 'mask-b-from-(--c)');
        expectParity(
            "{ maskLinear: { b: { from: { color: '--c' } } } }",
            'mask-b-from-(color:--c)',
        );
    });

    it('sides compose, and x/y write two each', () => {
        expectParity(
            "{ maskLinear: { t: { from: '0%' }, b: { from: '60%' } } }",
            'mask-t-from-0% mask-b-from-60%',
        );
        expectParity(
            "{ maskLinear: { b: { from: '20%', to: '80%' } } }",
            'mask-b-from-20% mask-b-to-80%',
        );
        expectParity("{ maskLinear: { x: { from: '20%' } } }", 'mask-x-from-20%');
        expectParity("{ maskLinear: { y: { to: '90%' } } }", 'mask-y-to-90%');
    });

    it('radial modifiers compose with its stops', () => {
        expectParity(
            "{ maskRadial: { at: 'top', shape: 'circle', from: '0%', to: '100%' } }",
            'mask-radial-at-top mask-circle mask-radial-from-0% mask-radial-to-100%',
        );
        expectParity("{ maskRadial: { size: 'closest-side' } }", 'mask-radial-closest-side');
    });

    it('the renamed and re-prefixed keyword mappings', () => {
        // A blanket `mask-<value>` emitted names Tailwind does not serve for
        // every one of these.
        expectParity("{ maskSize: '50%' }", 'mask-size-[50%]');
        expectParity("{ maskSize: '--s' }", 'mask-size-(--s)');
        expectParity("{ maskPos: 'center_top_1rem' }", 'mask-position-[center_top_1rem]');
        expectParity("{ maskPos: '--p' }", 'mask-position-(--p)');
        expectParity("{ maskRepeat: 'space' }", 'mask-repeat-space');
        expectParity("{ maskRepeat: 'round' }", 'mask-repeat-round');
        expectParity("{ maskClip: 'no-clip' }", 'mask-no-clip');
        expectParity("{ maskMode: 'match-source' }", 'mask-match');
    });

    it('keeps the keyword forms that were already right', () => {
        expectParity("{ maskSize: 'cover' }", 'mask-cover');
        expectParity("{ maskPos: 'top-left' }", 'mask-top-left');
        expectParity("{ maskRepeat: 'repeat-x' }", 'mask-repeat-x');
        expectParity("{ maskClip: 'content' }", 'mask-clip-content');
        expectParity("{ maskType: 'alpha' }", 'mask-type-alpha');
        expectParity("{ maskComposite: 'add' }", 'mask-add');
    });

    it('a gradient value on `mask` emits nothing — it moved to its layer key', () => {
        for (const value of ['linear-45', '-linear-45', 'radial', 'linear-to-tr', 'conic-90']) {
            expectParity(`{ mask: '${value}' }`, '');
        }
    });

    it('keeps the direct mask-image forms on `mask`', () => {
        expectParity("{ mask: 'none' }", 'mask-none');
        expectParity("{ mask: '--m' }", 'mask-(--m)');
        expectParity('{ mask: "url(\'/i.png\')" }', "mask-[url('/i.png')]");
    });

    it('brackets a gradient FUNCTION instead of reading it as a layer name', () => {
        // `linear-gradient(…)` shares the `linear-` opening with the layer
        // keywords, so the layer check has to exclude CSS functions — and the
        // bracket predicate has to cover them, or the class is
        // `mask-linear-gradient(…)`, which Tailwind does not serve.
        expectParity(
            "{ mask: 'linear-gradient(to_right,black,transparent)' }",
            'mask-[linear-gradient(to_right,black,transparent)]',
        );
        expectParity(
            "{ mask: 'radial-gradient(circle,black)' }",
            'mask-[radial-gradient(circle,black)]',
        );
        expectParity(
            "{ mask: 'conic-gradient(from_90deg,black)' }",
            'mask-[conic-gradient(from_90deg,black)]',
        );
    });
});

describe('mask layer merge — the later group claims the CSS property', () => {
    /**
     * Assert the merged output of a static array on every engine.
     *
     * @param elements - The array elements, as written in JSX.
     * @param expected - The className every engine must emit.
     */
    function expectMergeParity(elements: string, expected: string): void {
        const source = `export const A = () => <div sz={${elements}} />;`;
        for (const [name, transform] of ENGINES) {
            const code = transform(source, 'mask-merge.tsx').code ?? '';
            const emitted = /className="([^"]*)"/.exec(code)?.[1] ?? '';
            expect(emitted, `${name} — ${elements}`).toBe(expected);
        }
    }

    // The angle fields and the side fields both write --tw-mask-linear, so a
    // deep merge that kept both would leave the stylesheet to pick a winner by
    // source order instead of by the author's later declaration.
    it('a later side declaration clears the angle mode', () => {
        expectMergeParity(
            "[{ maskLinear: { angle: 45, from: '20%' } }, { maskLinear: { b: { from: '0%' } } }]",
            'mask-b-from-0%',
        );
    });

    it('a later angle declaration clears the sides', () => {
        expectMergeParity(
            "[{ maskLinear: { b: { from: '0%', to: '100%' } } }, { maskLinear: { angle: 45 } }]",
            'mask-linear-45',
        );
    });

    it('within one mode, only the declared field is replaced', () => {
        expectMergeParity(
            "[{ maskLinear: { angle: 45, from: '20%' } }, { maskLinear: { from: '40%' } }]",
            'mask-linear-45 mask-linear-from-40%',
        );
        expectMergeParity(
            "[{ maskLinear: { b: { from: '20%', to: '80%' } } }, { maskLinear: { b: { from: '40%' } } }]",
            'mask-b-from-40% mask-b-to-80%',
        );
    });

    it('sides that do not collide still compose across elements', () => {
        expectMergeParity(
            "[{ maskLinear: { t: { from: '0%' } } }, { maskLinear: { b: { from: '60%' } } }]",
            'mask-t-from-0% mask-b-from-60%',
        );
    });

    it('a different layer is untouched — it owns another variable', () => {
        expectMergeParity(
            "[{ maskLinear: { angle: 45 } }, { maskRadial: { from: '0%' } }]",
            'mask-linear-45 mask-radial-from-0%',
        );
    });

    // The exclusion is a MERGE rule, so it needs two objects to apply. Inside
    // one literal there is nothing to merge and both modes emit, leaving the
    // stylesheet to pick a winner — the shape a caution block warns about
    // rather than one the compiler can resolve.
    it('does not apply inside a single literal, where nothing merges', () => {
        expectParity(
            "{ maskLinear: { angle: 45, b: { from: '0%' } } }",
            'mask-linear-45 mask-b-from-0%',
        );
    });

    it('applies inside a variant, where the variant objects merge first', () => {
        expectMergeParity(
            "[{ hover: { maskLinear: { angle: 45 } } }, { hover: { maskLinear: { b: { from: '0%' } } } }]",
            'hover:mask-b-from-0%',
        );
    });

    it('an empty later slot claims nothing', () => {
        // `{}` carries no field, so the merge has nothing to override with —
        // an empty object must not read as "clear this layer".
        expectMergeParity('[{ maskLinear: { angle: 45 } }, { maskLinear: {} }]', 'mask-linear-45');
    });

    it('a direct mask image and a layer both survive — different properties', () => {
        // `mask` sets mask-image outright while the layers compose through
        // --tw-mask-*, so these are not competitors and neither is dropped.
        expectParity("{ mask: 'none', maskLinear: { angle: 45 } }", 'mask-none mask-linear-45');
    });

    it('a shorthand side and the side it covers both survive, in table order', () => {
        // `x` covers `l`/`r` the way `px` covers `pl`/`pr`: each writes its own
        // variable, so both are kept. The emission order follows the side
        // table (t r b l x y), not the declaration order.
        expectParity(
            "{ maskLinear: { x: { from: '10%' }, l: { from: '20%' } } }",
            'mask-l-from-20% mask-x-from-10%',
        );
    });
});
