/**
 * Engine selection for callers that just want the transform done.
 *
 * One engine, two artifacts: prefer the native addon, fall back to the wasm
 * build the package itself ships. Both answer identically — that is gated by
 * the parity corpus and the lane tests — so the choice here is purely about
 * speed, never behaviour.
 *
 * The signature deliberately matches the deleted Babel-era
 * `transformSourceCode`, so its call sites (the CLI project scan, the MCP
 * compile preview, and a large body of tests that used it as a driver)
 * migrate by renaming the import.
 */
import type { SourceTransformResult, TransformSourceCodeOptions } from './transform-core.js';
import { isRustTransformAvailable, transformRust } from './transform-rust.js';
import { transformWasm } from './transform-wasm.js';

/**
 * Transform one module through whichever engine artifact this host can run.
 *
 * @param source Source module contents.
 * @param filename Source filename for diagnostics.
 * @param options Compiler options.
 * @returns Transform result.
 * @throws {WasmTransformUnavailableError} when neither artifact can load.
 */
export function transformSource(
    source: string,
    filename?: string,
    options?: TransformSourceCodeOptions,
): SourceTransformResult {
    return isRustTransformAvailable()
        ? transformRust(source, filename, options)
        : transformWasm(source, filename, options);
}
