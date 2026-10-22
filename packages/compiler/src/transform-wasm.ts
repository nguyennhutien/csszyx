/**
 * The wasm lane: the SAME native engine (`parser.rs` + `engine.rs`), compiled
 * to `wasm32-unknown-unknown` and shipped inside `@csszyx/core` as
 * `pkg-parser/`. It exists for machines with no `@csszyx/core-<platform>`
 * binary — there it runs the engine every other machine runs, so the degrade
 * path costs parse speed, never behaviour.
 *
 * The module is REQUIRED LAZILY. On the eight platforms with a native binary
 * this file never loads the ~1.4 MB wasm at all; an eager import would make
 * every process pay for the fallback it does not need.
 *
 * Option normalization (`normalizeGlobalVarAliases`, `encodeCrossModuleStatics`)
 * and CSS-variable-map aggregation are imported from `transform-rust.ts`
 * rather than copied: both lanes feed one engine, and a second copy of the
 * encoding is exactly the drift the parity gates exist to catch.
 */
import { createRequire } from 'node:module';
// Imported directly, not through `./report.js`: Node loads this module, and
// the build makes `./report.js` the whole `@csszyx/compiler/report` subpath,
// where only these entries are needed.
import { WASM_ENGINE_UNAVAILABLE } from './diagnostic-browser.generated.js';
import {
    diagnosticPath,
    type EngineDiagnosticFieldsOf,
    renderedDiagnosticFields,
    type UnrenderedTransformResult,
    unrenderedDiagnosticFields,
} from './engine-diagnostics.js';
import { assertEngineIdentity, EXPECTED_ENGINE, wasmEngineIdentity } from './engine-identity.js';
import { decodeEngineSpans, type LocatedEngineSpans } from './engine-spans.js';
import { CsszyxError } from './errors.js';
import type {
    GlobalVarSourceFile,
    GlobalVarUsageDiagnostic,
    GlobalVarUsageQuery,
} from './global-var-diagnostics.js';
import type { ModuleLinks, ModuleLinksFile, ModuleLinksQuery } from './module-links.js';
import { renderThrown } from './thrown-words.js';
import type { SourceTransformResult, TransformSourceCodeOptions } from './transform-core.js';
import {
    aggregateCssVariableMap,
    encodeCrossModuleStatics,
    internalError,
    normalizeGlobalVarAliases,
    type TransformRustFile,
    thrownMessage,
} from './transform-rust.js';

/** The raw serde shape `transform_batch_json` returns, snake_case per field. */
interface WasmResultJson {
    code: string;
    classes: string[];
    raw_class_names: string[];
    /** The file's spans text: the text the native binding returns as `spans`. */
    spans: string;
    recovery_tokens: Array<{
        token: string;
        mode: 'csr' | 'dev-only';
        component: string;
        path: string;
    }>;
    css_variable_map: Array<{ original: string; mangled: string }>;
    metadata: {
        transformed: boolean;
        uses_runtime: boolean;
        uses_merge: boolean;
        uses_szcn: boolean;
        uses_sz_part: boolean;
        uses_szv_pick: boolean;
        uses_szv_pick1: boolean;
        sz_part_args_provable: boolean;
        uses_color_var: boolean;
        uses_spacing_var: boolean;
        uses_unit_var: boolean;
        uses_bool_class: boolean;
    };
}

/** The exports the lane consumes from `@csszyx/core/parser-wasm`. */
interface ParserWasmModule {
    /** The version of `@csszyx/core` this build ships as. */
    version(): string;
    /** The digest of the source it was built from; absent before 0.18. */
    engine_digest?(): string;
    transform_batch_json(filesJson: string, optionsJson: string): string;
    scan_module_links_json(filesJson: string, queryJson: string): string;
    scan_global_var_usages_json(filesJson: string, queryJson: string): string;
}

