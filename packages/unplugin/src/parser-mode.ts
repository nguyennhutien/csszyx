/**
 * Pure parser-mode resolution — extracted so the graceful-degradation matrix is
 * unit-testable without spinning up a real build or depending on whether a native
 * binary happens to be installed on the test host.
 *
 * Precedence (highest first): a valid `CSSZYX_PARSER` env value, then
 * `build.parser` config, then the default. A `rust` choice that is EXPLICIT (env
 * or config) keeps its loud-failure contract; a `rust` that is merely the default
 * degrades to the engine's own wasm build when no native binary is available —
 * same engine, same output — and only to `oxc` when that artifact is missing
 * too, rather than hard-failing a build the user never opted into `rust` for.
 */

/**
 * The parser lanes csszyx can run. `rust` and `wasm` are the same engine —
 * one native, one compiled to wasm32; `oxc` and `babel` are the TypeScript
 * implementations.
 */
export type ParserMode = 'rust' | 'wasm' | 'oxc' | 'babel';

/**
 * Whether a raw value is one of the accepted parser identifiers.
 *
 * @param value - the value to test (e.g. a `CSSZYX_PARSER` env string).
 * @returns true when `value` is exactly `'rust'`, `'wasm'`, `'oxc'`, or `'babel'`.
 */
export function isParserMode(value: unknown): value is ParserMode {
    return value === 'rust' || value === 'wasm' || value === 'oxc' || value === 'babel';
}

/** Inputs to {@link resolveParserMode}. */
export interface ResolveParserModeInput {
    /** `options.build?.parser` — explicit when not null/undefined. */
    configParser: ParserMode | undefined;
    /** `process.env.CSSZYX_PARSER` — explicit only when it is a valid mode. */
    envParser: string | undefined;
    /** The configured default (today `rust`). */
    defaultParser: ParserMode;
    /**
     * Lazy native-availability probe. Called AT MOST once, and only when the
     * resolved parser is the non-explicit default `rust` — so an explicit `rust`
     * never probes (it must fail loudly downstream) and `oxc`/`babel` never pay
     * for a probe they don't need.
     */
    isRustAvailable: () => boolean;
    /**
     * Lazy wasm-availability probe, consulted only after the native probe said
     * no: the wasm build is the preferred degrade target because it is the
     * SAME engine, so degrading to it costs parse speed and nothing else.
     */
    isWasmAvailable: () => boolean;
}

/** Result of {@link resolveParserMode}. */
export interface ResolveParserModeResult {
    /** The parser the build should use. */
    parser: ParserMode;
    /** True when a default `rust` was degraded (to `wasm`, or `oxc` as the
     * last resort) for lack of a native binary. */
    degraded: boolean;
    /** True when the parser was opted into explicitly (env or config). */
    explicit: boolean;
}

/**
 * Resolve the effective parser, applying default-`rust` → `wasm` (→ `oxc`)
 * graceful degradation. See {@link ResolveParserModeInput} for the precedence
 * rules.
 *
 * @param input - env/config/default parser values plus the native probe.
 * @returns the resolved parser plus `degraded`/`explicit` flags.
 */
export function resolveParserMode(input: ResolveParserModeInput): ResolveParserModeResult {
    const { configParser, envParser, defaultParser, isRustAvailable } = input;

    const envValid = isParserMode(envParser);
    const explicit = envValid || configParser != null;
    const parser: ParserMode = envValid ? envParser : (configParser ?? defaultParser);

    if (parser === 'rust' && !explicit && !isRustAvailable()) {
        // Prefer the wasm build of the same engine; oxc remains the last
        // resort for a core built without the parser wasm artifact.
        const target: ParserMode = input.isWasmAvailable() ? 'wasm' : 'oxc';
        return { parser: target, degraded: true, explicit: false };
    }

    return { parser, degraded: false, explicit };
}
