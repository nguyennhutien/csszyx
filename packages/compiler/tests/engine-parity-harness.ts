/**
 * Shared engine harness for parity suites.
 *
 * Historically three hand-written engines, which is where the old `tri-engine`
 * name came from; today one engine, two artifacts — the native addon and the
 * wasm build. The harness keeps its shape (an engine table, the
 * transform-and-compare loop, the warning capture) because the parity QUESTION
 * survives the consolidation: the two artifacts of the engine
 * must answer identically, and every suite that asserted cross-engine
 * agreement now asserts cross-artifact agreement through the same calls.
 *
 * NOT a `.test.ts` file on purpose: vitest must not collect it as a suite.
 */
import { expect } from 'vitest';

import {
    isRustTransformAvailable,
    type ModuleLinks,
    type ModuleLinksFile,
    type SourceTransformResult,
    scanModuleLinksRust,
    scanModuleLinksWasm,
    type TransformSourceCodeOptions,
    transformRust,
    transformWasm,
} from '../src/index.js';

/** The result surface parity assertions read, common to both artifacts. */
export interface EngineParityResult {
    code?: string;
    diagnostics?: string[];
    /**
     * Safelist candidates, in discovery order. A parity suite that only reads
     * `code` cannot see a class going missing from the safelist while the emit
     * stays identical — the exact shape a runtime fallback produces.
     */
    classes?: Iterable<string>;
    /** The code and position of each diagnostic, index-parallel to `diagnostics`. */
    issues?: SourceTransformResult['issues'];
    /** The class lists a merge would read, from a pass with no merge table. */
    mergeGroups?: SourceTransformResult['mergeGroups'];
    /** The class-name and `sz` pairs a merge would read, from a pass with no table. */
    mergeOverrides?: SourceTransformResult['mergeOverrides'];
}

/** One engine entry, narrowed to the shared result surface. */
export type ParityEngine = (
    source: string,
    filename?: string,
    options?: TransformSourceCodeOptions,
) => EngineParityResult;

/** Set to `1` to run the parity suites on the wasm artifact alone, outside CI. */
export const WASM_ONLY_ENV = 'CSSZYX_TEST_WASM_ONLY';

/**
 * Decide whether the native lane runs, and refuse a silent wasm-only run.
 *
 * Without the binding every parity suite would pass on one artifact, so a RED
 * run could be red on wasm alone. A machine that cannot build the addon opts
 * out by name; CI never can, because its native build step must have run.
 *
 * @param available Whether the native binding loaded.
 * @param env The environment to read the opt-out and `CI` from.
 * @returns Whether the native lane runs.
 */
export function assertRustLane(available: boolean, env: NodeJS.ProcessEnv): boolean {
    if (available) {
        return true;
    }
    if (env.CI) {
        throw new Error(
            'engine parity harness: the rust lane is unavailable under CI — the native ' +
                'engine build step failed or was skipped.',
        );
    }
    if (env[WASM_ONLY_ENV] !== '1') {
        throw new Error(
            'engine parity harness: the native binding is missing, so these suites would ' +
                'pass on the wasm artifact alone. Build it with ' +
                '`pnpm --filter @csszyx/core native:build -- --native-engine`, or set ' +
                `\`${WASM_ONLY_ENV}=1\` to run wasm only on purpose.`,
        );
    }
    return false;
}

/**
 * Whether the native lane runs. Evaluated at module load, so a suite that
 * imports the harness fails as a whole instead of skipping per test.
 */
export const RUST_LANE = assertRustLane(isRustTransformAvailable(), process.env);

/** Both artifacts of the engine; wasm alone only under {@link WASM_ONLY_ENV}. */
export const ENGINES: ReadonlyArray<readonly [string, ParityEngine]> = [
    ['wasm', transformWasm as ParityEngine],
    ...(RUST_LANE ? ([['rust', transformRust as ParityEngine]] as const) : []),
];

/** One module-link scanner: the same question the transform table asks, for links. */
export type LinkScanner = (files: readonly ModuleLinksFile[]) => ModuleLinks[];

/** Both artifacts' module-link scan; wasm alone only under {@link WASM_ONLY_ENV}. */
export const LINK_SCANNERS: ReadonlyArray<readonly [string, LinkScanner]> = [
    ['wasm', scanModuleLinksWasm],
    ...(RUST_LANE ? ([['rust', scanModuleLinksRust]] as const) : []),
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
        const code = transform(tsx, 'engine-parity.tsx').code ?? '';
        const emitted = /className="([^"]*)"/.exec(code)?.[1] ?? '';
        expect(emitted, `${name} — ${sz}`).toBe(expected);
    }
}

/** One captured engine run: the raw result plus its merged warning channel. */
export interface CapturedRun {
    /** The engine's transform result. */
    result: EngineParityResult;
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
    engine: ParityEngine,
    source: string,
    filename = '/p/t.tsx',
): CapturedRun {
    const logged: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
    };
    let result: EngineParityResult;
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