/**
 * Thrown when the wasm parser artifact cannot be loaded.
 *
 * A csszyx error: `wasm-engine-unavailable`, with what loading the artifact
 * threw as its `cause`. Given `where` instead, or without a load failure to
 * wrap, as when the artifact answers a file with no result, the state is a
 * csszyx bug: `internal-error`, with `detail` as the check that failed.
 */
export class WasmTransformUnavailableError extends CsszyxError {
    /**
     * @param detail Loader failure detail, or the check that failed.
     * @param options What it wraps.
     * @param options.cause What loading the artifact threw, or what the engine threw.
     * @param options.where Where a csszyx bug was found; the engine's refusal names it.
     */
    constructor(detail: string, options: { cause?: unknown; where?: string } = {}) {
        const { cause, where } = options;
        super(
            cause === undefined || where !== undefined
                ? internalError({ where: where ?? 'transformWasm', detail }, cause)
                : {
                      code: 'wasm-engine-unavailable',
                      args: { detail },
                      message: renderThrown(WASM_ENGINE_UNAVAILABLE, { detail }),
                      cause,
                  },
        );
        this.name = 'WasmTransformUnavailableError';
    }
}

/** Whether the wasm engine's identity has been checked; a pass is final. */
let wasmIdentityChecked = false;
/** Memoized wasm module: loading instantiates the wasm once per process. */
let wasmModule: ParserWasmModule | null | undefined;
let wasmLoadError = '';
/** What loading the wasm module threw, kept as the unavailable error's cause. */
let wasmLoadCause: unknown;

/**
 * Require the wasm module once; remember failure so probes stay cheap.
 *
 * @returns The wasm module, or null when the artifact cannot load.
 */
function loadParserWasm(): ParserWasmModule | null {
    if (wasmModule !== undefined) {
        return wasmModule;
    }
    try {
        const requireFromHere = createRequire(import.meta.url);
        wasmModule = requireFromHere('@csszyx/core/parser-wasm') as ParserWasmModule;
    } catch (err) {
        // Its first line: Node's resolver appends the require stack.
        wasmLoadError = thrownMessage(err).split('\n')[0];
        wasmLoadCause = err;
        wasmModule = null;
    }
    return wasmModule;
}

/**
 * The wasm module, or the error that says why it is missing.
 *
 * @returns The loaded wasm module.
 * @throws {WasmTransformUnavailableError} when the wasm artifact is missing.
 */
function requireParserWasm(): ParserWasmModule {
    const wasm = loadParserWasm();
    if (!wasm) {
        // `loadParserWasm` records why whenever it has no module to return.
        throw new WasmTransformUnavailableError(wasmLoadError, { cause: wasmLoadCause });
    }
    if (!wasmIdentityChecked && EXPECTED_ENGINE !== null) {
        assertEngineIdentity({
            expected: EXPECTED_ENGINE,
            reported: wasmEngineIdentity(wasm),
        });
        wasmIdentityChecked = true;
    }
    return wasm;
}

/**
 * Read module links through the wasm build of the engine.
 *
 * @param files - Modules to read.
 * @param query - Which optional answers to compute.
 * @returns One answer per module, in input order.
 * @throws {WasmTransformUnavailableError} when the wasm artifact is missing.
 */
export function scanModuleLinksWasm(
    files: readonly ModuleLinksFile[],
    query: ModuleLinksQuery = {},
): ModuleLinks[] {
    const filesJson = JSON.stringify(files.map(({ filename, source }) => ({ filename, source })));
    return JSON.parse(
        requireParserWasm().scan_module_links_json(filesJson, JSON.stringify(query)),
    ) as ModuleLinks[];
}

/**
 * Read global custom-property usages through the wasm build of the engine.
 *
 * @param files - Modules to read.
 * @param query - Which custom properties to report.
 * @returns One list per module, in input order.
 * @throws {WasmTransformUnavailableError} when the wasm artifact is missing.
 */
