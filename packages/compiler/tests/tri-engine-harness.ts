/**
 * Shared tri-engine harness for parity suites.
 *
 * Eight test files each rebuilt the same three pieces — the engine table with
 * its rust-availability spread, the transform-and-compare loop, and the
 * console-warning capture with its noise filter. Copies drift (two mask suites
 * carried 30 byte-identical lines differing only in an unused filename
 * literal), and every copy re-decides whether a missing rust lane is an error.
 * One module owns all three now.
 *
 * NOT a `.test.ts` file on purpose, like `oxc-parity-harness.ts`: vitest must
 * not collect it as a suite.
 */
import { expect } from 'vitest';

import {
    isRustTransformAvailable,
    transformOxc,
    transformRust,
    transformSourceCode,
} from '../src/index.js';

/** The result surface parity assertions read, common to all three engines. */
export interface TriEngineResult {
    code?: string;
    diagnostics?: string[];
}

/** One engine entry, narrowed to the shared result surface. */
export type TriEngine = (source: string, filename?: string) => TriEngineResult;

// In CI the native engine is built before the unit suites run; if that step
// ever no-ops, every parity suite would silently degrade to two lanes and
// keep passing. Failing at module load is deliberate — it cannot be skipped
// per file, and the message names the real problem.
if (process.env.CI && !isRustTransformAvailable()) {
    throw new Error(
        'tri-engine harness: the rust lane is unavailable under CI — the native ' +
            'engine build step failed or was skipped, and every parity suite ' +
            'would silently degrade to two lanes.',
    );
}

/** The three lanes, rust included whenever the native binding is present. */
export const ENGINES: ReadonlyArray<readonly [string, TriEngine]> = [
    ['babel', transformSourceCode as TriEngine],
    ['oxc', transformOxc as TriEngine],
    ...(isRustTransformAvailable() ? ([['rust', transformRust as TriEngine]] as const) : []),
];

/**
 * Transform one sz literal on every engine and assert they agree.
 *
 * @param sz - The sz object source, as written in JSX.
 * @param expected - The className every engine must emit.
 */
export function expectParity(sz: string, expected: string): void {
    const tsx = `export const A = () => <div sz={${sz}} />;`;
    for (const [name, transform] of ENGINES) {
        const code = transform(tsx, 'tri-engine.tsx').code ?? '';
        const emitted = /className="([^"]*)"/.exec(code)?.[1] ?? '';
        expect(emitted, `${name} — ${sz}`).toBe(expected);
    }
}

/** One captured engine run: the raw result plus its merged warning channel. */
export interface CapturedRun {
    /** The engine's transform result. */
    result: TriEngineResult;
    /** Diagnostics and console warnings, noise filtered, in emission order. */
    warnings: string[];
    /** The first emitted className attribute value, when any. */
    className: string | undefined;
}

/**
 * Run one engine over a source, capturing both warning channels.
 *
 * The JS lanes warn through the console while the native engine reports
 * through `diagnostics`; parity assertions need the union of both, minus the
 * one-time "Tip: run a full project scan" hint whose firing depends on suite
 * order.
 *
 * @param engine - Engine entry under test.
 * @param source - Full module source.
 * @param filename - Filename handed to the engine.
 * @returns The result, merged warnings, and extracted className.
 */
export function captureWarnings(
    engine: TriEngine,
    source: string,
    filename = '/p/t.tsx',
): CapturedRun {
    const logged: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
    };
    let result: TriEngineResult;
    try {
        result = engine(source, filename);
    } finally {
        console.warn = original;
    }
    const warnings = [...(result.diagnostics ?? []).map(String), ...logged].filter(
        message => !message.includes('Tip: run'),
    );
    return {
        result,
        warnings,
        className:
            result.code === undefined ? undefined : /className="([^"]*)"/.exec(result.code)?.[1],
    };
}
