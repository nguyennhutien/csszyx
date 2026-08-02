/**
 * Edge cases of the mask layers and the gradient-function family.
 *
 * These are the shapes that behaved unexpectedly while the layer surface was
 * being built, or that a plausible refactor would silently break. They are
 * pinned separately from `mask-layer-parity.test.ts` because that file
 * describes the intended surface, while these describe the corners: falsy
 * values that must not read as absent, empty objects that must emit nothing
 * rather than a stray prefix, and the CSS-function-versus-keyword confusion
 * that produced dead classes in two different predicates.
 *
 * Every case is asserted lane for lane. A divergence in a corner is the kind
 * the parity corpus carries no fixture for.
 */
import { describe, it } from 'vitest';

import { expectParity } from './tri-engine-harness.js';

describe('mask layers — a variant prefixes EVERY emitted class', () => {
    // A layer key emits several classes from one property, unlike every other
    // structured value, which emits one. Joining them and prefixing once would
    // put the variant on the first class only and leave the rest global.
    it('prefixes each class of a multi-class layer', () => {
        expectParity(
            "{ hover: { maskLinear: { b: { from: '0%', to: '100%' } } } }",
            'hover:mask-b-from-0% hover:mask-b-to-100%',
        );
        expectParity(
            "{ md: { maskRadial: { at: 'top', shape: 'circle', from: '0%' } } }",
            'md:mask-radial-at-top md:mask-circle md:mask-radial-from-0%',
        );
    });

    it('keeps a stacked variant chain on every class', () => {
        expectParity(
            "{ dark: { hover: { maskLinear: { t: { from: '0%' }, b: { from: '50%' } } } } }",
            'dark:hover:mask-t-from-0% dark:hover:mask-b-from-50%',
        );
    });
});

describe('mask layers — falsy values that are real values', () => {
    // Zero is a legitimate angle and a legitimate stop. A truthiness check
    // anywhere on these paths would drop them.
    it('emits a zero angle and a zero stop', () => {
        expectParity('{ maskLinear: { angle: 0 } }', 'mask-linear-0');
        expectParity('{ maskLinear: { b: { from: 0 } } }', 'mask-b-from-0');
        expectParity('{ maskConic: { angle: 0 } }', 'mask-conic-0');
    });
});

describe('mask layers — empty and incomplete shapes emit nothing', () => {
    // Each of these could plausibly leak a bare prefix such as `mask-b-from-`
    // if a branch built the class before checking it had a value.
    it('emits nothing for an empty layer, edge or stop', () => {
        expectParity('{ maskLinear: {} }', '');
        expectParity('{ maskLinear: { b: {} } }', '');
        expectParity('{ maskLinear: { b: { from: {} } } }', '');
        expectParity('{ maskRadial: {} }', '');
        expectParity('{ maskConic: {} }', '');
    });

    it('emits nothing for a stop that is explicitly absent', () => {
        expectParity('{ maskLinear: { b: { from: false } } }', '');
        expectParity('{ maskLinear: { b: { from: null } } }', '');
    });

    it('emits nothing for an opacity with no colour to apply it to', () => {
        // `op` modifies a colour; alone it has nothing to attach to, and
        // emitting `mask-b-from-/30` would be a dead class.
        expectParity('{ maskLinear: { b: { from: { op: 30 } } } }', '');
    });
});

describe('gradient FUNCTION versus gradient KEYWORD', () => {
    // Both open with `linear-`/`radial`/`conic`. Two separate predicates read
    // the opening and mistook a function for a keyword, each producing a class
    // Tailwind does not serve — on `mask` it was `mask-linear-gradient…`, on
    // `bgImg` it was `bg-linear-gradient…`.
    it('brackets a function on mask, keeps the keyword path for layers', () => {
        expectParity(
            "{ mask: 'linear-gradient(to_right,black,transparent)' }",
            'mask-[linear-gradient(to_right,black,transparent)]',
        );
        // A negative marker in front of a function belongs INSIDE the brackets;
        // it is part of the value, not a Tailwind negative utility.
        expectParity(
            "{ mask: '-linear-gradient(to_right,black,transparent)' }",
            'mask-[-linear-gradient(to_right,black,transparent)]',
        );
    });

    it('brackets a function on bgImg without wrapping it in a url', () => {
        expectParity(
            "{ bgImg: 'conic-gradient(from_90deg,red,blue)' }",
            'bg-[conic-gradient(from_90deg,red,blue)]',
        );
    });

    it('still treats a path that merely LOOKS like a gradient as a url', () => {
        // No parentheses, so it is a plain image path despite the name.
        expectParity("{ bgImg: '/linear-gradient.png' }", 'bg-[url(/linear-gradient.png)]');
    });

    it('leaves an explicit url alone rather than double-wrapping it', () => {
        expectParity("{ bgImg: 'url(/i.png)' }", 'bg-[url(/i.png)]');
        expectParity('{ mask: "url(\'/i.png\')" }', "mask-[url('/i.png')]");
    });
});