export function scanGlobalVarUsagesWasm(
    files: readonly GlobalVarSourceFile[],
    query: GlobalVarUsageQuery = {},
): GlobalVarUsageDiagnostic[][] {
    const filesJson = JSON.stringify(files.map(({ filename, source }) => ({ filename, source })));
    return JSON.parse(
        requireParserWasm().scan_global_var_usages_json(filesJson, JSON.stringify(query)),
    ) as GlobalVarUsageDiagnostic[][];
}

/**
 * Non-throwing availability probe, memoized like `isRustTransformAvailable`.
 *
 * @returns true when the wasm parser artifact can be loaded.
 */
export function isWasmTransformAvailable(): boolean {
    return loadParserWasm() !== null;
}

/**
 * Transform source through the wasm build of the native engine.
 *
 * @param source Source module contents.
 * @param filename Source filename for diagnostics.
 * @param options Compiler options.
 * @returns Transform result.
 * @throws {WasmTransformUnavailableError} when the wasm artifact is missing.
 */
export function transformWasm(
    source: string,
    filename?: string,
    options?: TransformSourceCodeOptions,
): SourceTransformResult {
    return transformWasmOne(source, filename, options, renderedDiagnosticFields);
}

/**
 * {@link transformWasm} with every diagnostic left for the caller to render:
 * `diagnostics` is empty, and each issue renders with
 * `renderEngineDiagnostic(issue, result.diagnosticFile)`.
 *
 * @internal The build lanes' transform; not a stable API.
 * @param source Source module contents.
 * @param filename Source filename for diagnostics.
 * @param options Compiler options.
 * @returns Transform result.
 * @throws {WasmTransformUnavailableError} when the wasm artifact is missing.
 */
export function transformWasmUnrendered(
    source: string,
    filename?: string,
    options?: TransformSourceCodeOptions,
): UnrenderedTransformResult {
    return transformWasmOne(
        source,
        filename,
        options,
        unrenderedDiagnosticFields,
    ) as UnrenderedTransformResult;
}

/**
 * One file through the wasm engine.
 *
 * @param source Source module contents.
 * @param filename Source filename for diagnostics.
 * @param options Compiler options.
 * @param fields How to fill the diagnostic fields.
 * @returns Transform result.
 */
function transformWasmOne(
    source: string,
    filename: string | undefined,
    options: TransformSourceCodeOptions | undefined,
    fields: EngineDiagnosticFieldsOf,
): SourceTransformResult {
    // Mirrors transformRust: an unnamed single file is `<anonymous>`.
    const [result] = runWasmBatch(
        [{ filename: filename ?? '<anonymous>', source }],
        options,
        fields,
    );
    if (!result) {
        throw new WasmTransformUnavailableError('the wasm engine returned no result');
    }
    return result;
}

/**
 * The options the wasm artifact's `transform_batch_json` reads, in its
 * snake_case spelling.
 *
 * @param options Compiler options.
 * @returns The options object to serialize.
 */
function wasmTransformOptions(options?: TransformSourceCodeOptions): object {
    return {
        mangle_vars: options?.mangleVars === true,
        mangle_var_hoist_max_depth: options?.mangleVarHoistMaxDepth ?? null,
        global_var_aliases: normalizeGlobalVarAliases(options?.globalVarAliases),
        ast_budget: options?.astBudget ?? null,
        cross_module_statics_json: encodeCrossModuleStatics(options?.crossModuleStatics) ?? null,
        cross_module_sz_objects_json:
            encodeCrossModuleStatics(options?.crossModuleSzObjects) ?? null,
        class_prefix: options?.classPrefix ?? null,
        merge_table_json: options?.mergeTable ? JSON.stringify(options.mergeTable) : null,
    };
}

/**
 * Transform a batch of files through the wasm engine in one boundary crossing.
 *
 * @param files Source files to transform.
 * @param options Compiler options, normalized exactly like the napi lane.
 * @returns One transform result per input file, in input order.
 * @throws {WasmTransformUnavailableError} when the wasm artifact is missing.
 */
export function transformWasmBatch(
    files: readonly TransformRustFile[],
    options?: TransformSourceCodeOptions,
): SourceTransformResult[] {
    return runWasmBatch(files, options, renderedDiagnosticFields);
}

