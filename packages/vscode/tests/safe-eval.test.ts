/**
 * safe-eval tests — the literal reader behind hover and diagnostics. It must
 * faithfully reproduce plain literal data AND reject every construct that
 * could execute or reference anything: identifiers, calls, spreads, computed
 * keys, template interpolation. Rejection is all-or-nothing — one dynamic
 * value poisons the whole object (null).
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

describe('parseObjectLiteralSafe — a __proto__ key must not reach the prototype', () => {
    it('keeps Object.prototype as the prototype of the returned object', () => {
        const result = parseObjectLiteralSafe('{ __proto__: { p: 4 } }');
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });

    it('does not expose a value written through __proto__ as an inherited property', () => {
        const result = parseObjectLiteralSafe('{ __proto__: { p: 4 } }') as Record<
            string,
            unknown
        > | null;
        expect(result?.p).toBeUndefined();
    });

    it('leaves Object.prototype methods reachable on the returned object', () => {
        const result = parseObjectLiteralSafe('{ p: 1, __proto__: { toString: 2 } }');
        expect(typeof result?.toString).toBe('function');
    });

    it('keeps the sibling keys of a __proto__ key', () => {
        expect(parseObjectLiteralSafe('{ p: 1, __proto__: { q: 2 } }')).toEqual({ p: 1 });
    });

    it('treats a quoted __proto__ key the same as a bare one', () => {
        const result = parseObjectLiteralSafe(`{ '__proto__': { p: 4 } }`);
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });
});

/*
 * The literal grammar the providers depend on, pinned per construct.
 *
 * `sz` object text arrives from a document a user is mid-edit in, so the
 * accept/reject line is a product decision and not an implementation detail:
 * accepting something the compiler rejects means the editor validates code
 * that will not build, and rejecting something it accepts means a real prop
 * silently loses its hover and its diagnostics.
 */
describe('parseObjectLiteralSafe — numeric literal grammar', () => {
    it('accepts a trailing decimal point', () => {
        expect(parseObjectLiteralSafe('{ p: 5. }')).toEqual({ p: 5 });
    });

    it('accepts a leading decimal point', () => {
        expect(parseObjectLiteralSafe('{ p: .5 }')).toEqual({ p: 0.5 });
    });

    it('accepts hex, octal and binary radix prefixes', () => {
        expect(parseObjectLiteralSafe('{ a: 0x1f, b: 0o17, c: 0b101 }')).toEqual({
            a: 31,
            b: 15,
            c: 5,
        });
    });

    it('accepts exponents in both cases and signs', () => {
        expect(parseObjectLiteralSafe('{ a: 1e3, b: 1E-3 }')).toEqual({ a: 1000, b: 0.001 });
    });

    it('accepts numeric separators', () => {
        expect(parseObjectLiteralSafe('{ p: 1_000 }')).toEqual({ p: 1000 });
    });

    it('rejects legacy octal and octal-like numbers, as module code does', () => {
        expect(parseObjectLiteralSafe('{ p: 010 }')).toBeNull();
        expect(parseObjectLiteralSafe('{ p: 09 }')).toBeNull();
    });

    it('rejects bigint values and bigint keys', () => {
        expect(parseObjectLiteralSafe('{ p: 1n }')).toBeNull();
        expect(parseObjectLiteralSafe("{ 1n: 'x' }")).toBeNull();
    });

    it('normalises a numeric key through its numeric value', () => {
        expect(parseObjectLiteralSafe('{ 0x10: 1, 1e3: 2, 1.5: 3 }')).toEqual({
            '16': 1,
            '1000': 2,
            '1.5': 3,
        });
    });
});

