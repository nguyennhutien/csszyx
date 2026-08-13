/**
 * Tests for the AST budget guard.
 *
 * The engine's contract: a file whose parser-path IR walk exceeds the budget
 * is LEFT UNCHANGED and contributes no classes, with one diagnostic naming
 * `build.astBudgetLimit` — never a thrown error, and never a half-rewritten
 * file. A static-sz file never consults the budget at all: the fast path
 * extracts it without a full parse, which is the point of having one.
 */

import { describe, expect, it } from 'vitest';

import { AST_BUDGET } from '../src/ast-budget.js';
import { transformSource } from '../src/transform-select.js';
import { transformWasm } from '../src/transform-wasm.js';

describe('AST budget guard', () => {
    /**
     * A source the fast path cannot claim (dynamic sz value), so the parser
     * runs and the budget applies.
     *
     * @returns Source string on the parser path.
     */
    function parserPathSource(): string {
        const rows = Array.from({ length: 200 }, (_, i) => `<i sz={{ p: ${i % 9} }} />`).join('');
        return `export const Big = ({ x }) => <div sz={{ w: x }}>${rows}</div>;`;
    }

    /** The engine's over-budget contract, shared by every trip-site test.
     *
     * @param result - Transform result of an over-budget file.
     * @param filename - Filename the diagnostic must name.
     */
    function expectBudgetTrip(result: ReturnType<typeof transformSource>, filename: string): void {
        expect(result.transformed).toBe(false);
        expect(result.classes.size).toBe(0);
        expect(result.diagnostics.some(d => d.includes('AST budget exceeded'))).toBe(true);
        expect(result.diagnostics.some(d => d.includes(filename))).toBe(true);
        expect(result.diagnostics.some(d => d.includes('astBudgetLimit'))).toBe(true);
    }

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
        const result = transformSource(source);
        expect(result.transformed).toBe(true);
        expect(result.code).toContain('className');
    });

    it('leaves a synthetic over-budget file unchanged, with the diagnostic', () => {
        const source = parserPathSource();
        const result = transformSource(source, 'huge.tsx', { astBudget: 40 });
        expect(result.code).toBe(source);
        expectBudgetTrip(result, 'huge.tsx');
    });

    it('the diagnostic names the file, on both artifacts identically', () => {
        const source = parserPathSource();
        const native = transformSource(source, 'src/generated/big.tsx', { astBudget: 40 });
        const wasm = transformWasm(source, 'src/generated/big.tsx', { astBudget: 40 });
        expectBudgetTrip(native, 'src/generated/big.tsx');
        expect(wasm.diagnostics).toEqual(native.diagnostics);
    });

    it('a static-sz file never consults the budget — the fast path owns it', () => {
        // The historic Babel lane threw here; the engine deliberately does
        // not: a wide flat array with a static sz object is extracted without
        // a full parse, so 60k literals cost nothing.
        const literals = Array.from({ length: 60_000 }, (_, i) => i).join(', ');
        const source = `const data = [${literals}]; const App = () => <div sz={{ p: 1 }}>x</div>;`;
        const result = transformSource(source, 'huge.tsx');
        expect(result.transformed).toBe(true);
        expect([...result.classes]).toContain('p-1');
    });

    it('does not throw for budget errors when source has no sz token (fast-path)', () => {
        // The fast-path returns before parsing, so an over-budget file with
        // no `sz` substring slips through unchecked. That's intentional —
        // we never traverse it, so the budget concern doesn't apply.
        const source = '1' + '+ 1'.repeat(30_000);
        expect(() => transformSource(source)).not.toThrow();
    });

    it('returns invalid syntax unchanged when source has no sz token', () => {
        // Parser independence contract: csszyx must not invoke Babel/OXC for
        // files that cannot contain csszyx syntax. Generated files can be huge
        // or syntactically invalid for the TSX parser, but they are outside
        // csszyx's transform surface when they have no `sz` marker.
        const source = 'const broken = ;';
        const result = transformSource(source, 'broken-generated.ts');

        expect(result.transformed).toBe(false);
        expect(result.code).toBe(source);
        expect(result.classes.size).toBe(0);
        expect(result.recoveryTokens.size).toBe(0);
    });

    it('enforces the budget when an incidental sz marker forces parsing', () => {
        // The cheap prefilter (`includes("sz")`) sends this to the parser,
        // which walks the 60k-literal array and trips the cap — the guard
        // protects generated files that merely CONTAIN the letters "sz".
        const source = wideArraySource(60_000, 'const szMarker = true;');
        expectBudgetTrip(
            transformSource(source, 'huge-with-sz-marker.ts'),
            'huge-with-sz-marker.ts',
        );
    });

    it('applies the budget to parser-path szRecover files too', () => {
        // szRecover is a csszyx transform surface even without an sz prop;
        // on the parser path the budget must protect it as well.
        const source = `export const App = ({ x }) => (<section szRecover="csr"><div sz={{ w: x }} />${Array.from({ length: 200 }, () => '<i sz={{ p: 1 }} />').join('')}</section>);`;
        const result = transformSource(source, 'huge-recovery.tsx', { astBudget: 40 });
        expectBudgetTrip(result, 'huge-recovery.tsx');
    });

    it('respects an `astBudget` override raised above a tripping value', () => {
        const source = parserPathSource();

        // Low budget: trips.
        expectBudgetTrip(transformSource(source, 'huge.tsx', { astBudget: 40 }), 'huge.tsx');

        // Raised budget: transforms.
        const raised = transformSource(source, 'huge.tsx', { astBudget: 100_000 });
        expect(raised.transformed).toBe(true);
        expect(raised.diagnostics.some(d => d.includes('AST budget exceeded'))).toBe(false);
    });

    it('respects an `astBudget` override lowered below the default', () => {
        const source = parserPathSource();

        // Default budget: transforms.
        const roomy = transformSource(source, 'small.tsx');
        expect(roomy.transformed).toBe(true);

        // Lowered budget: trips.
        expectBudgetTrip(transformSource(source, 'small.tsx', { astBudget: 40 }), 'small.tsx');
    });

    it('raising the budget silences the diagnostic on the same file', () => {
        const source = wideArraySource(60_000, 'const szMarker = true;');
        const raised = transformSource(source, 'huge-with-sz-marker.ts', { astBudget: 500_000 });
        expect(raised.diagnostics).toEqual([]);
    });
});
