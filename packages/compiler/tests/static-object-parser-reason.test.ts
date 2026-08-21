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
import { parseSync } from 'oxc-parser';
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

    it('refuses a negated literal that is not a number', () => {
        // Both halves of the guard have to hold. Negating any of these in
        // JavaScript coerces to a number, so accepting them would hand the
        // compiler a value the source never wrote — `-true` as -1, `-'5'` as
        // -5, `-null` as 0 — instead of saying it cannot read the literal.
        for (const source of [`{ p: -true }`, `{ p: -'5' }`, `{ p: -null }`]) {
            expect(explainStaticObjectLiteral(source)).toEqual({
                reason: 'a negated non-number is dynamic',
            });
        }
    });
});

describe('explainStaticObjectLiteral — spreads read the same in both positions', () => {
    it('names an array spread the way it names an object spread', () => {
        expect(explainStaticObjectLiteral('{ p: [...xs] }')).toEqual({
            reason: 'a spread is dynamic',
        });
    });
});

// The walk narrows on node types rather than defending against every shape the
// parser could hypothetically produce, so what it may assume is a contract with
// oxc and not a matter of taste. Pinned here because the alternative is a guard
// per assumption that no input can reach, which reads as caution while proving
// nothing and can never be exercised.
describe('the oxc ESTree shapes the walk narrows on', () => {
    /** Minimal structural view of a node, matching the parser module's own. */
    type Node = Record<string, unknown>;

    /**
     * Parse one object literal the way the walk does.
     *
     * @param source - Object literal source.
     * @returns The members of its `ObjectExpression` node.
     */
    function members(source: string): Node[] {
        const parsed = parseSync('sz.js', `const _=${source}`);
        expect(parsed.errors).toEqual([]);
        const body = (parsed.program as unknown as Node).body as Node[];
        const declaration = (body[0].declarations as Node[])[0];
        return (declaration.init as Node).properties as Node[];
    }

    it('spells a non-computed key as Identifier or Literal and nothing else', () => {
        // Every way JavaScript lets a key be written, short of a computed one,
        // which the walk rejects before it ever reads the key.
        const keys = members(
            `{ plain: 1, 'quoted': 1, 42: 1, 0x2a: 1, 1n: 1, get accessor() {}, set accessor(v) {}, method() {}, shorthand }`,
        ).map(property => (property.key as Node).type);

        expect(new Set(keys)).toEqual(new Set(['Identifier', 'Literal']));
    });

    it('gives an object expression a members array, empty object included', () => {
        // The walk iterates it directly, so an object with nothing in it has to
        // arrive as an empty array rather than as a missing field.
        expect(members('{}')).toEqual([]);
    });

    it('spells every object member as Property or SpreadElement', () => {
        // Accessors and methods are Property nodes carrying a flag, not member
        // types of their own, which is why the walk asks `method` rather than
        // asking what kind of node it is holding.
        const kinds = members(
            `{ ...spread, plain: 1, get accessor() {}, set accessor(v) {}, method() {} }`,
        ).map(property => property.type);

        expect(new Set(kinds)).toEqual(new Set(['Property', 'SpreadElement']));
    });

    it('gives a template literal an expressions array even with nothing to interpolate', () => {
        const shapes = members('{ bare: `x`, interpolated: `x${y}` }').map(property =>
            Array.isArray((property.value as Node).expressions),
        );

        expect(shapes).toEqual([true, true]);
    });
});
