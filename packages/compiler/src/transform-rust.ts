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
} from './transform.js';

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
    const [result] = transformRustBatch([{ filename, source }], options);
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
 * @param input Alias table input.
 * @returns Native alias entries.
 */
function normalizeGlobalVarAliases(
    input: GlobalVarAliasTableInput | undefined,
): Array<{ original: string; alias: string }> {
    if (!input) {
        return [];
    }
    const entries =
        input instanceof Map
            ? input.entries()
            : Array.isArray(input)
              ? input
              : Object.entries(input);
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
        usesRuntime: result.metadata.usesRuntime,
        usesMerge: result.metadata.usesMerge,
        usesColorVar: result.metadata.usesColorVar,
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
function aggregateCssVariableMap(
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
