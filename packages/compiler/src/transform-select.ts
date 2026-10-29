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

import { engineCallOptions } from './engine-call-options.js';
import { chooseEngine } from './engine-choice.js';
import type { UnrenderedTransformResult } from './engine-diagnostics.js';
import type { SourceTransformResult, TransformSourceOptions } from './transform-core.js';
import { transformRust, transformRustUnrendered } from './transform-rust.js';
import { transformWasm, transformWasmUnrendered } from './transform-wasm.js';

/**
 * Transform one module on the artifact `options.parser` (or `CSSZYX_PARSER`)
 * names, else on the native addon, falling back to wasm when it is not
 * installed.
 *
 * @param source Source module contents.
 * @param options Its filename for diagnostics, and the compiler options.
 * @param rest nothing; a third argument is refused.
 * @returns Transform result.
 * @throws {WasmTransformUnavailableError} when neither artifact can load.
 * @throws {CsszyxError} `options-object-required`, for the positional shape.
 */
export function transformSource(
    source: string,
    options: TransformSourceOptions = {},
    ...rest: never[]
): SourceTransformResult {
    engineCallOptions('transformSource', options, rest);
    return chooseEngine(options.parser) === 'rust'
        ? transformRust(source, options)
        : transformWasm(source, options);
}

/**
 * {@link transformSource} with every diagnostic left for the caller to
 * render; see `transformRustUnrendered`.
 *
 * @internal The build lanes' transform; not a stable API.
 * @param source Source module contents.
 * @param options Its filename for diagnostics, and the compiler options.
 * @param rest nothing; a third argument is refused.
 * @returns Transform result.
 * @throws {WasmTransformUnavailableError} when neither artifact can load.
 * @throws {CsszyxError} `options-object-required`, for the positional shape.
 */
export function transformSourceUnrendered(
    source: string,
    options: TransformSourceOptions = {},
    ...rest: never[]
): UnrenderedTransformResult {
    engineCallOptions('transformSourceUnrendered', options, rest);
    return chooseEngine(options.parser) === 'rust'
        ? transformRustUnrendered(source, options)
        : transformWasmUnrendered(source, options);
}
