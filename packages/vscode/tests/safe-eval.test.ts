/**
 * safe-eval tests — the AST-walking literal extractor behind hover and
 * diagnostics. It must faithfully reproduce plain literal data AND reject
 * every construct that could execute or reference anything: identifiers,
 * calls, spreads, computed keys, template interpolation. Rejection is
 * all-or-nothing — one dynamic value poisons the whole object (null).
 */

import { describe, expect, it } from 'vitest';

import { parseObjectLiteralSafe } from '../src/safe-eval.js';

describe('parseObjectLiteralSafe — literal extraction', () => {
    it('extracts primitive literal values', () => {
        expect(
            parseObjectLiteralSafe("{ p: 4, bg: 'red-500', on: true, off: false, n: null }"),
        ).toEqual({
            p: 4,
            bg: 'red-500',
            on: true,
            off: false,
            n: null,
        });
    });

    it('extracts an empty object', () => {
        expect(parseObjectLiteralSafe('{}')).toEqual({});
    });

    it('extracts negative numbers via unary minus', () => {
        expect(parseObjectLiteralSafe('{ m: -4, z: -0.5 }')).toEqual({ m: -4, z: -0.5 });
    });

    it('extracts nested objects (variant form)', () => {
        expect(parseObjectLiteralSafe("{ hover: { bg: 'red-500', p: 2 } }")).toEqual({
            hover: { bg: 'red-500', p: 2 },
        });
    });

    it('extracts arrays of literals and fills holes with null', () => {
        expect(parseObjectLiteralSafe("{ list: [1, 'two', true, null] }")).toEqual({
            list: [1, 'two', true, null],
        });
        expect(parseObjectLiteralSafe('{ list: [1, , 2] }')).toEqual({ list: [1, null, 2] });
    });

    it('extracts expression-free template literals as strings', () => {
        expect(parseObjectLiteralSafe('{ bg: `red-500` }')).toEqual({ bg: 'red-500' });
    });

    it('accepts string-literal and numeric keys', () => {
        expect(parseObjectLiteralSafe("{ '[&:hover]': { p: 2 }, 2: 'x' }")).toEqual({
            '[&:hover]': { p: 2 },
            '2': 'x',
        });
    });
});

describe('parseObjectLiteralSafe — rejection of dynamic input', () => {
    it('rejects identifiers and call expressions', () => {
        expect(parseObjectLiteralSafe('{ p: someVar }')).toBeNull();
        expect(parseObjectLiteralSafe('{ p: fn() }')).toBeNull();
    });

    it('rejects unary operators other than numeric minus', () => {
        expect(parseObjectLiteralSafe('{ p: +4 }')).toBeNull();
        expect(parseObjectLiteralSafe('{ p: !true }')).toBeNull();
        expect(parseObjectLiteralSafe('{ p: -x }')).toBeNull();
    });

    it('rejects template literals with interpolation', () => {
        expect(parseObjectLiteralSafe('{ bg: `red-${shade}` }')).toBeNull();
    });

    it('rejects arrays containing a dynamic element', () => {
        expect(parseObjectLiteralSafe('{ list: [1, x] }')).toBeNull();
    });

    it('rejects spread elements and object methods', () => {
        expect(parseObjectLiteralSafe('{ ...rest }')).toBeNull();
        expect(parseObjectLiteralSafe('{ m() { return 1 } }')).toBeNull();
    });

    it('rejects computed and non-static keys', () => {
        expect(parseObjectLiteralSafe('{ [key]: 1 }')).toBeNull();
        expect(parseObjectLiteralSafe("{ 1n: 'x' }")).toBeNull();
    });

    it('poisons the whole object when one nested value is dynamic', () => {
        expect(parseObjectLiteralSafe('{ p: 4, hover: { bg: theme.color } }')).toBeNull();
    });

    it('rejects non-object expressions', () => {
        expect(parseObjectLiteralSafe('42')).toBeNull();
        expect(parseObjectLiteralSafe('[1, 2]')).toBeNull();
        expect(parseObjectLiteralSafe("'str'")).toBeNull();
    });

    it('returns null on syntax errors', () => {
        expect(parseObjectLiteralSafe('{ p: ')).toBeNull();
        expect(parseObjectLiteralSafe('not valid js @@')).toBeNull();
    });
});
