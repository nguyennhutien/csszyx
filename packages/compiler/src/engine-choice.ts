/**
 * Which engine artifact a call runs on: the choice `build.parser` makes for
 * the transform, so a build pinned to one artifact runs every engine call on
 * it, not the transform alone.
 *
 * @module engine-choice
 */

import { type ParserMode, resolveParserMode } from './parser-mode.js';
import { isRustTransformAvailable } from './transform-rust.js';
import { isWasmTransformAvailable } from './transform-wasm.js';

/**
 * The artifact to run on.
 *
 * @param parser - The artifact asked for, as `build.parser` names it, if any.
 *   `CSSZYX_PARSER` overrides it; with neither, the native addon, falling back
 *   to wasm when no native binary is installed. An explicit `rust` does not
 *   fall back, so its failure names the platform package.
 * @returns The artifact.
 */
export function chooseEngine(parser: ParserMode | undefined): ParserMode {
    return resolveParserMode({
        configParser: parser,
        envParser: process.env.CSSZYX_PARSER,
        defaultParser: 'rust',
        isRustAvailable: isRustTransformAvailable,
        isWasmAvailable: isWasmTransformAvailable,
    }).parser;
}
