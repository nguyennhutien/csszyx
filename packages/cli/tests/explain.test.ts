/**
 * `csszyx explain` resolves an sz object literal to its compiled className,
 * so a developer can verify what csszyx emits without a build.
 */
import { describe, expect, it } from 'vitest';

import { ExplainParseError, explainSz } from '../src/commands/explain.js';

describe('explainSz', () => {
    it('resolves a single property', () => {
        expect(explainSz('{ p: 4 }')).toBe('p-4');
    });

    it('resolves multiple properties in order', () => {
        const out = explainSz("{ p: 4, bg: 'blue-500' }");
        expect(out.split(' ')).toContain('p-4');
        expect(out.split(' ')).toContain('bg-blue-500');
    });

    it('resolves a nested variant', () => {
        expect(explainSz("{ hover: { bg: 'blue-500' } }")).toBe('hover:bg-blue-500');
    });

    it('resolves a negative value', () => {
        expect(explainSz('{ mt: -4 }')).toBe('-mt-4');
    });

    it('rejects a dynamic spread (cannot be explained statically)', () => {
        expect(() => explainSz('{ ...props }')).toThrow(ExplainParseError);
    });

    it('rejects a non-object argument', () => {
        expect(() => explainSz('someVar')).toThrow(ExplainParseError);
    });
});

/**
 * The messages are the command's whole point: someone runs it on a literal
 * precisely because they cannot tell why it is not producing classes. These
 * pin the wording so a parser change cannot quietly reduce every rejection to
 * "could not explain sz".
 */
describe('explainSz rejection messages', () => {
    it('names a spread', () => {
        expect(() => explainSz('{ ...props }')).toThrow(/spread is dynamic/);
    });

    it('names a computed key', () => {
        expect(() => explainSz('{ [key]: 4 }')).toThrow(/computed key is dynamic/);
    });

    it('names an object method', () => {
        expect(() => explainSz('{ go() {} }')).toThrow(/object method is dynamic/);
    });

    it('names an interpolated template', () => {
        expect(() => explainSz('{ p: `a${b}` }')).toThrow(/template literal with interpolation/);
    });

    it('names the dynamic node type of a value', () => {
        expect(() => explainSz('{ p: size }')).toThrow(/"Identifier" is dynamic/);
    });

    it('separates a syntax error from a dynamic value', () => {
        expect(() => explainSz('{ p:')).toThrow(/could not be parsed/);
    });

    it('says when the argument is not an object literal', () => {
        expect(() => explainSz('someVar')).toThrow(/not an object literal/);
    });

    it('still resolves an uninterpolated template', () => {
        expect(explainSz('{ content: `x` }')).toBe('content-[x]');
    });
});
