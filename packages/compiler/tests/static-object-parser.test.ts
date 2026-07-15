import { describe, expect, it } from 'vitest';

import { parseStaticObjectLiteral } from '../src/static-object-parser.js';

describe('parseStaticObjectLiteral', () => {
    it('extracts nested static sz values', () => {
        expect(
            parseStaticObjectLiteral(`{ p: -4, hover: { bg: 'red-500' }, list: [1, , true] }`),
        ).toEqual({ p: -4, hover: { bg: 'red-500' }, list: [1, null, true] });
    });

    it('accepts quoted and numeric property keys', () => {
        expect(parseStaticObjectLiteral(`{ 'p': 4, 0: 'zero' }`)).toEqual({
            p: 4,
            '0': 'zero',
        });
    });

    it('accepts static template literals', () => {
        expect(parseStaticObjectLiteral('{ content: `hello` }')).toEqual({ content: 'hello' });
    });

    it.each([
        '{ p: value }',
        '{ p: fn() }',
        '{ p: +4 }',
        '{ p: `hello ${name}` }',
        '{ [name]: 4 }',
        '{ 10n: 4 }',
    ])('rejects dynamic or unsupported syntax: %s', source => {
        expect(parseStaticObjectLiteral(source)).toBeNull();
    });

    it('returns null for invalid source without throwing', () => {
        expect(parseStaticObjectLiteral('{ p:')).toBeNull();
        expect(parseStaticObjectLiteral(null as unknown as string)).toBeNull();
    });
});
