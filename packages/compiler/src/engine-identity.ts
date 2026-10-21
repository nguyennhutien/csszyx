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

// Imported directly, not through `./report.js`: Node loads this module, and
// the build makes `./report.js` the whole `@csszyx/compiler/report` subpath,
// where only these entries are needed.
import { ENGINE_VERSION_SKEW } from './diagnostic-browser.generated.js';
import { CsszyxError } from './errors.js';
import { renderThrown } from './thrown-words.js';

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

/** What an {@link EngineVersionSkewError} names, by the registry's arg names. */
export interface EngineVersionSkewArgs {
    /**
     * Which skew: another release (`version`, or `platform-package` when a
     * platform package answered), one too old to report (`unreported`), or
     * the same release built from other source (`source`).
     */
    readonly form: 'version' | 'platform-package' | 'unreported' | 'source';
    /** Which artifact answered. */
    readonly artifact: 'native' | 'wasm';
    /** The engine version the compiler was built for. */
    readonly expectedVersion: string;
    /** The digest of the engine source the compiler was built for. */
    readonly expectedDigest: string;
    /** The version the engine reported; absent for one too old to report it. */
    readonly foundVersion?: string;
    /** The digest the engine reported; absent for one too old to report it. */
    readonly foundDigest?: string;
    /** The platform package that answered, for the native artifact on a host one covers. */
    readonly platformPackage?: string;
}

/**
 * Thrown when the engine that loaded is not the one this compiler was built
 * against. A csszyx error: `engine-version-skew`.
 */
export class EngineVersionSkewError extends CsszyxError {
    declare readonly code: 'engine-version-skew';

    /**
     * @param message - The full message.
     * @param args - Both identities and the artifact; csszyx always passes them.
     */
    constructor(message: string, args: Partial<EngineVersionSkewArgs> = {}) {
        super({ code: 'engine-version-skew', args, message });
        this.name = 'EngineVersionSkewError';
    }
}

/** Input to {@link assertEngineIdentity}. */
export interface AssertEngineIdentityInput {
    /** The engine this compiler was built against; null skips the check. */
    expected: EngineIdentity | null;
    /** What the engine reported; null for one older than the report itself. */
    reported: EngineIdentity | null;
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
    const { expected, reported } = input;
    if (expected === null) return;
    if (reported?.version === expected.version && reported.digest === expected.digest) return;
    const args: EngineVersionSkewArgs = {
        form: skewForm(input, expected),
        // Only the native artifact is given a platform package, `null` included.
        artifact: input.platformPackage === undefined ? 'wasm' : 'native',
        expectedVersion: expected.version,
        expectedDigest: expected.digest,
        ...(reported === null
            ? {}
            : { foundVersion: reported.version, foundDigest: reported.digest }),
        ...(input.platformPackage ? { platformPackage: input.platformPackage } : {}),
    };
    throw new EngineVersionSkewError(renderThrown(ENGINE_VERSION_SKEW, args), args);
}

/**
 * Which skew it is, which picks the fix: rebuild when only the source
 * differs, which happens in a checkout of csszyx itself; otherwise install
 * the engine at the compiler's version, naming the platform package, which a
 * lockfile can keep at an older version beside a current `@csszyx/core`.
 *
 * @param input - Both identities and the artifact.
 * @param expected - The identity the compiler was built for.
 * @returns The form.
 */
function skewForm(
    input: AssertEngineIdentityInput,
    expected: EngineIdentity,
): EngineVersionSkewArgs['form'] {
    if (input.reported === null) return 'unreported';
    if (input.reported.version === expected.version) return 'source';
    return input.platformPackage ? 'platform-package' : 'version';
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
