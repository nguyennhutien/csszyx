/**
 * The `build.warn` switch on the TypeScript lanes (ADR 0011).
 *
 * `warn: false` is the single-pass mode: advisory diagnostics — the sz
 * fallback matrix, spread/szs/szRecover shape notices — disappear entirely,
 * while the transform output stays byte-identical. The switch is module-level
 * state armed per call, so these tests also pin the reset contract: a
 * `warn: false` call must not leak silence into the next caller, even when
 * the gated call throws.
 */
import { describe, expect, it } from 'vitest';
import { ASTBudgetExceededError } from '../src/ast-budget.js';
import { transformSourceCode } from '../src/transform.js';
import { transformOxc } from '../src/transform-oxc.js';

const FALLBACK_CODE = 'export const A = ({o}) => <div sz={{ ...o, p: 4 }} />;';
const SZS_CODE = 'export const A = ({s}) => <Popup szs={s} />;';
const RECOVER_CODE = 'export const A = ({m}) => <div sz={{ p: 4 }} szRecover={m} />;';

const LANES = [
    ['babel', transformSourceCode],
    ['oxc', transformOxc],
] as const;

describe.each(LANES)('%s lane build.warn', (_lane, transform) => {
    it('emits advisory diagnostics by default', () => {
        const result = transform(FALLBACK_CODE, '/p/t.tsx');
        expect(result.diagnostics?.length).toBeGreaterThan(0);
    });

    it('silences every advisory diagnostic when warn is false', () => {
        for (const code of [FALLBACK_CODE, SZS_CODE, RECOVER_CODE]) {
            const result = transform(code, '/p/t.tsx', { warn: false });
            expect(result.diagnostics ?? []).toEqual([]);
        }
    });

    it('changes diagnostics only — the emitted code is byte-identical', () => {
        const on = transform(FALLBACK_CODE, '/p/t.tsx');
        const off = transform(FALLBACK_CODE, '/p/t.tsx', { warn: false });
        expect(off.code).toBe(on.code);
    });

    it('treats an absent option as on', () => {
        const result = transform(FALLBACK_CODE, '/p/t.tsx', {});
        expect(result.diagnostics?.length).toBeGreaterThan(0);
    });

    it('does not leak silence into the next call', () => {
        transform(FALLBACK_CODE, '/p/t.tsx', { warn: false });
        const next = transform(FALLBACK_CODE, '/p/t.tsx');
        expect(next.diagnostics?.length).toBeGreaterThan(0);
    });
});

describe('gate reset on failure', () => {
    it('babel resets the gate even when the transform throws', () => {
        // A tiny AST budget makes the gated call throw mid-transform; the
        // `finally` must still restore the default, or every later transform
        // in the process runs silently — invisible everywhere except here.
        expect(() =>
            transformSourceCode(FALLBACK_CODE, '/p/t.tsx', { warn: false, astBudget: 1 }),
        ).toThrow(ASTBudgetExceededError);

        const next = transformSourceCode(FALLBACK_CODE, '/p/t.tsx');
        expect(next.diagnostics?.length).toBeGreaterThan(0);
    });
});
