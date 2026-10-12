import { isRustTransformAvailable, scanGlobalVarUsagesRust } from './transform-rust.js';
import { scanGlobalVarUsagesWasm } from './transform-wasm.js';

/**
 * Kind of out-of-band global custom-property usage. `parse-error` stands for
 * a file the engine could not parse, so none of its usages could be read.
 */
export type GlobalVarUsageKind =
    | 'style-set-property'
    | 'style-get-property'
    | 'style-remove-property'
    | 'jsx-style-key'
    | 'class-string-var-reference'
    | 'parse-error';

/** Source location for one out-of-band usage. */
export interface GlobalVarUsageLocation {
    /** Source file path. */
    filePath: string;
    /** 1-based source line. */
    line: number;
    /** 1-based source column, in UTF-16 code units. */
    column: number;
}

/** One out-of-band global custom-property usage diagnostic. */
export interface GlobalVarUsageDiagnostic {
    /** Usage kind. */
    kind: GlobalVarUsageKind;
    /** Custom-property name including leading `--`; empty for `parse-error`. */
    name: string;
    /** Source location. */
    location: GlobalVarUsageLocation;
    /** Human-readable message. */
    message: string;
}

/** Options for JS/JSX global variable usage scanning. */
export interface ScanGlobalVarUsagesOptions {
    /** Candidate tokens to report. Undefined reports every concrete token. */
    tokens?: Iterable<string>;
}

/** Which usages a batch scan reports, as it crosses into the engine. */
export interface GlobalVarUsageQuery {
    /** Report only these custom properties; every one when absent. */
    tokens?: string[];
}

/** One module handed to a batch scan. */
export interface GlobalVarSourceFile {
    /** Module filename; its extension picks the grammar. */
    filename: string;
    /** Module source text. */
    source: string;
}

/**
 * Scans JS/TS/JSX/TSX source for global custom-property usages csszyx does not
 * currently rewrite, through whichever engine artifact this host can run.
 *
 * A file the engine cannot parse answers one `parse-error` record at its first
 * syntax error: none of its usages could be checked.
 *
 * @param source Source text.
 * @param filename Source filename.
 * @param options Scanner options.
 * @returns Out-of-band usage diagnostics.
 */
export function scanGlobalVarUsages(
    source: string,
    filename = 'file.tsx',
    options: ScanGlobalVarUsagesOptions = {},
): GlobalVarUsageDiagnostic[] {
    const scan = isRustTransformAvailable() ? scanGlobalVarUsagesRust : scanGlobalVarUsagesWasm;
    const query: GlobalVarUsageQuery =
        options.tokens === undefined ? {} : { tokens: [...options.tokens] };
    // One file in, one list out: flattening the batch answer is that list.
    return scan([{ filename, source }], query).flat();
}