/**
 * A batch through the wasm engine in one boundary crossing.
 *
 * @param files Source files to transform.
 * @param options Compiler options, normalized exactly like the napi lane.
 * @param fields How to fill the diagnostic fields.
 * @returns One transform result per input file, in input order.
 */
function runWasmBatch(
    files: readonly TransformRustFile[],
    options: TransformSourceCodeOptions | undefined,
    fields: EngineDiagnosticFieldsOf,
): SourceTransformResult[] {
    const wasm = requireParserWasm();

    const filesJson = JSON.stringify(
        files.map((file, index) => ({
            filename: file.filename ?? `file-${index}.tsx`,
            source: file.source,
        })),
    );
    const optionsJson = JSON.stringify(wasmTransformOptions(options));

    let resultsJson: string;
    try {
        resultsJson = wasm.transform_batch_json(filesJson, optionsJson);
    } catch (err) {
        // The engine refuses a batch only for a csszyx bug: this module wrote
        // both JSON strings, and the artifact was built with the engine.
        throw new WasmTransformUnavailableError(thrownMessage(err), {
            cause: err,
            where: 'runWasmBatch',
        });
    }
    const results = JSON.parse(resultsJson) as WasmResultJson[];
    return results.map((result, index) =>
        fromWasmResult(
            result,
            files[index].source,
            diagnosticPath(files[index].filename ?? `file-${index}.tsx`, options?.rootDir),
            fields,
        ),
    );
}

/**
 * Convert the serde result shape into the compiler result shape.
 *
 * The napi lane gets this conversion from napi-derive (camelCase fields);
 * the wasm boundary is JSON, so the snake_case mapping lives here. The spans
 * are the text both artifacts write, read by the shared decoder.
 *
 * @param result Raw wasm transform result.
 * @param source The source the result was transformed from, to place its spans.
 * @param file The file's path as a diagnostic names it.
 * @param fields How to fill the diagnostic fields.
 * @returns Compiler transform result.
 */
function fromWasmResult(
    result: WasmResultJson,
    source: string,
    file: string,
    fields: EngineDiagnosticFieldsOf,
): SourceTransformResult {
    let spans: LocatedEngineSpans;
    try {
        spans = decodeEngineSpans(source, result.spans);
    } catch (err) {
        // The wasm build writes the text the native binding does: only one
        // from another build, or a csszyx bug, writes text this cannot read.
        throw new WasmTransformUnavailableError(thrownMessage(err), {
            cause: err,
            where: 'decodeEngineSpans',
        });
    }
    return {
        code: result.code,
        transformed: result.metadata.transformed,
        usesSzvPick: result.metadata.uses_szv_pick,
        usesSzvPick1: result.metadata.uses_szv_pick1,
        szPartArgsProvable: result.metadata.sz_part_args_provable,
        usesRuntime: result.metadata.uses_runtime,
        usesMerge: result.metadata.uses_merge,
        usesSzcn: result.metadata.uses_szcn,
        usesSzPart: result.metadata.uses_sz_part,
        usesColorVar: result.metadata.uses_color_var,
        usesSpacingVar: result.metadata.uses_spacing_var,
        usesUnitVar: result.metadata.uses_unit_var,
        usesBoolClass: result.metadata.uses_bool_class,
        classes: new Set(result.classes),
        rawClassNames: new Set(result.raw_class_names),
        mergeGroups: spans.mergeGroups,
        singleClassGroups: spans.singleClassGroups,
        mergeOverrides: spans.mergeOverrides,
        ...fields(spans.issues, file),
        issues: spans.issues,
        recoveryTokens: new Map(
            result.recovery_tokens.map(({ token, ...data }) => [
                token,
                { mode: data.mode, component: data.component, path: data.path },
            ]),
        ),
        cssVariableMap: aggregateCssVariableMap(result.css_variable_map ?? []),
    };
}
