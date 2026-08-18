/**
 * A binding that is written to again is not a compile-time constant.
 *
 * The compiler folds a bound object into classes by reading its INITIALIZER.
 * That is sound only while the initializer is still the value at render time.
 * Reassign the binding and it is not: the emitted class describes the first
 * value while the runtime holds the second, so the element is styled wrong —
 * not unstyled, wrong. `szv` already refuses these (ADR 0005 added the guard
 * after finding the same unsoundness there); the general `sz` path did not.
 *
 * `let` itself stays supported. The question a fold may ask is whether the
 * binding is ever written to again, not which keyword declared it.
 */
import { describe, expect, it } from 'vitest';

import { captureWarnings, ENGINES, normalizeEmit } from './engine-parity-harness.js';

/**
 * Emitted className for one module, or undefined when none was emitted.
 *
 * @param source - Full module source to transform.
 * @param engine - One lane from the tri-engine table.
 * @returns The first emitted className value, or undefined on a fallback.
 */
function emittedClassName(source: string, engine: (typeof ENGINES)[number][1]): string | undefined {
    return captureWarnings(engine, source).className;
}

describe('a reassigned binding is not folded', () => {
    for (const [name, engine] of ENGINES) {
        it(`${name} leaves a reassigned let to the runtime`, () => {
            const tsx = 'let s = { p: 4 };\ns = { p: 8 };\nexport const A = () => <div sz={s} />;';
            // `p-4` is the value the binding no longer holds. Emitting it is the
            // defect; falling back is the fix, and the fallback is reported.
            expect(emittedClassName(tsx, engine)).toBeUndefined();
            expect(normalizeEmit(captureWarnings(engine, tsx).result.code ?? '')).toContain('_sz(');
        });

        it(`${name} leaves a reassigned spread source to the runtime`, () => {
            const tsx =
                'let base = { p: 4 };\nbase = { p: 8 };\nexport const A = () => <div sz={{ ...base }} />;';
            expect(emittedClassName(tsx, engine)).toBeUndefined();
        });

        it(`${name} still folds a let that is never written to again`, () => {
            // The existing contract, pinned so the guard cannot overreach into
            // "let is unsupported" — which is a different, larger claim.
            const tsx = 'let s = { p: 4 };\nexport const A = () => <div sz={s} />;';
            expect(emittedClassName(tsx, engine)).toBe('p-4');
        });

        it(`${name} still folds a const`, () => {
            const tsx = 'const s = { p: 4 };\nexport const A = () => <div sz={s} />;';
            expect(emittedClassName(tsx, engine)).toBe('p-4');
        });
    }
});
