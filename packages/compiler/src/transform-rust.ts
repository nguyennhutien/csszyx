import * as nativeModule from '@csszyx/core/native';
import {
    CsszyxNativeUnavailableError,
    computeMangleChecksum,
    encodeClassName,
    getNativePackageName,
    type NativeTransformResult,
    scanGlobalVarUsages,
    scanModuleLinks,
    transformBatch,
} from '@csszyx/core/native';
// Imported directly, not through `./report.js`: Node loads this module, and
// the build makes `./report.js` the whole `@csszyx/compiler/report` subpath,
// where only these entries are needed.
import { INTERNAL_ERROR } from './diagnostic-browser.generated.js';
import { engineCallOptions } from './engine-call-options.js';
import {
    diagnosticPath,
    type EngineDiagnosticFieldsOf,
    renderedDiagnosticFields,
    type UnrenderedTransformResult,
    unrenderedDiagnosticFields,
} from './engine-diagnostics.js';
import { assertEngineIdentity, type EngineIdentity, EXPECTED_ENGINE } from './engine-identity.js';
import { decodeEngineSpans, type LocatedEngineSpans } from './engine-spans.js';
import {
    CsszyxError,
    type CsszyxErrorFields,
    type CsszyxErrorOptions,
    isCsszyxError,
} from './errors.js';
import type {
    GlobalVarSourceFile,
    GlobalVarUsageDiagnostic,
    GlobalVarUsageQuery,
} from './global-var-diagnostics.js';
import type { ModuleLinks, ModuleLinksFile, ModuleLinksQuery } from './module-links.js';
import { renderThrown } from './thrown-words.js';
import type {
    CssVariableMangleValue,
    GlobalVarAliasTableInput,
    SourceTransformResult,
    TransformSourceCodeOptions,
    TransformSourceOptions,
} from './transform-core.js';

/**
 * Source file passed to the Rust native batch transform.
 */
export interface TransformRustFile {
    /** Source filename for diagnostics and recovery-token stability. */
    filename?: string;
    /** Source module contents. */
    source: string;
}

/**
 * The message of anything thrown: an error's own, or the text of a thrown
 * value that is not one, as wasm-bindgen throws a Rust error's string.
 *
 * @internal Shared with the wasm lane; not a stable API.
 * @param thrown - Anything caught.
 * @returns Its message.
 */
