import {
    CsszyxNativeUnavailableError,
    type NativeTransformResult,
    transformBatch,
} from '@csszyx/core/native';

import type { SourceTransformResult, TransformSourceCodeOptions } from './transform.js';

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
    if (options?.mangleVars) {
        throw new OxcRustNotImplementedError(
            'mangleVars is not implemented by the native Rust engine yet; use build.parser: "oxc" for opt-in CSS variable mangling.',
        );
    }
    try {
        return transformBatch(
            files.map((file, index) => ({
                filename: file.filename ?? `file-${index}.tsx`,
                source: file.source,
            })),
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
        cssVariableMap: new Map(),
    };
}
