import { isRustTransformAvailable, scanModuleLinksRust } from './transform-rust.js';
import { scanModuleLinksWasm } from './transform-wasm.js';

/**
 * What a module links to, read by the engine's own parser: the stylesheets it
 * imports and the names it re-exports from other modules.
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

/** The links one module carries. */
export interface ModuleLinks {
    /** Stylesheet specifiers, query suffix kept, in source order, each once. */
    cssImports: string[];
    /** Re-exported names, declaration order preserved. */
    forwards: ModuleForward[];
}

/** One module handed to the scan. */
export interface ModuleLinksFile {
    /** Module path, which also picks the parser dialect. */
    filename: string;
    /** Module source text. */
    source: string;
}

/**
 * Read module links through whichever engine artifact this host can run.
 *
 * @param files - Modules to read.
 * @returns One answer per module, in input order.
 */
export function scanModuleLinks(files: readonly ModuleLinksFile[]): ModuleLinks[] {
    return isRustTransformAvailable() ? scanModuleLinksRust(files) : scanModuleLinksWasm(files);
}