export function thrownMessage(thrown: unknown): string {
    return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * Thrown when the native engine cannot run on the current host. The wasm
 * artifact's counterpart is `WasmTransformUnavailableError`.
 *
 * A csszyx error. Wrapping the loader's error, it keeps that error as its
 * `cause` and takes its `code`, `args` and message
 * (`native-engine-unavailable`): the wrapper renames the failure for this
 * lane, it does not reclassify it. Without a csszyx error to wrap, as when
 * the binding answers a file with no result or the engine refuses the batch,
 * the state is a csszyx bug: `internal-error`, with `detail` as the check
 * that failed.
 */
export class RustTransformUnavailableError extends CsszyxError {
    /**
     * @param detail The check that failed; unused when `cause` is a csszyx error.
     * @param options What it wraps.
     * @param options.cause The loader's error, or what the engine threw.
     * @param options.where Where a csszyx bug was found; `transformRust` by default.
     */
    constructor(detail: string, options: { cause?: unknown; where?: string } = {}) {
        const { cause, where = 'transformRust' } = options;
        super(isCsszyxError(cause) ? wrapping(cause) : internalError({ where, detail }, cause));
        this.name = 'RustTransformUnavailableError';
    }
}

/**
 * A csszyx error renamed for another lane: its code, args and words, with it
 * as the cause.
 *
 * @param cause - The error to wrap.
 * @returns What to construct the wrapper from.
 */
function wrapping(cause: Error & CsszyxErrorFields): CsszyxErrorOptions {
    return { code: cause.code, args: cause.args, message: cause.message, cause };
}

/**
 * An `internal-error` in the registry's words: a state only a csszyx bug
 * reaches.
 *
 * @internal Shared with the wasm lane; not a stable API.
 * @param args - Where it was found and the check that failed.
 * @param args.where - Where it was found.
 * @param args.detail - The check that failed.
 * @param cause - What was thrown, when something was.
 * @returns What to construct the error from.
 */
export function internalError(
    args: { where: string; detail: string },
    cause?: unknown,
): CsszyxErrorOptions {
    return {
        code: 'internal-error',
        args,
        message: renderThrown(INTERNAL_ERROR, args),
        cause,
    };
}

/**
 * Transform source through the Rust native engine.
 *
 * @param source Source module contents.
 * @param options Its filename for diagnostics, and the compiler options.
 * @param rest nothing; a third argument is refused.
 * @returns Transform result.
 * @throws {CsszyxError} `options-object-required`, for the positional shape.
 * @throws {RustTransformUnavailableError} when the native addon is unavailable.
 */
export function transformRust(
    source: string,
    options: TransformSourceOptions = {},
    ...rest: never[]
): SourceTransformResult {
    return transformRustOne(
        source,
        engineCallOptions('transformRust', options, rest),
        renderedDiagnosticFields,
    );
}

/**
 * {@link transformRust} with every diagnostic left for the caller to render:
 * `diagnostics` is empty, and each issue renders with
 * `renderEngineDiagnostic(issue, result.diagnosticFile)`.
 *
 * @internal The build lanes' transform; not a stable API.
 * @param source Source module contents.
 * @param options Its filename for diagnostics, and the compiler options.
 * @param rest nothing; a third argument is refused.
 * @returns Transform result.
 * @throws {CsszyxError} `options-object-required`, for the positional shape.
 * @throws {RustTransformUnavailableError} when the native addon is unavailable.
 */
export function transformRustUnrendered(
    source: string,
    options: TransformSourceOptions = {},
    ...rest: never[]
): UnrenderedTransformResult {
    return transformRustOne(
        source,
        engineCallOptions('transformRustUnrendered', options, rest),
        unrenderedDiagnosticFields,
    ) as UnrenderedTransformResult;
}

/**
 * One file through the native engine.
 *
 * @param source Source module contents.
 * @param fileOptions Its filename for diagnostics, and the compiler options.
 * @param fields How to fill the diagnostic fields.
 * @returns Transform result.
 */
function transformRustOne(
    source: string,
    fileOptions: TransformSourceOptions,
    fields: EngineDiagnosticFieldsOf,
): SourceTransformResult {
    const { filename, ...options } = fileOptions;
    // The single-file path names an unnamed module `<anonymous>` — the same
    // answer the shared JS channel always gave — while the BATCH default stays
    // index-based so recovery tokens keep unique per-file inputs.
    const [result] = runNativeBatch(
        [{ filename: filename ?? '<anonymous>', source }],
        options,
        fields,
    );
    if (!result) {
        throw new RustTransformUnavailableError('the native transform returned no result');
    }
    return result;
}

/** Whether the native engine's identity has been checked; a pass is final. */
let nativeIdentityChecked = false;

/**
 * Check, once per process, that the native engine is the one this compiler was
 * built against. Every call into the native engine passes through here first.
 *
 * @internal Shared with the migrate wrapper; not a stable API.
 *
 * @throws {CsszyxNativeUnavailableError} when the native addon cannot load.
 * @throws {EngineVersionSkewError} when it is another engine.
 */
export function checkNativeEngine(): void {
    // Run from source, the compiler has no build to compare against.
    if (nativeIdentityChecked || EXPECTED_ENGINE === null) return;
    // Read through the namespace: `@csszyx/core` from before 0.18 has no
    // `engineIdentity`, and a named import of it would fail when this module
    // links, with a bare SyntaxError instead of the skew this check reports.
    const { engineIdentity } = nativeModule as {
        engineIdentity?: () => EngineIdentity | null;
    };
    const platformPackage = getNativePackageName();
    assertEngineIdentity({
        expected: EXPECTED_ENGINE,
        reported: typeof engineIdentity === 'function' ? engineIdentity() : null,
        platformPackage,
    });
    nativeIdentityChecked = true;
}

/** Memoized result of the native-availability probe (loading the addon is a
 * one-time cost; the binary cannot appear or vanish mid-process). */
let rustAvailability: boolean | undefined;

/**
 * Verify that the native Rust transform binding can be loaded.
 *
 * This is intentionally separate from `transformRust()` so build integrations
 * can validate the explicit `rust` parser contract before serving cached
 * output. If the native addon is missing, `rust` must fail loudly instead of
 * returning a stale cache entry.
 *
 * The probe hands the binding one empty module rather than an empty batch: a
 * platform package older than `@csszyx/core` loads and answers an empty batch
 * like a current one, and only a result shows it cannot be read. A good answer
 * is remembered for the process, since a loaded binding cannot turn stale; a
 * failure is not, so every call reports it with its own detail.
 *
 * @throws {RustTransformUnavailableError} when the native addon is unavailable.
 */
export function ensureRustTransformAvailable(): void {
    if (rustAvailability === true) return;
    try {
        checkNativeEngine();
        transformBatch([{ filename: 'csszyx-probe.tsx', source: '' }]);
        rustAvailability = true;
    } catch (err) {
        throw asRustUnavailable(err);
    }
}

/**
 * Non-throwing companion to {@link ensureRustTransformAvailable}: returns whether
 * the native Rust addon can be loaded on the current host. Build integrations use
 * it to degrade the DEFAULT `rust` parser to the wasm artifact when no prebuilt
 * binary is installed for the platform (unsupported arch, optional deps omitted,
 * or a cross-platform frozen lockfile) — instead of hard-failing a build the user
 * never explicitly opted into `rust` for. An EXPLICIT `rust` choice must still use
 * {@link ensureRustTransformAvailable} so it fails loudly.
 *
 * @returns true when the native transform is usable, false otherwise.
 */
export function isRustTransformAvailable(): boolean {
    if (rustAvailability === undefined) {
        try {
            // Remembers a good answer itself.
            ensureRustTransformAvailable();
        } catch (error) {
            // Only a missing addon is "unavailable". An engine from another
            // release is an error to report, not a reason to fall back.
            if (!(error instanceof RustTransformUnavailableError)) throw error;
            rustAvailability = false;
        }
    }
    return rustAvailability === true;
}

/**
 * The options the native binding's `transformBatch` reads.
 *
 * @param options Compiler options.
 * @returns The binding's options.
 */
function nativeTransformOptions(
    options?: TransformSourceCodeOptions,
): Parameters<typeof transformBatch>[1] {
    return {
        mangleVars: options?.mangleVars === true,
        mangleVarHoistMaxDepth: options?.mangleVarHoistMaxDepth,
        globalVarAliases: normalizeGlobalVarAliases(options?.globalVarAliases),
        // The node cap is counted by the engine's parser, so the user's
        // raised `build.astBudgetLimit` has to reach it.
        astBudget: options?.astBudget,
        crossModuleStaticsJson: encodeCrossModuleStatics(options?.crossModuleStatics),
        // Its own field, not folded into the szv payload: the two
        // registries share a transport but not a meaning, and the
        // native side picks different machinery for each.
        crossModuleSzObjectsJson: encodeCrossModuleStatics(options?.crossModuleSzObjects),
        classPrefix: options?.classPrefix ?? undefined,
        mergeTableJson: options?.mergeTable ? JSON.stringify(options.mergeTable) : undefined,
    };
}

/**
 * Transform a batch of files through the Rust native engine in one napi call.
 *
 * This is the compiler-level wrapper around `@csszyx/core/native`'s batch API.
 * It keeps JS callers on the normal `SourceTransformResult` contract while
 * preserving the Rust core's FFI amortization for benchmarks and future build
 * integrations.
 *
 * @param files Source files to transform.
 * @param options Compiler options reserved for future native config plumbing.
 * @returns One transform result per input file, in input order.
 * @throws {RustTransformUnavailableError} when the native addon is unavailable.
 */
export function transformRustBatch(
    files: readonly TransformRustFile[],
    options?: TransformSourceCodeOptions,
): SourceTransformResult[] {
    return runNativeBatch(files, options, renderedDiagnosticFields);
}

/**
 * {@link transformRustBatch} with every diagnostic left for the caller to
 * render; see {@link transformRustUnrendered}.
 *
 * @internal The build lanes' transform; not a stable API.
 * @param files Source files to transform.
 * @param options Compiler options.
 * @returns One transform result per input file, in input order.
 * @throws {RustTransformUnavailableError} when the native addon is unavailable.
 */
export function transformRustBatchUnrendered(
    files: readonly TransformRustFile[],
    options?: TransformSourceCodeOptions,
): UnrenderedTransformResult[] {
    return runNativeBatch(
        files,
        options,
        unrenderedDiagnosticFields,
    ) as UnrenderedTransformResult[];
}

/**
 * A batch through the native engine, in one napi call.
 *
 * @param files Source files to transform.
 * @param options Compiler options.
 * @param fields How to fill the diagnostic fields.
 * @returns One transform result per input file, in input order.
 */
function runNativeBatch(
    files: readonly TransformRustFile[],
    options: TransformSourceCodeOptions | undefined,
    fields: EngineDiagnosticFieldsOf,
): SourceTransformResult[] {
    let results: NativeTransformResult[];
    try {
        checkNativeEngine();
        results = transformBatch(
            files.map((file, index) => ({
                filename: file.filename ?? `file-${index}.tsx`,
                source: file.source,
            })),
            nativeTransformOptions(options),
        );
    } catch (err) {
        // The loader and the identity check throw csszyx errors; anything else
        // is the engine refusing the batch, which only a csszyx bug causes.
        throw isCsszyxError(err)
            ? asRustUnavailable(err)
            : new RustTransformUnavailableError(thrownMessage(err), {
                  cause: err,
                  where: 'runNativeBatch',
              });
    }
    return results.map((result, index) =>
        fromNativeResult(
            result,
            files[index].source,
            diagnosticPath(files[index].filename ?? `file-${index}.tsx`, options?.rootDir),
            fields,
        ),
    );
}

/**
 * Read module links through the native addon.
 *
 * The registry entries cross as one JSON string per module, encoded by the same
 * serializer the wasm build uses, and are decoded only when they were asked
 * for.
 *
 * @param files - Modules to read.
 * @param query - Which optional answers to compute.
 * @returns One answer per module, in input order.
 * @throws {RustTransformUnavailableError} when the native addon is unavailable.
 */
export function scanModuleLinksRust(
    files: readonly ModuleLinksFile[],
    query: ModuleLinksQuery = {},
): ModuleLinks[] {
    let links: ReturnType<typeof scanModuleLinks>;
    try {
        checkNativeEngine();
        links = scanModuleLinks(
            files.map(({ filename, source }) => ({ filename, source })),
            query,
        );
    } catch (err) {
        throw asRustUnavailable(err);
    }
    return links.map(({ registryEntriesJson, ...rest }) => ({
        ...rest,
        registryEntries: query.registryEntries === true ? JSON.parse(registryEntriesJson) : [],
    }));
}

/**
 * Read global custom-property usages through the native addon.
 *
 * @param files - Modules to read.
 * @param query - Which custom properties to report.
 * @returns One list per module, in input order.
 * @throws {RustTransformUnavailableError} when the native addon is unavailable.
 */
export function scanGlobalVarUsagesRust(
    files: readonly GlobalVarSourceFile[],
    query: GlobalVarUsageQuery = {},
): GlobalVarUsageDiagnostic[][] {
    try {
        // The engine names each kind from the closed set the type lists.
        checkNativeEngine();
        return scanGlobalVarUsages(
            files.map(({ filename, source }) => ({ filename, source })),
            query,
        ) as GlobalVarUsageDiagnostic[][];
    } catch (err) {
        throw asRustUnavailable(err);
    }
}

/**
 * Name a native loader failure the way every rust-lane caller reports it.
 *
 * @param err - What the native call threw.
 * @returns The error to throw: loader failures renamed, anything else as is.
 */
function asRustUnavailable(err: unknown): unknown {
    return err instanceof CsszyxNativeUnavailableError
        ? new RustTransformUnavailableError(err.message, { cause: err })
        : err;
}

/**
 * Normalize compiler alias-table options for the native NAPI object shape.
 *
 * Shared with the wasm lane (`transform-wasm.ts`) — same engine, same option
 * normalization; a second copy is exactly the drift the parity gates exist to
 * catch.
 *
 * @param input Alias table input.
 * @returns Native alias entries.
 */
export function normalizeGlobalVarAliases(
    input: GlobalVarAliasTableInput | undefined,
): Array<{ original: string; alias: string }> {
    if (!input) {
        return [];
    }
    let entries: Iterable<[string, string]>;
    if (input instanceof Map) entries = input.entries();
    else if (Array.isArray(input)) entries = input;
    else entries = Object.entries(input);
    return [...entries]
        .filter(([original, alias]) => original.startsWith('--') && alias.startsWith('--'))
        .map(([original, alias]) => ({ original, alias }));
}

/**
 * Convert the native package result shape into the compiler result shape.
 *
 * @param result Native transform result.
 * @param source The source the result was transformed from, to place its spans.
 * @param file The file's path as a diagnostic names it.
 * @param fields How to fill the diagnostic fields.
 * @returns Compiler transform result.
 */
function fromNativeResult(
    result: NativeTransformResult,
    source: string,
    file: string,
    fields: EngineDiagnosticFieldsOf,
): SourceTransformResult {
    let spans: LocatedEngineSpans;
    try {
        spans = decodeEngineSpans(source, result.spans);
    } catch (err) {
        // Only a binding from another build, or a csszyx bug, writes spans
        // this compiler cannot read.
        throw new RustTransformUnavailableError(thrownMessage(err), {
            cause: err,
            where: 'decodeEngineSpans',
        });
    }
    return {
        code: result.code,
        transformed: result.metadata.transformed,
        usesSzvPick: (result.metadata as { usesSzvPick?: boolean }).usesSzvPick ?? false,
        usesSzvPick1: (result.metadata as { usesSzvPick1?: boolean }).usesSzvPick1 ?? false,
        szPartArgsProvable:
            (result.metadata as { szPartArgsProvable?: boolean }).szPartArgsProvable ?? false,
        usesRuntime: result.metadata.usesRuntime,
        usesMerge: result.metadata.usesMerge,
        usesSzcn: result.metadata.usesSzcn,
        usesSzPart: result.metadata.usesSzPart,
        usesColorVar: result.metadata.usesColorVar,
        usesSpacingVar: result.metadata.usesSpacingVar ?? false,
        usesUnitVar: result.metadata.usesUnitVar ?? false,
        usesBoolClass: result.metadata.usesBoolClass ?? false,
        classes: new Set(result.classes),
        rawClassNames: new Set(result.rawClassNames),
        mergeGroups: spans.mergeGroups,
        singleClassGroups: spans.singleClassGroups,
        mergeOverrides: spans.mergeOverrides,
        ...fields(spans.issues, file),
        issues: spans.issues,
        recoveryTokens: new Map(
            result.recoveryTokens.map(({ token, ...data }) => [
                token,
                {
                    mode: data.mode,
                    component: data.component,
                    path: data.path,
                },
            ]),
        ),
        cssVariableMap: aggregateCssVariableMap(result.cssVariableMap ?? []),
    };
}

/**
 * Converts native CSS variable map entries into compiler metadata.
 *
 * @param entries Native original/mangled pairs.
 * @returns Compiler metadata map with one-to-many fanout preserved.
 */
export function aggregateCssVariableMap(
    entries: Array<{ original: string; mangled: string }>,
): Map<string, CssVariableMangleValue> {
    const map = new Map<string, CssVariableMangleValue>();
    for (const entry of entries) {
        const existing = map.get(entry.original);
        if (!existing) {
            map.set(entry.original, entry.mangled);
            continue;
        }
        const values = Array.isArray(existing) ? existing : [existing];
        if (!values.includes(entry.mangled)) {
            map.set(entry.original, [...values, entry.mangled]);
        }
    }
    return map;
}

/** One value in the ordered transport: scalar or nested ordered pairs. */
type OrderedTransportValue = string | number | boolean | Array<[string, OrderedTransportValue]>;

/**
 * Serialize the cross-module registry as ordered `[key, value]` pairs.
 *
 * Arrays survive every JSON library with order intact, where a map would be
 * re-sorted — and table/dimension order fixes emitted class order, so the
 * native engine must see EXACTLY the iteration order the JS lanes consumed.
 * `Object.entries` supplies that order (integer-like keys first, ascending).
 *
 * @param statics - The per-file registry entries, or undefined.
 * @returns JSON payload, or undefined when there is nothing to pass.
 */
export function encodeCrossModuleStatics(
    statics: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
): string | undefined {
    if (statics === undefined || Object.keys(statics).length === 0) {
        return undefined;
    }
    const payload = Object.entries(statics).map(([specifier, entries]) => [
        specifier,
        Object.entries(entries).map(([name, config]) => [name, encodeOrderedValue(config)]),
    ]);
    return JSON.stringify(payload);
}

/**
 * Encode one config value as ordered pairs.
 *
 * @param value - Plain config value.
 * @returns The ordered transport form; non-object scalars pass through, and
 * anything outside the literal contract (null, arrays) passes as-is so the
 * native decoder rejects that entry rather than this side guessing.
 */
function encodeOrderedValue(value: unknown): unknown {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
            key,
            encodeOrderedValue(entry),
        ]);
    }
    return value as OrderedTransportValue;
}

/**
 * The mangled class name for one index, on the native engine.
 *
 * @internal Used by `@csszyx/unplugin`; not a stable API.
 * @param index - The class's position in the mangle order.
 * @returns Its name.
 * @throws {RustTransformUnavailableError} when the native engine cannot run.
 */
export function encodeClassNameRust(index: number): string {
    try {
        checkNativeEngine();
        return encodeClassName(index);
    } catch (error) {
        throw asRustUnavailable(error);
    }
}

/**
 * The mangle map's checksum, on the native engine.
 *
 * The map crosses as its own entries, two lists, because reading an object's
 * keys natively also walks its prototype, where the browser reads own keys.
 *
 * @internal Used by `@csszyx/unplugin`; not a stable API.
 * @param map - Original class name → mangled name.
 * @returns The checksum the browser recomputes.
 * @throws {RustTransformUnavailableError} when the native engine cannot run.
 */
export function computeMangleChecksumRust(map: Readonly<Record<string, string>>): string {
    const entries = Object.entries(map);
    try {
        checkNativeEngine();
        return computeMangleChecksum(
            entries.map(([original]) => original),
            entries.map(([, mangled]) => mangled),
        );
    } catch (error) {
        throw asRustUnavailable(error);
    }
}
