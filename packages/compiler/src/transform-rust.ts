import {
    CsszyxNativeUnavailableError,
    type NativeTransformResult,
    transformBatch,
} from '@csszyx/core/native';

import type {
    CssVariableMangleValue,
    GlobalVarAliasTableInput,
    SourceTransformResult,
    TransformSourceCodeOptions,
} from './transform-core.js';

/**
 * Source file passed to the Rust native batch transform.
 */
export interface TransformRustFile {
    /** Source filename for diagnostics and recovery-token stability. */
    filename?: string;
    /** Source module contents. */
    source: string;
}

/**
 * Thrown when the Rust native transform cannot execute for the current host.
 *
 * The class name is kept for compatibility with earlier scaffold-era callers.
 */
export class OxcRustNotImplementedError extends Error {
    /**
     * @param detail Native loader or transform failure detail.
     */
    constructor(detail: string) {
        super(`transformRust: native engine unavailable - ${detail}`);
        this.name = 'OxcRustNotImplementedError';
    }
}

/**
 * Transform source through the Rust native engine.
 *
 * @param source Source module contents.
 * @param filename Source filename for diagnostics.
 * @param options Compiler options.
 * @returns Transform result.
 * @throws {OxcRustNotImplementedError} when the native addon is unavailable.
 */
export function transformRust(
    source: string,
    filename?: string,
    options?: TransformSourceCodeOptions,
): SourceTransformResult {
    // The single-file path names an unnamed module `<anonymous>` — the same
    // answer the shared JS channel always gave — while the BATCH default stays
    // index-based so recovery tokens keep unique per-file inputs.
    const [result] = transformRustBatch([{ filename: filename ?? '<anonymous>', source }], options);
    if (!result) {
        throw new OxcRustNotImplementedError('native transform returned no result');
    }
    return result;
}

/**
 * Verify that the native Rust transform binding can be loaded.
 *
 * This is intentionally separate from `transformRust()` so build integrations
 * can validate the explicit `rust` parser contract before serving cached
 * output. If the native addon is missing, `rust` must fail loudly instead of
 * returning a stale cache entry.
 *
 * @throws {OxcRustNotImplementedError} when the native addon is unavailable.
 */
export function ensureRustTransformAvailable(): void {
    try {
        transformBatch([]);
    } catch (err) {
        if (err instanceof OxcRustNotImplementedError) {
            throw err;
        }
        if (err instanceof CsszyxNativeUnavailableError) {
            throw new OxcRustNotImplementedError(
                `${err.message}; native package: ${err.packageName ?? 'unsupported platform'}`,
            );
        }
        throw err;
    }
}

/** Memoized result of the native-availability probe (loading the addon is a
 * one-time cost; the binary cannot appear or vanish mid-process). */
let rustAvailability: boolean | undefined;

/**
 * Non-throwing companion to {@link ensureRustTransformAvailable}: returns whether
 * the native Rust addon can be loaded on the current host. Build integrations use
 * it to gracefully degrade the DEFAULT `rust` parser to `oxc` when no prebuilt
 * binary is installed for the platform (unsupported arch, optional deps omitted,
 * or a cross-platform frozen lockfile) — instead of hard-failing a build the user
 * never explicitly opted into `rust` for. An EXPLICIT `rust` choice must still use
 * {@link ensureRustTransformAvailable} so it fails loudly.
 *
 * @returns true when the native transform is usable, false otherwise.
 */
export function isRustTransformAvailable(): boolean {
    if (rustAvailability === undefined) {
        try {
            ensureRustTransformAvailable();
            rustAvailability = true;
        } catch {
            rustAvailability = false;
        }
    }
    return rustAvailability;
}

/**
 * Transform a batch of files through the Rust native engine in one napi call.
 *
 * This is the compiler-level wrapper around `@csszyx/core/native`'s batch API.
 * It keeps JS callers on the normal `SourceTransformResult` contract while
 * preserving the Rust core's FFI amortization for benchmarks and future build
 * integrations.
 *
 * @param files Source files to transform.
 * @param options Compiler options reserved for future native config plumbing.
 * @returns One transform result per input file, in input order.
 * @throws {OxcRustNotImplementedError} when the native addon is unavailable.
 */
export function transformRustBatch(
    files: readonly TransformRustFile[],
    options?: TransformSourceCodeOptions,
): SourceTransformResult[] {
    try {
        return transformBatch(
            files.map((file, index) => ({
                filename: file.filename ?? `file-${index}.tsx`,
                source: file.source,
            })),
            {
                mangleVars: options?.mangleVars === true,
                mangleVarHoistMaxDepth: options?.mangleVarHoistMaxDepth,
                globalVarAliases: normalizeGlobalVarAliases(options?.globalVarAliases),
                rootDir: options?.rootDir,
                // The node cap must reach the native parser too: engines count
                // AST nodes differently, so an oxc-passing page file can trip
                // the default cap under rust only — and the user's raised
                // `build.astBudgetLimit` has to apply to whichever engine trips.
                astBudget: options?.astBudget,
                crossModuleStaticsJson: encodeCrossModuleStatics(options?.crossModuleStatics),
                // Its own field, not folded into the szv payload: the two
                // registries share a transport but not a meaning, and the
                // native side picks different machinery for each.
                crossModuleSzObjectsJson: encodeCrossModuleStatics(options?.crossModuleSzObjects),
            },
        ).map(fromNativeResult);
    } catch (err) {
        if (err instanceof OxcRustNotImplementedError) {
            throw err;
        }
        if (err instanceof CsszyxNativeUnavailableError) {
            throw new OxcRustNotImplementedError(
                `${err.message}; native package: ${err.packageName ?? 'unsupported platform'}`,
            );
        }
        throw err;
    }
}

