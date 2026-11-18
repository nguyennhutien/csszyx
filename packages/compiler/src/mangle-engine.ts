/**
 * The class-name encoder, the mangle map's checksum, the class names of an
 * HTML page and the texts a class attribute reads as, on the engine artifact
 * the build runs on.
 *
 * A native build reaches none of them through the wasm artifact, which it
 * would otherwise load for these alone. Both artifacts give the same answers.
 *
 * @module mangle-engine
 */

import { chooseEngine } from './engine-choice.js';
import type { ParserMode } from './parser-mode.js';
import {
    classAttributeReadingsRust,
    computeMangleChecksumRust,
    encodeClassNameRust,
    htmlClassNamesRust,
} from './transform-rust.js';
import {
    classAttributeReadingsWasm,
    computeMangleChecksumWasm,
    encodeClassNameWasm,
    htmlClassNamesWasm,
} from './transform-wasm.js';

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

/**
 * One class name of a `class` attribute the HTML tokenizer reads.
 *
 * @internal Used by `@csszyx/unplugin`; not a stable API.
 */
export interface HtmlClassName {
    /** Where its spelling starts, in UTF-16 units. */
    start: number;
    /** Where its spelling ends. */
    end: number;
    /** The name it decodes to: `a&amp;b` is spelled with the reference. */
    name: string;
}

/**
 * Every class name of every `class` attribute an HTML text holds, read as
 * the tokenizer reads it with scripting off, so `noscript` markup counts: not
 * in a comment, a script or another attribute's value, the first `class` of
 * an element only, a value split after its character references decode. A
 * class list holding `&name;` with a name outside the 106 legacy ones and
 * `apos` gives none; an `&` that starts no name is text (`R&D`).
 * Replacing a name's spelling keeps every other byte of the page as written.
 *
 * One reader for every lane: migrate converts what it reads
 * (`packages/core/src/html_text.rs`).
 *
 * @internal Used by `@csszyx/unplugin`; not a stable API.
 * @param html - HTML text.
 * @param options - The artifact.
 * @returns The names, in text order.
 */
export function htmlClassNames(html: string, options: MangleEngineOptions = {}): HtmlClassName[] {
    return chooseEngine(options.parser) === 'rust'
        ? htmlClassNamesRust(html)
        : htmlClassNamesWasm(html);
}

/**
 * Every text a class attribute string written as `raw` can put in the DOM:
 * as JSX reads it, then as HTML does, each once; `raw` itself is one when a
 * language reads it as written. A scanner that cannot tell a file's language
 * reads them all, so the census of names a page carries misses none.
 *
 * One decoder for every lane: JSX by the transform's own reading
 * (`jsx_text.rs`), HTML by the class reader (`html_text.rs`).
 *
 * @internal Used by `@csszyx/unplugin`; not a stable API.
 * @param raw - The attribute string as written, between its quotes.
 * @param options - The artifact.
 * @returns The texts.
 */
export function classAttributeReadings(raw: string, options: MangleEngineOptions = {}): string[] {
    return chooseEngine(options.parser) === 'rust'
        ? classAttributeReadingsRust(raw)
        : classAttributeReadingsWasm(raw);
}
