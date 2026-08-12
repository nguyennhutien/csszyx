/**
 * Pure parser-mode resolution — extracted so the graceful-degradation matrix is
 * unit-testable without spinning up a real build or depending on whether a native
 * binary happens to be installed on the test host.
 *
 * Precedence (highest first): a valid `CSSZYX_PARSER` env value, then
 * `build.parser` config, then the default. A `rust` choice that is EXPLICIT (env
 * or config) keeps its loud-failure contract; a `rust` that is merely the default
 * degrades to `oxc` — which matches on every shape the parity corpus covers —
 * when no native binary is available,
 * rather than hard-failing a build the user never opted into `rust` for.
 */

/** The three transform engines csszyx can parse with. */
export type ParserMode = 'rust' | 'oxc' | 'babel';

/**
 * Whether a raw value is one of the three accepted parser identifiers.
 *
 * @param value - the value to test (e.g. a `CSSZYX_PARSER` env string).
 * @returns true when `value` is exactly `'rust'`, `'oxc'`, or `'babel'`.
 */
export function isParserMode(value: unknown): value is ParserMode {
    return value === 'rust' || value === 'oxc' || value === 'babel';
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
}

/** Result of {@link resolveParserMode}. */
export interface ResolveParserModeResult {
    /** The parser the build should use. */
    parser: ParserMode;
    /** True when a default `rust` was degraded to `oxc` for lack of a binary. */
    degraded: boolean;
    /** True when the parser was opted into explicitly (env or config). */
    explicit: boolean;
}

/**
 * Resolve the effective parser, applying default-`rust` → `oxc` graceful
 * degradation. See {@link ResolveParserModeInput} for the precedence rules.
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
        return { parser: 'oxc', degraded: true, explicit: false };
    }

    return { parser, degraded: false, explicit };
}
