/**
 * The cross-module registry extractor: every exported szv factory and static
 * sz object in one module, and every name it re-exports from another.
 *
 * Both answers come from the engine, through whichever artifact this host
 * runs (`scanModuleLinks`). The values in particular are evaluated by the
 * engine's own readers — the ones the same initializer would meet written
 * beside its use — so an export qualifies across a module boundary exactly
 * when it would compile locally. An evaluator kept here instead would be a
 * second copy of that threshold, and the copy that lived here was narrower:
 * `const S = 4; export const card = { p: S }` was refused while the same two
 * lines compiled in the importing file.
 *
 * The registry is still built once by the bundler and fed to every engine
 * identically; each engine then compiles what it is handed through the code
 * its local candidates use.
 */
import { type CrossModuleRegistryEntry, scanModuleLinks } from './module-links.js';
import type { ParserMode } from './parser-mode.js';

export type { CrossModuleExportKind, CrossModuleRegistryEntry } from './module-links.js';

/**
 * One export that names a value another module declares.
 *
 * Not a kind of {@link CrossModuleRegistryEntry}: it carries no value, because
 * the value is in a module this parse has not read. A consumer handed one as if
 * it were an entry would compile against nothing. Following it is a separate
 * pass over a registry that has read the provider too.
 */
export interface CrossModuleForward {
    /** The name this module exports, and therefore the one an importer writes. */
    exportName: string;
    /** The name the provider module exports it as; `default` for the default slot. */
    importedName: string;
    /** The provider specifier, exactly as this module spelled it. */
    specifier: string;
}

/**
 * Extract every exported szv factory and static sz object from one module, for
 * the bundler's cross-module registry.
 *
 * Read by the engine: `export const X = …`, `const X = …; export { X as Y }`
 * and `export default <object or factory>` are recorded under the name an
 * importer writes. A plain object needs `const` unless it fills the default
 * slot; type-only exports, `export … from` and names the runtime owns are
 * skipped.
 *
 * @param source - Module source text.
 * @param filename - Module filename, for parser dialect detection.
 * @param parser - The engine artifact `build.parser` names, if any.
 * @returns The exported values, declaration order preserved.
 */
export function extractCrossModuleRegistryEntries(
    source: string,
    filename: string,
    parser?: ParserMode,
): CrossModuleRegistryEntry[] {
    return scanModuleLinks([{ filename, source }], { registryEntries: true }, parser).flatMap(
        links => links.registryEntries,
    );
}

/**
 * Extract every re-exported name in one module, with the module it points at.
 *
 * Separate from {@link extractCrossModuleRegistryEntries} because the answers
 * are different in kind: that one returns values a consumer can compile, this
 * one returns links a later pass must still follow. Merging them would put an
 * entry with no value into the registry, which every consumer would have to
 * learn to refuse.
 *
 * `export *` is deliberately absent. It carries no export name, so it cannot be
 * filed under one — answering it needs the provider's whole export list, which
 * is a different question from following one link.
 *
 * @param source - Module source text.
 * @param filename - Module filename, for parser dialect detection.
 * @param parser - The engine artifact `build.parser` names, if any.
 * @returns The forwards, declaration order preserved.
 */
export function extractCrossModuleForwards(
    source: string,
    filename: string,
    parser?: ParserMode,
): CrossModuleForward[] {
    // The engine reads the module record, frees its parse before it returns,
    // and skips the parse for a module with no `export {` clause.
    return scanModuleLinks([{ filename, source }], {}, parser).flatMap(links => links.forwards);
}
