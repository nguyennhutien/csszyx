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
