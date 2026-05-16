/**
 * Tests for the AST budget guard. Files larger than AST_BUDGET nodes
 * abort with ASTBudgetExceededError instead of OOM-ing the build.
 */

import { describe, expect, it } from 'vitest';

import { AST_BUDGET, ASTBudgetExceededError } from '../src/ast-budget.js';
import { transformSourceCode } from '../src/transform.js';

describe('AST budget guard', () => {
    /**
     * Builds a wide AST that exceeds the budget without hitting parser recursion.
     *
     * @param length Number of array literal entries to generate.
     * @param tail Source appended after the generated array.
     * @returns Source string with a large array plus the requested tail.
     */
    function wideArraySource(length: number, tail: string): string {
        const literals = Array.from({ length }, (_, i) => i).join(', ');
        return `const data = [${literals}]; ${tail}`;
    }

    it('exposes the cap value matching the engine spec', () => {
        expect(AST_BUDGET).toBe(50_000);
    });

    it('passes through small files unchanged', () => {
        const source = "<div sz={{ p: 4, bg: 'red-500' }}>hi</div>";
        const result = transformSourceCode(source);
        expect(result.transformed).toBe(true);
        expect(result.code).toContain('className');
    });

    it('throws ASTBudgetExceededError on a synthetic over-budget file', () => {
        // Wide flat array (60k literals) — comfortably overshoots 50k AST
        // nodes. Avoid deep nesting (binary chains, deeply nested JSX) which
        // hits Babel parser's recursion limit before the AST is built.
        const literals = Array.from({ length: 60_000 }, (_, i) => i).join(', ');
        const source = `const data = [${literals}]; const App = () => <div sz={{ p: 1 }}>x</div>;`;

        expect(() => transformSourceCode(source, 'huge.tsx')).toThrow(ASTBudgetExceededError);
    });

    it('error message includes filename + node count', () => {
        // Use a wide flat array (60k literals) instead of a deep binary
        // expression: deep chains hit Babel parser's recursion limit before
        // the AST is even built, so we never get to the budget check.
        const literals = Array.from({ length: 60_000 }, (_, i) => i).join(', ');
        const source = `const data = [${literals}]; const App = () => <div sz={{ p: 1 }}>x</div>;`;

        let caught: ASTBudgetExceededError | undefined;
        try {
            transformSourceCode(source, 'src/generated/big.tsx');
        } catch (e) {
            caught = e as ASTBudgetExceededError;
        }

        expect(caught).toBeInstanceOf(ASTBudgetExceededError);
        expect(caught?.filename).toBe('src/generated/big.tsx');
        expect(caught?.nodeCount).toBeGreaterThan(AST_BUDGET);
        expect(caught?.message).toContain('src/generated/big.tsx');
        expect(caught?.message).toContain(String(AST_BUDGET));
    });

    it('falls back to <anonymous> when called without filename', () => {
        // Use a wide flat array (60k literals) instead of a deep binary
        // expression: deep chains hit Babel parser's recursion limit before
        // the AST is even built, so we never get to the budget check.
        const literals = Array.from({ length: 60_000 }, (_, i) => i).join(', ');
        const source = `const data = [${literals}]; const App = () => <div sz={{ p: 1 }}>x</div>;`;

        let caught: ASTBudgetExceededError | undefined;
        try {
            transformSourceCode(source);
        } catch (e) {
            caught = e as ASTBudgetExceededError;
        }

        expect(caught).toBeInstanceOf(ASTBudgetExceededError);
        expect(caught?.filename).toBeUndefined();
        expect(caught?.message).toContain('<anonymous>');
    });

    it('does not throw for budget errors when source has no sz token (fast-path)', () => {
        // The fast-path returns before parsing, so an over-budget file with
        // no `sz` substring slips through unchecked. That's intentional —
        // we never traverse it, so the budget concern doesn't apply.
        const source = '1' + '+ 1'.repeat(30_000);
        expect(() => transformSourceCode(source)).not.toThrow();
    });

    it('returns invalid syntax unchanged when source has no sz token', () => {
        // Parser independence contract: csszyx must not invoke Babel/OXC for
        // files that cannot contain csszyx syntax. Generated files can be huge
        // or syntactically invalid for the TSX parser, but they are outside
        // csszyx's transform surface when they have no `sz` marker.
        const source = 'const broken = ;';
        const result = transformSourceCode(source, 'broken-generated.ts');

        expect(result.transformed).toBe(false);
        expect(result.code).toBe(source);
        expect(result.classes.size).toBe(0);
        expect(result.recoveryTokens.size).toBe(0);
    });

    it('enforces the budget when an incidental sz marker forces parsing', () => {
        // Current prefilter is intentionally cheap (`source.includes("sz")`).
        // If a future OXC path narrows that prefilter, this test is the debate
        // point: either keep this conservative protection or consciously update
        // the contract with an equivalent "definitely no csszyx syntax" scanner.
        const source = wideArraySource(60_000, 'const szMarker = true;');

        expect(() => transformSourceCode(source, 'huge-with-sz-marker.ts')).toThrow(
            ASTBudgetExceededError,
        );
    });

    it('applies the same budget to szRecover-only files', () => {
        // szRecover is a csszyx transform surface even when there is no `sz`
        // prop. The budget must protect recovery-token generation too.
        const source = wideArraySource(
            60_000,
            'const App = () => <section szRecover="csr">x</section>;',
        );

        expect(() => transformSourceCode(source, 'huge-recovery.tsx')).toThrow(
            ASTBudgetExceededError,
        );
    });

    it('respects an `astBudget` override raised above the default', () => {
        // Source ~60k nodes — exceeds default 50k but fits a 100k override.
        const source = wideArraySource(60_000, 'const App = () => <div sz={{ p: 1 }}>x</div>;');

        // Default budget: throws.
        expect(() => transformSourceCode(source, 'huge.tsx')).toThrow(ASTBudgetExceededError);

        // Raised budget: passes.
        expect(() => transformSourceCode(source, 'huge.tsx', { astBudget: 100_000 })).not.toThrow();
    });

    it('respects an `astBudget` override lowered below the default', () => {
        // Source ~3k nodes — well under 50k default but over a 1k override.
        const source = wideArraySource(3000, 'const App = () => <div sz={{ p: 1 }}>x</div>;');

        // Default budget: passes.
        expect(() => transformSourceCode(source, 'small.tsx')).not.toThrow();

        // Lowered budget: throws.
        expect(() => transformSourceCode(source, 'small.tsx', { astBudget: 1_000 })).toThrow(
            ASTBudgetExceededError,
        );
    });

    it('error reports the effective budget (not just the default)', () => {
        const source = wideArraySource(60_000, 'const App = () => <div sz={{ p: 1 }}>x</div>;');

        let caught: ASTBudgetExceededError | undefined;
        try {
            transformSourceCode(source, 'big.tsx', { astBudget: 55_000 });
        } catch (e) {
            caught = e as ASTBudgetExceededError;
        }
        expect(caught?.budget).toBe(55_000);
        expect(caught?.message).toContain('55000');
    });
});
