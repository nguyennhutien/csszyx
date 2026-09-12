/**
 * A rule the dynamic lane injects must set the property the class name means.
 *
 * The generator claimed a value by prefix alone, so `bg-cover` — a background
 * SIZE — came out as `background-color: var(--color-cover)`, `text-[#123]` as a
 * `font-size`, `font-[500]` as a `font-family`, and `border-[3px]` as a
 * `border-color`. Each is a rule the browser drops, injected under a class name
 * that promised something else, and the lane does this only for values composed
 * at runtime — exactly where nobody is reading the CSS.
 *
 * `classify` from `@csszyx/runtime/split` already answers which property a token
 * sets, from the same value tables `szcn` merges by. This suite holds the
 * generator to that answer: for every token, either the declaration's property
 * agrees with `classify`, or the generator emits nothing. Emitting nothing is a
 * gap — the class simply has no CSS — while emitting the wrong property is a
 * lie, and only the second kind is a defect here.
 */
import { classify } from '@csszyx/runtime/split';
import { describe, expect, it } from 'vitest';

import { generateDeclarations } from '../src/css-generator.js';

/**
 * The CSS properties a `classify` property group is allowed to write.
 *
 * The mapping is deliberately explicit rather than derived: `classify` names
 * the group (`size`, `color`), and the generator names the declaration
 * (`background-size`, `background-color`), so this table is where the two
 * vocabularies meet and a mismatch has to be spelled out.
 */
const ALLOWED_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
    color: [
        'color',
        'background-color',
        'border-color',
        'border-top-color',
        'border-right-color',
        'border-bottom-color',
        'border-left-color',
        'border-inline-color',
        'border-block-color',
        'border-inline-start-color',
        'border-inline-end-color',
        'outline-color',
        'fill',
        'stroke',
        'text-decoration-color',
        '--tw-ring-color',
        '--tw-ring-offset-color',
        '--tw-shadow-color',
        '--tw-gradient-from',
        '--tw-gradient-via',
        '--tw-gradient-to',
    ],
    size: ['background-size', 'font-size', 'line-height', 'box-shadow', '--tw-leading'],
    position: ['background-position', 'object-position'],
    repeat: ['background-repeat'],
    image: ['background-image'],
    width: [
        'border-width',
        'border-top-width',
        'border-right-width',
        'border-bottom-width',
        'border-left-width',
        'border-inline-width',
        'border-inline-start-width',
        'border-inline-end-width',
        'outline-width',
        'text-decoration-thickness',
        'stroke-width',
    ],
    weight: ['font-weight', '--tw-font-weight'],
    family: ['font-family'],
    fit: ['object-fit'],
    align: ['text-align', 'align-content'],
    style: ['border-style', 'list-style-type', 'outline-style'],
};

/**
 * Tokens whose value shape decides the property — the class of input the
 * generator used to get wrong, plus the neighbours that must keep working.
 */
const TOKENS = [
    'bg-red-500',
    'bg-cover',
    'bg-center',
    'bg-no-repeat',
    'bg-[url(/a.png)]',
    'bg-[#123]',
    'text-red-500',
    'text-[#123]',
    'text-[14px]',
    'text-sm',
    'font-bold',
    'font-sans',
    'font-[500]',
    'font-[Inter]',
    'border-red-500',
    'border-[3px]',
    'border-2',
    'object-cover',
    'p-4',
] as const;

/**
 * The property each declaration in a generated rule body sets.
 *
 * @param declarations A rule body, as `generateDeclarations` returns it.
 * @returns One property name per declaration, in order.
 */
function propertiesOf(declarations: string): string[] {
    return declarations
        .split(';')
        .map(part => part.trim())
        .filter(part => part !== '')
        .map(part => part.slice(0, part.indexOf(':')).trim());
}

describe('a generated rule sets the property the class name means', () => {
    it.each(TOKENS)('%s', token => {
        const declarations = generateDeclarations(token);
        if (declarations === '') return; // A gap, not a lie.

        const classification = classify(token);
        const group = classification?.property;
        if (group === undefined) return; // The classifier has no opinion.

        const allowed = ALLOWED_PROPERTIES[group];
        expect(allowed, `no property list for the "${group}" group`).toBeDefined();
        for (const property of propertiesOf(declarations)) {
            expect(allowed, `${token} → ${declarations}`).toContain(property);
        }
    });
});

describe('the shapes that were wrong', () => {
    it.each([
        ['text-[#123]', 'color: #123'],
        ['text-[14px]', 'font-size: 14px'],
        ['font-[500]', 'font-weight: 500'],
        ['border-[3px]', 'border-width: 3px'],
    ])('%s emits %s', (token, expected) => {
        expect(generateDeclarations(token)).toBe(expected);
    });

    it.each(['bg-cover', 'bg-center', 'bg-no-repeat', 'bg-[url(/a.png)]'])(
        '%s no longer claims to be a colour',
        token => {
            expect(generateDeclarations(token)).not.toContain('background-color');
        },
    );
});
