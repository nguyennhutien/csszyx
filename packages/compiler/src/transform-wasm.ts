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
import type { SourceTransformResult, TransformSourceCodeOptions } from './transform-core.js';
import {
    aggregateCssVariableMap,
    encodeCrossModuleStatics,
    normalizeGlobalVarAliases,
    type TransformRustFile,
} from './transform-rust.js';

/** The raw serde shape `transform_batch_json` returns, snake_case per field. */
interface WasmResultJson {
    code: string;
    classes: string[];
    raw_class_names: string[];
    diagnostics: string[];
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
    };
}

/** The two exports the lane consumes from `@csszyx/core/parser-wasm`. */
interface ParserWasmModule {
    transform_batch_json(filesJson: string, optionsJson: string): string;
}

/**
 * Thrown when the wasm parser artifact cannot be loaded.
 */
export class WasmTransformUnavailableError extends Error {
    /**
     * @param detail Loader failure detail.
     */
    constructor(detail: string) {
        super(`transformWasm: wasm engine unavailable - ${detail}`);
        this.name = 'WasmTransformUnavailableError';
    }
}

/** Memoized wasm module: loading instantiates the wasm once per process. */
let wasmModule: ParserWasmModule | null | undefined;
let wasmLoadError = '';

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
        wasmLoadError = err instanceof Error ? err.message : String(err);
        wasmModule = null;
    }
    return wasmModule;
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
    // Mirrors transformRust: an unnamed single file is `<anonymous>`.
    const [result] = transformWasmBatch([{ filename: filename ?? '<anonymous>', source }], options);
    if (!result) {
        throw new WasmTransformUnavailableError('wasm transform returned no result');
    }
    return result;
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
    const wasm = loadParserWasm();
    if (!wasm) {
        throw new WasmTransformUnavailableError(wasmLoadError || 'artifact not found');
    }

    const filesJson = JSON.stringify(
        files.map((file, index) => ({
            filename: file.filename ?? `file-${index}.tsx`,
            source: file.source,
        })),
    );
    const optionsJson = JSON.stringify({
        mangle_vars: options?.mangleVars === true,
        mangle_var_hoist_max_depth: options?.mangleVarHoistMaxDepth ?? null,
        global_var_aliases: normalizeGlobalVarAliases(options?.globalVarAliases),
        root_dir: options?.rootDir ?? null,
        ast_budget: options?.astBudget ?? null,
        cross_module_statics_json: encodeCrossModuleStatics(options?.crossModuleStatics) ?? null,
        cross_module_sz_objects_json:
            encodeCrossModuleStatics(options?.crossModuleSzObjects) ?? null,
    });

    const results = JSON.parse(
        wasm.transform_batch_json(filesJson, optionsJson),
    ) as WasmResultJson[];
    return results.map(fromWasmResult);
}

/**
 * Convert the serde result shape into the compiler result shape.
 *
 * The napi lane gets this conversion from napi-derive (camelCase fields);
 * the wasm boundary is JSON, so the snake_case mapping lives here.
 *
 * @param result Raw wasm transform result.
 * @returns Compiler transform result.
 */
function fromWasmResult(result: WasmResultJson): SourceTransformResult {
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
        classes: new Set(result.classes),
        rawClassNames: new Set(result.raw_class_names),
        diagnostics: result.diagnostics,
        recoveryTokens: new Map(
            result.recovery_tokens.map(({ token, ...data }) => [
                token,
                { mode: data.mode, component: data.component, path: data.path },
            ]),
        ),
        cssVariableMap: aggregateCssVariableMap(result.css_variable_map ?? []),
    };
}
