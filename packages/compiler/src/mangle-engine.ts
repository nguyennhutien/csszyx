/**
 * The class-name encoder and the mangle map's checksum, on the engine
 * artifact the build runs on.
 *
 * A native build reaches neither through the wasm artifact, which it would
 * otherwise load for these two alone. Both artifacts give the same answers.
 *
 * @module mangle-engine
 */

import { chooseEngine } from './engine-choice.js';
import type { ParserMode } from './parser-mode.js';
import { computeMangleChecksumRust, encodeClassNameRust } from './transform-rust.js';
import { computeMangleChecksumWasm, encodeClassNameWasm } from './transform-wasm.js';

/**
 * Where the mangle helpers run.
 *
 * @internal Used by `@csszyx/unplugin`; not a stable API.
 */
export interface MangleEngineOptions {
    /**
     * The artifact `build.parser` names, if any; `CSSZYX_PARSER` overrides it,
     * as it does for the transform.
     */
    parser?: ParserMode;
}

/**
 * The encoder for mangled class names, settled on one artifact once, for a
 * caller that encodes many indices.
 *
 * @internal Used by `@csszyx/unplugin`; not a stable API.
 * @param options - The artifact.
 * @returns A function from an index to its name.
 */
export function classNameEncoder(options: MangleEngineOptions = {}): (index: number) => string {
    return chooseEngine(options.parser) === 'rust' ? encodeClassNameRust : encodeClassNameWasm;
}

/**
 * The mangle map's checksum, which the browser recomputes from the map the
 * page carries.
 *
 * @internal Used by `@csszyx/unplugin`; not a stable API.
 * @param map - Original class name → mangled name; own keys only.
 * @param options - The artifact.
 * @returns The checksum.
 */
export function computeMangleChecksum(
    map: Readonly<Record<string, string>>,
    options: MangleEngineOptions = {},
): string {
    return chooseEngine(options.parser) === 'rust'
        ? computeMangleChecksumRust(map)
        : computeMangleChecksumWasm(map);
}
