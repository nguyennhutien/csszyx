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
import { createRequire } from 'node:module';
import { transformBatch } from '@csszyx/core/native';
import { expect } from 'vitest';
import {
    isRustTransformAvailable,
    scanGlobalVarUsagesRust,
    scanGlobalVarUsagesWasm,
    scanModuleLinksRust,
    scanModuleLinksWasm,
    transformRust,
    transformWasm,
} from '../src/engine.js';
import type {
    GlobalVarSourceFile,
    GlobalVarUsageDiagnostic,
    GlobalVarUsageQuery,
    ModuleLinks,
    ModuleLinksFile,
    ModuleLinksQuery,
    SourceTransformResult,
    TransformSourceOptions,
} from '../src/index.js';
import {
    transformRustUnrendered,
    transformWasmUnrendered,
    type UnrenderedTransformResult,
} from '../src/internal.js';
import { nativeLaneRequired, REQUIRE_NATIVE_ENV } from './helpers/native-lane.js';

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
    /** The one-class objects of a pass with no merge table, placed at their keys. */
    singleClassGroups?: SourceTransformResult['singleClassGroups'];
    /** The class-name and `sz` pairs a merge would read, from a pass with no table. */
    mergeOverrides?: SourceTransformResult['mergeOverrides'];
}

/** One engine entry, narrowed to the shared result surface. */
export type ParityEngine = (source: string, options?: TransformSourceOptions) => EngineParityResult;

/** Set to `1` to run the parity suites on the wasm artifact alone, outside CI. */
export const WASM_ONLY_ENV = 'CSSZYX_TEST_WASM_ONLY';

/**
 * Decide whether the native lane runs, and refuse a silent wasm-only run.
 *
 * Without the binding every parity suite would pass on one artifact, so a RED
 * run could be red on wasm alone. A machine that cannot build the addon opts
 * out by name; CI never can, because its native build step must have run,
 * and neither can a run that sets `CSSZYX_REQUIRE_NATIVE=1`.
 *
 * @param available Whether the native binding loaded.
 * @param env The environment to read the opt-out and `CI` from.
 * @returns Whether the native lane runs.
 */
