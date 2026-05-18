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
 * @param _source Source module contents.
 * @param _filename Source filename for diagnostics.
 * @param _options Compiler options.
 * @returns Transform result once the Rust core exists.
 * @throws {OxcRustNotImplementedError} until the Rust core lands.
 */
export function transformRust(
    _source: string,
    _filename?: string,
    _options?: TransformSourceCodeOptions,
): SourceTransformResult {
    throw new OxcRustNotImplementedError('Rust core scaffold only; use parser "oxc" or "babel"');
}
