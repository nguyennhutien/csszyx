import { engineCallOptions } from './engine-call-options.js';
import { chooseEngine } from './engine-choice.js';
import type { ParserMode } from './parser-mode.js';
import { scanModuleLinksRust } from './transform-rust.js';
import { scanModuleLinksWasm } from './transform-wasm.js';

/**
 * What a module links to, read by the engine's own parser: the stylesheets it
 * imports, the names it re-exports from other modules, and, when asked, the
 * values it exports for the cross-module registry.
 */

/** One name a module exports without declaring it. */
export interface ModuleForward {
    /** The name this module exports, and therefore the one an importer writes. */
    exportName: string;
    /** The name the provider exports it as; `default` for the default slot. */
    importedName: string;
    /** The provider specifier, exactly as this module spelled it. */
    specifier: string;
}

/**
 * What one recorded export IS, because the two are not interchangeable.
 *
 * `szv-config` is a variant TABLE the consumer compiles and then picks from.
 * `sz-object` is a VALUE the consumer lowers exactly as it would the same
 * literal written locally. Carrying them untagged would leave every reader —
 * including the native decoder — guessing which machinery applies.
 */
export type CrossModuleExportKind = 'szv-config' | 'sz-object';

/** One exported value an importing module may compile against. */
export interface CrossModuleRegistryEntry {
    /** What the value is, and therefore how a consumer must treat it. */
    kind: CrossModuleExportKind;
    /** The exported binding name; `default` for the default slot. */
    exportName: string;
    /** Statically evaluated payload: an szv config, or the sz object itself. */
    value: Record<string, unknown>;
}

/** The links one module carries. */
export interface ModuleLinks {
    /** Stylesheet specifiers, query suffix kept, in source order, each once. */
    cssImports: string[];
    /** Re-exported names, declaration order preserved. */
    forwards: ModuleForward[];
    /** Exported registry values, declaration order kept; empty unless asked for. */
    registryEntries: CrossModuleRegistryEntry[];
}

/** One module handed to the scan. */
export interface ModuleLinksFile {
    /** Module path, which also picks the parser dialect. */
    filename: string;
    /** Module source text. */
    source: string;
}

/** Which optional answers a scan computes. */
export interface ModuleLinksQuery {
    /**
     * Read the values each module exports for the cross-module registry.
     * Off by default: it costs a scope walk per module, and only the registry
     * pass reads the answer.
     */
    registryEntries?: boolean;
}

/** Options for {@link scanModuleLinks}: which answers to compute, and where. */
export interface ScanModuleLinksOptions extends ModuleLinksQuery {
    /**
     * The artifact `build.parser` names, if any; `CSSZYX_PARSER` overrides it,
     * as it does for the transform.
     */
    parser?: ParserMode;
}

/**
 * Read module links on the engine artifact the build runs on.
 *
 * @param files - Modules to read.
 * @param options - Which optional answers to compute, and the artifact.
 * @param rest - nothing; a third argument is refused.
 * @returns One answer per module, in input order.
 * @throws {CsszyxError} `options-object-required`, for the positional shape.
 */
export function scanModuleLinks(
    files: readonly ModuleLinksFile[],
    options: ScanModuleLinksOptions = {},
    ...rest: never[]
): ModuleLinks[] {
    const { parser, ...query } = engineCallOptions('scanModuleLinks', options, rest);
    return chooseEngine(parser) === 'rust'
        ? scanModuleLinksRust(files, query)
        : scanModuleLinksWasm(files, query);
}