export function assertRustLane(available: boolean, env: NodeJS.ProcessEnv): boolean {
    if (available) {
        return true;
    }
    if (nativeLaneRequired(env)) {
        throw new Error(
            `engine parity harness: the rust lane is unavailable under CI or ${REQUIRE_NATIVE_ENV}=1 — ` +
                'the native engine build step failed or was skipped.',
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

/** One artifact's transform that leaves its diagnostics for the caller to render. */
export type UnrenderedEngine = (
    source: string,
    options?: TransformSourceOptions,
) => UnrenderedTransformResult;

/**
 * Each artifact's unrendered transform beside its rendering one, as the
 * build lanes call it; wasm alone only under {@link WASM_ONLY_ENV}.
 */
export const UNRENDERED_ENGINES: ReadonlyArray<readonly [string, ParityEngine, UnrenderedEngine]> =
    [
        ['wasm', transformWasm as ParityEngine, transformWasmUnrendered],
        ...(RUST_LANE
            ? ([['rust', transformRust as ParityEngine, transformRustUnrendered]] as const)
            : []),
    ];

/** One module-link scanner: the same question the transform table asks, for links. */
export type LinkScanner = (
    files: readonly ModuleLinksFile[],
    query?: ModuleLinksQuery,
) => ModuleLinks[];

/** Both artifacts' module-link scan; wasm alone only under {@link WASM_ONLY_ENV}. */
export const LINK_SCANNERS: ReadonlyArray<readonly [string, LinkScanner]> = [
    ['wasm', scanModuleLinksWasm],
    ...(RUST_LANE ? ([['rust', scanModuleLinksRust]] as const) : []),
];

/** One global-var usage scanner: the out-of-band usages of each file, batched. */
export type GlobalVarScanner = (
    files: readonly GlobalVarSourceFile[],
    query?: GlobalVarUsageQuery,
) => GlobalVarUsageDiagnostic[][];

/** Both artifacts' global-var usage scan; wasm alone only under {@link WASM_ONLY_ENV}. */
export const GLOBAL_VAR_SCANNERS: ReadonlyArray<readonly [string, GlobalVarScanner]> = [
    ['wasm', scanGlobalVarUsagesWasm],
    ...(RUST_LANE ? ([['rust', scanGlobalVarUsagesRust]] as const) : []),
];

/**
 * Narrow a batch scanner to the public single-file call shape.
 *
 * @param scan - One artifact's batch scanner.
 * @returns A scanner taking one source, as `scanGlobalVarUsages` does.
 */
export function scanOneFile(
    scan: GlobalVarScanner,
): (source: string, filename: string, query?: GlobalVarUsageQuery) => GlobalVarUsageDiagnostic[] {
    return (source, filename, query) => scan([{ filename, source }], query).flat();
}

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

/** The wasm artifact's batch entry, as the harness calls it directly. */
interface ParserWasmBatch {
    transform_batch_json(filesJson: string, optionsJson: string): string;
}

/** Every option the wasm artifact requires, at its default. */
const WASM_DEFAULT_OPTIONS = JSON.stringify({
    mangle_vars: false,
    mangle_var_hoist_max_depth: null,
    global_var_aliases: [],
});

/**
 * The spans text each artifact writes for one file, read straight from each
 * binding: what the shared decoder reads, before any of it runs. The wasm
 * artifact writes it as the `spans` string of its result.
 *
 * @param source - Full module source.
 * @param filename - Filename handed to the engine.
 * @returns Each artifact's text, or `undefined` for an artifact that wrote
 *          none; `rust` only when the native lane runs.
 */
export function engineSpansText(
    source: string,
    filename = '/p/t.tsx',
): { wasm: unknown; rust?: unknown } {
    const wasm = createRequire(import.meta.url)('@csszyx/core/parser-wasm') as ParserWasmBatch;
    const [fromWasm] = JSON.parse(
        wasm.transform_batch_json(JSON.stringify([{ filename, source }]), WASM_DEFAULT_OPTIONS),
    ) as Array<{ spans?: unknown }>;
    if (!RUST_LANE) return { wasm: fromWasm?.spans };
    const [fromRust] = transformBatch([{ filename, source }]) as Array<{ spans?: unknown }>;
    return { wasm: fromWasm?.spans, rust: fromRust?.spans };
}

/**
 * Assert both artifacts write the same spans text for one file, character
 * for character.
 *
 * Both come from one writer in the engine, so any difference is a lane that
 * stopped going through it.
 *
 * @param source - Full module source.
 * @param filename - Filename handed to the engine.
 */
export function expectSpansTextEqual(source: string, filename = '/p/t.tsx'): void {
    const { wasm, rust } = engineSpansText(source, filename);
    expect.soft(typeof wasm, `wasm spans text for ${JSON.stringify(source)}`).toBe('string');
    if (!RUST_LANE) return;
    expect.soft(typeof rust, `rust spans text for ${JSON.stringify(source)}`).toBe('string');
    expect(rust, JSON.stringify(source)).toBe(wasm);
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
        const code = transform(tsx, { filename: 'engine-parity.tsx' }).code ?? '';
        const emitted = /className="([^"]*)"/.exec(code)?.[1] ?? '';
        expect(emitted, `${name} — ${sz}`).toBe(expected);
    }
    expectSpansTextEqual(tsx, 'engine-parity.tsx');
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
 * The engine reports through `diagnostics`, and transform-core's shared
 * helpers can still warn through the console; parity assertions need the
 * union of both, minus the one-time "Tip: run a full project scan" hint whose
 * firing depends on suite order.
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
        result = engine(source, { filename });
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
