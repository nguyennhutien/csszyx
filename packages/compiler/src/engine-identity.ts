/**
 * Refuse an engine this compiler was not built against.
 *
 * `@csszyx/compiler` and the engine in `@csszyx/core` are released together
 * but installed apart, so a lockfile, a cache or a stale local build can pair
 * them across releases. An engine that does not know an option the compiler
 * sends ignores it: the engine of 0.17.2 lowered every class without the
 * project's Tailwind prefix and said nothing. The compiler therefore carries
 * the version and the source digest of the engine it was built against, and
 * the first call into either artifact checks them. There is no way to switch
 * the check off: a mismatch has no correct output to fall back to.
 *
 * @module engine-identity
 */

/** Replaced at build time by tsdown's `define`; absent when run from source. */
declare const __CSSZYX_ENGINE_VERSION__: string | undefined;
/** Replaced at build time by tsdown's `define`; absent when run from source. */
declare const __CSSZYX_ENGINE_DIGEST__: string | undefined;

/** What an engine artifact reports about itself. */
export interface EngineIdentity {
    /** The version of `@csszyx/core` it ships as. */
    version: string;
    /** The digest of the source it was built from. */
    digest: string;
}

/**
 * The engine this compiler was built against; null when it runs from its
 * source, as the repository's own tests do, where no build put one in.
 */
export const EXPECTED_ENGINE: EngineIdentity | null =
    typeof __CSSZYX_ENGINE_VERSION__ === 'string' && typeof __CSSZYX_ENGINE_DIGEST__ === 'string'
        ? { version: __CSSZYX_ENGINE_VERSION__, digest: __CSSZYX_ENGINE_DIGEST__ }
        : null;

/** Thrown when the engine that loaded is not the one this compiler was built against. */
export class EngineVersionSkewError extends Error {
    /** The diagnostic code, as `[csszyx] <code>:` starts the message. */
    readonly code = 'engine-version-skew';

    /** @param message - The full message. */
    constructor(message: string) {
        super(message);
        this.name = 'EngineVersionSkewError';
    }
}

/** Input to {@link assertEngineIdentity}. */
export interface AssertEngineIdentityInput {
    /** The engine this compiler was built against; null skips the check. */
    expected: EngineIdentity | null;
    /** What the engine reported; null for one older than the report itself. */
    reported: EngineIdentity | null;
    /** Which artifact answered, for the message: `native (@csszyx/core-…)` or `wasm`. */
    artifact: string;
    /**
     * For the native artifact, the platform package that answered (null when
     * none covers the host); absent for wasm. It picks the fix the message
     * gives.
     */
    platformPackage?: string | null;
}

/**
 * Throw when the engine that answered is not the one expected.
 *
 * @param input - Both identities and the artifact.
 * @throws {EngineVersionSkewError} naming both and what to install.
 */
export function assertEngineIdentity(input: AssertEngineIdentityInput): void {
    const { expected, reported, artifact } = input;
    if (expected === null) return;
    if (reported?.version === expected.version && reported.digest === expected.digest) return;
    const found =
        reported === null
            ? `the ${artifact} engine, from a release before 0.18 that does not report its version`
            : `the ${artifact} engine ${reported.version} (source ${reported.digest})`;
    throw new EngineVersionSkewError(
        `[csszyx] engine-version-skew: @csszyx/compiler ${expected.version} was built for engine source ${expected.digest} and found ${found}\n${skewHelp(input, expected)}`,
    );
}

/**
 * The fix for a skew: rebuild when only the source differs, which happens in a
 * checkout of csszyx itself; otherwise install the engine at the compiler's
 * version, naming the platform package, which a lockfile can keep at an older
 * version beside a current `@csszyx/core`.
 *
 * @param input - Both identities and the artifact.
 * @param expected - The identity the compiler was built for.
 * @returns The `help:` line.
 */
function skewHelp(input: AssertEngineIdentityInput, expected: EngineIdentity): string {
    const native = input.platformPackage !== undefined;
    if (input.reported?.version === expected.version) {
        const task = native ? 'native:build' : 'build';
        return `help: rebuild the engine from this checkout with \`pnpm --filter @csszyx/core ${task}\` after changing its source`;
    }
    if (native && input.platformPackage) {
        return `help: install @csszyx/core@${expected.version}; ${input.platformPackage} must be ${expected.version} too, so reinstall it if your lockfile holds another version`;
    }
    return `help: install @csszyx/core@${expected.version}; it installs its platform package at the same version`;
}

/** The identity exports of the wasm engine; `engine_digest` is absent before 0.18. */
export interface WasmIdentityExports {
    version(): string;
    engine_digest?(): string;
}

/**
 * What the wasm engine reports about itself.
 *
 * @param wasm - The wasm module's identity exports.
 * @returns Its identity, or null for a build too old to report one.
 */
export function wasmEngineIdentity(wasm: WasmIdentityExports): EngineIdentity | null {
    return typeof wasm.engine_digest === 'function'
        ? { version: wasm.version(), digest: wasm.engine_digest() }
        : null;
}
