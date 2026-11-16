/**
 * JSX allows whitespace around an attribute's `=`, so `className = "block"` is
 * the same attribute as `className="block"`. The engine merges an element's
 * `sz` classes into its authored class, and must find that class however its
 * `=` is spaced: otherwise it writes a second `className`, and the browser
 * keeps one of the two.
 */
import { describe, expect, it } from 'vitest';

import { transformRust } from '../src/transform-rust.js';
import { transformWasm } from '../src/transform-wasm.js';

const ENGINES = [
    ['native', transformRust],
    ['wasm', transformWasm],
] as const;

/** Every class attribute the output carries, with its value. */
const CLASS_ATTRIBUTE = /\b(class(?:Name)?)\s*=\s*"([^"]*)"/g;

/**
 * The class attributes of one transformed element.
 *
 * @param code - The engine's output.
 * @returns `name=value` for each, in order.
 */
function classAttributes(code: string): string[] {
    return [...code.matchAll(CLASS_ATTRIBUTE)].map(([, name, value]) => `${name}=${value}`);
}

describe.each(ENGINES)('an authored class with space around its `=` (%s)', (_name, transform) => {
    const lower = (element: string): string[] =>
        classAttributes(
            transform(`export const A = () => ${element};\n`, { filename: 'a.tsx' }).code,
        );

    it.each([
        ['className = "block"', 'className="block"'],
        ['className\n=\t"block"', 'className="block"'],
        ['class = "block"', 'class="block"'],
    ])('merges `sz` into %j as into %j', (spaced, tight) => {
        const merged = lower(`<div ${tight} sz={{ p: 4 }} />`);
        expect(merged).toHaveLength(1);
        expect(lower(`<div ${spaced} sz={{ p: 4 }} />`)).toEqual(merged);
    });

    it('lowers an `sz` with space around its `=`', () => {
        expect(lower('<div sz = {{ p: 4 }} />')).toEqual(lower('<div sz={{ p: 4 }} />'));
    });

    it('lowers every `sz` of a file that spells them both ways', () => {
        const code = transform(
            'export const A = () => <><i sz={{ p: 4 }} /><b sz = {{ m: 2 }} /></>;\n',
            { filename: 'a.tsx' },
        ).code;
        expect(code).not.toMatch(/\bsz\s*=/);
        expect(classAttributes(code)).toEqual(['className=p-4', 'className=m-2']);
    });
});
