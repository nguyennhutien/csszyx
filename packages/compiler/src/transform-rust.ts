import {
    CsszyxNativeUnavailableError,
    type NativeTransformResult,
    transformBatch,
} from '@csszyx/core/native';

import type { SourceTransformResult, TransformSourceCodeOptions } from './transform.js';

/**
 * Thrown while the Rust maximum-speed transform is scaffolded but not yet implemented.
 */
export class OxcRustNotImplementedError extends Error {
    /**
     * @param detail What the caller attempted to execute.
     */
    constructor(detail: string) {
        super(`transformRust: not implemented yet - ${detail}`);
        this.name = 'OxcRustNotImplementedError';
    }
}

/**
 * Placeholder for the future Rust transform core.
 *
 * The function is exported and wired behind `build.parser: 'rust'` so the
 * unplugin, config types, and benchmark harness can carry the third parser
 * mode without changing the default parser or silently falling back.
 *
 * @param source Source module contents.
 * @param filename Source filename for diagnostics.
 * @param _options Compiler options.
 * @returns Transform result once the Rust core exists.
 * @throws {OxcRustNotImplementedError} until the Rust core lands.
 */
export function transformRust(
    source: string,
    filename?: string,
    _options?: TransformSourceCodeOptions,
): SourceTransformResult {
    try {
        const [result] = transformBatch([{ filename: filename ?? 'file.tsx', source }]);
        if (!result) {
            throw new OxcRustNotImplementedError('native transform returned no result');
        }
        return fromNativeResult(result);
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
    };
}
