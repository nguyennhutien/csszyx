/**
 * Pure parser-mode resolution — extracted so the graceful-degradation matrix is
 * unit-testable without spinning up a real build or depending on whether a native
 * binary happens to be installed on the test host.
 *
 * Precedence (highest first): a valid `CSSZYX_PARSER` env value, then
 * `build.parser` config, then the default. A `rust` choice that is EXPLICIT (env
 * or config) keeps its loud-failure contract; a `rust` that is merely the default
 * degrades to the engine's own wasm build when no native binary is available —
 * same engine, same output. When even the wasm artifact cannot load, the build
 * fails loudly on the native error, which names the missing platform package.
 */

/**
 * The parser lanes csszyx can run: one engine, two artifacts. `rust` is the
 * native addon; `wasm` is the same engine compiled to wasm32 and shipped
 * inside @csszyx/core. The TypeScript lanes (`oxc`, `babel`) were removed
 * once the engine became the canonical answer — pinning `wasm` remains
 * useful for environments that cannot load native addons at all
 * (WebContainers-class) and for triage.
 */
export type ParserMode = 'rust' | 'wasm';

/**
 * Whether a raw value is one of the accepted parser identifiers.
 *
 * @param value - the value to test (e.g. a `CSSZYX_PARSER` env string).
 * @returns true when `value` is exactly `'rust'` or `'wasm'`.
 */
export function isParserMode(value: unknown): value is ParserMode {
    return value === 'rust' || value === 'wasm';
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
    /** True when a default `rust` was degraded to `wasm` for lack of a
     * native binary. */
    degraded: boolean;
    /** True when the parser was opted into explicitly (env or config). */
    explicit: boolean;
}

/**
 * Resolve the effective parser, applying default-`rust` → `wasm` graceful
 * degradation. See {@link ResolveParserModeInput} for the precedence rules.
 *
 * @param input - env/config/default parser values plus the native probe.
 * @returns the resolved parser plus `degraded`/`explicit` flags.
 */
export function resolveParserMode(input: ResolveParserModeInput): ResolveParserModeResult {
    const { configParser, envParser, defaultParser, isRustAvailable } = input;

    const envValid = isParserMode(envParser);
    // A config value outside the accepted set (e.g. `parser: 'oxc'` written
    // before the TypeScript lanes were removed, reaching here from untyped
    // JavaScript) is ignored like an invalid env var: the build runs on the
    // default and the active-parser banner says which lane actually ran.
    const configValid = isParserMode(configParser);
    const explicit = envValid || configValid;
    const parser: ParserMode = envValid ? envParser : configValid ? configParser : defaultParser;

    if (parser === 'rust' && !explicit && !isRustAvailable()) {
        // The wasm build of the same engine is the only degrade target. When
        // it cannot load either, stay on rust so the failure downstream names
        // the missing platform package — with no JavaScript parser left there
        // is nothing quieter to switch to, and pretending otherwise would
        // just trade a good error for a worse one.
        if (input.isWasmAvailable()) {
            return { parser: 'wasm', degraded: true, explicit: false };
        }
        return { parser: 'rust', degraded: false, explicit: false };
    }

    return { parser, degraded: false, explicit };
}
