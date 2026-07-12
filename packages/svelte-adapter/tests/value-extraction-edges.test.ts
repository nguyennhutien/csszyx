/**
 * extractValue/extractObjectNode edge branches not covered by the happy-path
 * suites: unary expressions on non-literal operands, sparse array holes,
 * interpolated template literals, unsupported value node types, and
 * string/numeric/unsupported object keys.
 */
import { describe, expect, it } from 'vitest';

import { parseObjectLiteral } from '../src/index.js';

describe('parseObjectLiteral value extraction edges', () => {
    it('rejects a unary expression applied to a non-literal operand', () => {
        // `-x` is a UnaryExpression whose argument is an Identifier, not a
        // numeric Literal, so extractValue cannot fold it to a constant.
        expect(parseObjectLiteral('{ p: -x }')).toBeNull();
    });

    it('rejects a non-numeric unary expression', () => {
        // `!true` uses an operator other than '-', so it falls through the
        // same "cannot fold" branch regardless of its operand type.
        expect(parseObjectLiteral('{ on: !true }')).toBeNull();
    });

    it('preserves sparse array holes as null entries', () => {
        expect(parseObjectLiteral('{ list: [1, , 3] }')).toEqual({ list: [1, null, 3] });
    });

    it('rejects a template literal with interpolation', () => {
        expect(parseObjectLiteral('{ name: `hello ${x}` }')).toBeNull();
    });

    it('rejects an unsupported value expression type', () => {
        expect(parseObjectLiteral('{ p: foo() }')).toBeNull();
    });

    it('accepts a string literal key', () => {
        expect(parseObjectLiteral('{ "p": 4 }')).toEqual({ p: 4 });
    });

    it('accepts a numeric literal key, stringified', () => {
        expect(parseObjectLiteral('{ 0: 4 }')).toEqual({ '0': 4 });
    });

    it('rejects a key that is neither an identifier nor a string/number literal', () => {
        // A BigInt literal key (`10n`) parses as a Literal node whose value
        // is neither a string nor a number, so it falls into the
        // unsupported-key branch. (Reserved words like `null`/`true` don't
        // work for this: oxc-parser represents them as plain Identifier
        // keys, same as any other property name.)
        expect(parseObjectLiteral('{ 10n: 4 }')).toBeNull();
    });
});
