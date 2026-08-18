/**
 * A TypeScript assertion around an sz literal is erased, not meaningful.
 *
 * `as const`, `satisfies` and a plain `as T` disappear before any code runs,
 * so an object wearing one is the same object. The compiler already unwraps
 * them when the literal reaches it through a binding — the same syntax written
 * directly in the attribute went to the runtime instead, because the dispatch
 * tested for an object expression before stripping the wrapper.
 *
 * `as const` on an sz literal is not a rare shape: it is what the docs
 * recommend for a shared style object, so the two spellings disagreeing is a
 * trap laid exactly where authors are told to step.
 */
import { describe, expect, it } from 'vitest';

import { captureWarnings, ENGINES } from './engine-parity-harness.js';

/** The assertions that wrap an sz literal without changing it. */
const WRAPPERS: ReadonlyArray<readonly [string, string]> = [
    ['as const', "{ p: 4, bg: 'blue-500' } as const"],
    ['satisfies', "{ p: 4, bg: 'blue-500' } satisfies Record<string, unknown>"],
    ['as T', "{ p: 4, bg: 'blue-500' } as SzProps"],
    ['nested assertions', "({ p: 4, bg: 'blue-500' } as const) satisfies object"],
];

describe('a TS assertion at the sz site is unwrapped', () => {
    for (const [name, engine] of ENGINES) {
        for (const [label, expression] of WRAPPERS) {
            it(`${name} compiles ${label} written in the attribute`, () => {
                const tsx = `export const A = () => <div sz={${expression}} />;`;
                const run = captureWarnings(engine, tsx);
                expect(run.className).toBe('p-4 bg-blue-500');
                expect(run.warnings.filter(w => w.includes('sz fallback at '))).toEqual([]);
            });
        }

        it(`${name} still reports an assertion it cannot see through`, () => {
            // Unwrapping must not turn every assertion into a claim of
            // success: the wrapper comes off, and what is underneath is
            // judged on its own.
            const tsx = 'export const A = () => <div sz={cfg.card as object} />;';
            const run = captureWarnings(engine, tsx);
            expect(run.className).toBeUndefined();
            expect(run.warnings.join('\n')).toContain('sz fallback at ');
        });
    }
});
