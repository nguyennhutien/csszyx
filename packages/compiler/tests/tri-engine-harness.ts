/**
 * Shared engine harness for parity suites.
 *
 * Historically three hand-written engines; today one engine, two artifacts —
 * the native addon and the wasm build. The harness keeps its shape (an engine
 * table, the transform-and-compare loop, the warning capture) because the
 * parity QUESTION survives the consolidation: the two artifacts of the engine
 * must answer identically, and every suite that asserted cross-engine
 * agreement now asserts cross-artifact agreement through the same calls.
 *
 * NOT a `.test.ts` file on purpose: vitest must not collect it as a suite.
 */
import { expect } from 'vitest';

import { isRustTransformAvailable, transformRust, transformWasm } from '../src/index.js';

/** The result surface parity assertions read, common to both artifacts. */
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

/** Both artifacts of the engine, native included whenever the binding is present. */
export const ENGINES: ReadonlyArray<readonly [string, TriEngine]> = [
    ['wasm', transformWasm as TriEngine],
    ...(isRustTransformAvailable() ? ([['rust', transformRust as TriEngine]] as const) : []),
];

/**
 * Collapse whitespace runs so an emit can be substring-matched across engines.
 *
 * Both artifacts splice into the original text, but historical fixtures were
 * written against a lane that re-printed from its AST, so assertions still
 * normalize whitespace before substring-matching.
 *
 * @param code - One engine's emitted module.
 * @returns The same code with every whitespace run collapsed to one space.
 */
export function normalizeEmit(code: string): string {
    return code.replace(/\s+/g, ' ');
}

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
