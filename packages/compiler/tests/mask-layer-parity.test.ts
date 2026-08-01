/**
 * Mask layer parity across the three engines.
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
import { describe, expect, it } from 'vitest';

import {
    isRustTransformAvailable,
    transformOxc,
    transformRust,
    transformSourceCode,
} from '../src/index.js';

type Transform = typeof transformSourceCode;

const ENGINES: ReadonlyArray<readonly [string, Transform]> = [
    ['babel', transformSourceCode],
    ['oxc', transformOxc],
    ...(isRustTransformAvailable() ? ([['rust', transformRust]] as const) : []),
];

/**
 * Transform one sz literal on every engine and assert they agree.
 *
 * @param sz - The sz object source, as written in JSX.
 * @param expected - The className every engine must emit.
 */
function expectParity(sz: string, expected: string): void {
    const source = `export const A = () => <div sz={${sz}} />;`;
    for (const [name, transform] of ENGINES) {
        const code = transform(source, 'mask-layer.tsx').code ?? '';
        const emitted = /className="([^"]*)"/.exec(code)?.[1] ?? '';
        expect(emitted, `${name} — ${sz}`).toBe(expected);
    }
}

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
    });
});
