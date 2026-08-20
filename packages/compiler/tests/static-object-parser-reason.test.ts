/**
 * Why a static object literal was rejected.
 *
 * `parseStaticObjectLiteral` answers yes or no, which is all its callers — the
 * Vue and Svelte adapters — need: a dynamic value there simply means the
 * attribute stays for the runtime. A tool whose whole job is to explain one
 * literal to a person needs the other half, and had been carrying its own
 * second parser to get it.
 *
 * The reason is produced by the same walk that does the extraction, so the two
 * answers cannot drift: there is no second traversal deciding independently
 * what counts as dynamic.
 */
import { describe, expect, it } from 'vitest';

import { explainStaticObjectLiteral } from '../src/static-object-parser.js';

describe('explainStaticObjectLiteral', () => {
    it('returns the value for a fully static object', () => {
        expect(explainStaticObjectLiteral(`{ p: 4, bg: 'blue-500' }`)).toEqual({
            value: { p: 4, bg: 'blue-500' },
        });
    });

    it('names a spread rather than only refusing it', () => {
        const result = explainStaticObjectLiteral('{ ...rest }');

        expect(result).toEqual({ reason: 'a spread is dynamic' });
    });

    it('names a computed key', () => {
        expect(explainStaticObjectLiteral('{ [key]: 4 }')).toEqual({
            reason: 'a computed key is dynamic',
        });
    });

    it('names an object method', () => {
        expect(explainStaticObjectLiteral('{ go() {} }')).toEqual({
            reason: 'an object method is dynamic',
        });
    });

    it('names the node type of a dynamic value', () => {
        expect(explainStaticObjectLiteral('{ p: size }')).toEqual({
            reason: '"Identifier" is dynamic',
        });
    });

    it('names an interpolated template', () => {
        expect(explainStaticObjectLiteral('{ p: `a${b}` }')).toEqual({
            reason: 'a template literal with interpolation is dynamic',
        });
    });

    it('reports the reason from inside a nested object, not the outer one', () => {
        // The outer object is fine; blaming it would point at the wrong line.
        expect(explainStaticObjectLiteral('{ hover: { bg: colour } }')).toEqual({
            reason: '"Identifier" is dynamic',
        });
    });

    it('reports the reason from inside an array', () => {
        expect(explainStaticObjectLiteral('{ list: [1, two] }')).toEqual({
            reason: '"Identifier" is dynamic',
        });
    });

    it('separates a parse failure from a dynamic value', () => {
        expect(explainStaticObjectLiteral('{ p:')).toEqual({
            reason: 'could not be parsed as a JavaScript expression',
        });
    });

    it('says when the source is not an object literal at all', () => {
        expect(explainStaticObjectLiteral('4')).toEqual({
            reason: 'not an object literal',
        });
    });

    it('rejects a non-string input without throwing', () => {
        expect(explainStaticObjectLiteral(null as unknown as string)).toEqual({
            reason: 'could not be parsed as a JavaScript expression',
        });
    });

    it('keeps an unsupported unary operator distinct from a plain negative', () => {
        expect(explainStaticObjectLiteral('{ p: -4 }')).toEqual({ value: { p: -4 } });
        expect(explainStaticObjectLiteral('{ p: +4 }')).toEqual({
            reason: 'the unary operator "+" is dynamic',
        });
    });
});

describe('explainStaticObjectLiteral — spreads read the same in both positions', () => {
    it('names an array spread the way it names an object spread', () => {
        expect(explainStaticObjectLiteral('{ p: [...xs] }')).toEqual({
            reason: 'a spread is dynamic',
        });
    });
});