/**
 * Normalize compiler alias-table options for the native NAPI object shape.
 *
 * Shared with the wasm lane (`transform-wasm.ts`) — same engine, same option
 * normalization; a second copy is exactly the drift the parity gates exist to
 * catch.
 *
 * @param input Alias table input.
 * @returns Native alias entries.
 */
export function normalizeGlobalVarAliases(
    input: GlobalVarAliasTableInput | undefined,
): Array<{ original: string; alias: string }> {
    if (!input) {
        return [];
    }
    let entries: Iterable<[string, string]>;
    if (input instanceof Map) entries = input.entries();
    else if (Array.isArray(input)) entries = input;
    else entries = Object.entries(input);
    return [...entries]
        .filter(([original, alias]) => original.startsWith('--') && alias.startsWith('--'))
        .map(([original, alias]) => ({ original, alias }));
}

/**
 * Convert the native package result shape into the compiler result shape.
 *
 * @param result Native transform result.
 * @returns Compiler transform result.
 */
function fromNativeResult(result: NativeTransformResult): SourceTransformResult {
    return {
        code: result.code,
        transformed: result.metadata.transformed,
        usesSzvPick: (result.metadata as { usesSzvPick?: boolean }).usesSzvPick ?? false,
        usesSzvPick1: (result.metadata as { usesSzvPick1?: boolean }).usesSzvPick1 ?? false,
        szPartArgsProvable:
            (result.metadata as { szPartArgsProvable?: boolean }).szPartArgsProvable ?? false,
        usesRuntime: result.metadata.usesRuntime,
        usesMerge: result.metadata.usesMerge,
        usesSzcn: result.metadata.usesSzcn,
        usesSzPart: result.metadata.usesSzPart,
        usesColorVar: result.metadata.usesColorVar,
        usesSpacingVar: result.metadata.usesSpacingVar ?? false,
        usesUnitVar: result.metadata.usesUnitVar ?? false,
        classes: new Set(result.classes),
        rawClassNames: new Set(result.rawClassNames),
        diagnostics: result.diagnostics,
        recoveryTokens: new Map(
            result.recoveryTokens.map(({ token, ...data }) => [
                token,
                {
                    mode: data.mode,
                    component: data.component,
                    path: data.path,
                },
            ]),
        ),
        cssVariableMap: aggregateCssVariableMap(result.cssVariableMap ?? []),
    };
}

/**
 * Converts native CSS variable map entries into compiler metadata.
 *
 * @param entries Native original/mangled pairs.
 * @returns Compiler metadata map with one-to-many fanout preserved.
 */
export function aggregateCssVariableMap(
    entries: Array<{ original: string; mangled: string }>,
): Map<string, CssVariableMangleValue> {
    const map = new Map<string, CssVariableMangleValue>();
    for (const entry of entries) {
        const existing = map.get(entry.original);
        if (!existing) {
            map.set(entry.original, entry.mangled);
            continue;
        }
        const values = Array.isArray(existing) ? existing : [existing];
        if (!values.includes(entry.mangled)) {
            map.set(entry.original, [...values, entry.mangled]);
        }
    }
    return map;
}

/** One value in the ordered transport: scalar or nested ordered pairs. */
type OrderedTransportValue = string | number | boolean | Array<[string, OrderedTransportValue]>;

/**
 * Serialize the cross-module registry as ordered `[key, value]` pairs.
 *
 * Arrays survive every JSON library with order intact, where a map would be
 * re-sorted — and table/dimension order fixes emitted class order, so the
 * native engine must see EXACTLY the iteration order the JS lanes consumed.
 * `Object.entries` supplies that order (integer-like keys first, ascending).
 *
 * @param statics - The per-file registry entries, or undefined.
 * @returns JSON payload, or undefined when there is nothing to pass.
 */
export function encodeCrossModuleStatics(
    statics: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
): string | undefined {
    if (statics === undefined || Object.keys(statics).length === 0) {
        return undefined;
    }
    const payload = Object.entries(statics).map(([specifier, entries]) => [
        specifier,
        Object.entries(entries).map(([name, config]) => [name, encodeOrderedValue(config)]),
    ]);
    return JSON.stringify(payload);
}

/**
 * Encode one config value as ordered pairs.
 *
 * @param value - Plain config value.
 * @returns The ordered transport form; non-object scalars pass through, and
 * anything outside the literal contract (null, arrays) passes as-is so the
 * native decoder rejects that entry rather than this side guessing.
 */
function encodeOrderedValue(value: unknown): unknown {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
            key,
            encodeOrderedValue(entry),
        ]);
    }
    return value as OrderedTransportValue;
}