describe('parseObjectLiteralSafe — string and template escapes', () => {
    it('decodes single-character escapes', () => {
        expect(parseObjectLiteralSafe(String.raw`{ p: "a\nb\tc" }`)).toEqual({ p: 'a\nb\tc' });
    });

    it('decodes hex and unicode escapes', () => {
        expect(parseObjectLiteralSafe(String.raw`{ a: '\x41', b: 'B', c: '\u{1F600}' }`)).toEqual({
            a: 'A',
            b: 'B',
            c: '\u{1F600}',
        });
    });

    it('decodes an escaped backtick inside a template literal', () => {
        expect(parseObjectLiteralSafe('{ p: `a\\`b` }')).toEqual({ p: 'a`b' });
    });

    it('drops a line continuation', () => {
        expect(parseObjectLiteralSafe('{ p: "a\\\nb" }')).toEqual({ p: 'ab' });
    });

    it('rejects legacy octal escapes, as module code does', () => {
        expect(parseObjectLiteralSafe(String.raw`{ p: '\400' }`)).toBeNull();
    });

    it('rejects an unterminated string', () => {
        expect(parseObjectLiteralSafe(`{ p: 'abc }`)).toBeNull();
    });

    it('rejects a newline inside a single-quoted string', () => {
        expect(parseObjectLiteralSafe("{ p: 'a\nb' }")).toBeNull();
    });
});

describe('parseObjectLiteralSafe — surrounding syntax', () => {
    it('accepts a non-ASCII identifier key', () => {
        expect(parseObjectLiteralSafe('{ é: 1 }')).toEqual({ é: 1 });
    });

    it('accepts reserved words as keys', () => {
        expect(parseObjectLiteralSafe('{ class: 1, function: 2, if: 3 }')).toEqual({
            class: 1,
            function: 2,
            if: 3,
        });
    });

    it('accepts a parenthesised value', () => {
        expect(parseObjectLiteralSafe('{ p: (1) }')).toEqual({ p: 1 });
    });

    it('accepts a parenthesised negative number', () => {
        expect(parseObjectLiteralSafe('{ p: -(4) }')).toEqual({ p: -4 });
    });

    it('rejects a doubly negated number', () => {
        expect(parseObjectLiteralSafe('{ p: -(-4) }')).toBeNull();
    });

    it('accepts line and block comments', () => {
        expect(parseObjectLiteralSafe('{ /* a */ p: 1, // b\n q: 2 }')).toEqual({ p: 1, q: 2 });
    });

    it('accepts a trailing comma', () => {
        expect(parseObjectLiteralSafe('{ p: 4, }')).toEqual({ p: 4 });
    });

    it('takes the last value when a key repeats', () => {
        expect(parseObjectLiteralSafe('{ p: 1, p: 2 }')).toEqual({ p: 2 });
    });

    it('rejects anything after the closing brace', () => {
        expect(parseObjectLiteralSafe('{ p: 4 } junk')).toBeNull();
        expect(parseObjectLiteralSafe('{ p: 4 }; drop()')).toBeNull();
        expect(parseObjectLiteralSafe('{}{}')).toBeNull();
    });

    it('ignores whitespace around the literal', () => {
        expect(parseObjectLiteralSafe('  { p: 4 }  ')).toEqual({ p: 4 });
    });

    it('rejects accessors and generator members', () => {
        expect(parseObjectLiteralSafe('{ get x() { return 1 } }')).toBeNull();
        expect(parseObjectLiteralSafe('{ set x(v) {} }')).toBeNull();
        expect(parseObjectLiteralSafe('{ async m() {} }')).toBeNull();
        expect(parseObjectLiteralSafe('{ *g() {} }')).toBeNull();
    });

    it('rejects shorthand properties', () => {
        expect(parseObjectLiteralSafe('{ p }')).toBeNull();
    });

    it('rejects regular expression and global-identifier values', () => {
        expect(parseObjectLiteralSafe('{ p: /re/ }')).toBeNull();
        expect(parseObjectLiteralSafe('{ p: undefined }')).toBeNull();
        expect(parseObjectLiteralSafe('{ p: NaN }')).toBeNull();
        expect(parseObjectLiteralSafe('{ p: Infinity }')).toBeNull();
    });
});
