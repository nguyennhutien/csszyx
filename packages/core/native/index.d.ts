/** Optional native package names supported by the future Node transform. */
export type NativePlatformPackage =
    | '@csszyx/core-linux-x64-gnu'
    | '@csszyx/core-linux-x64-musl'
    | '@csszyx/core-linux-arm64-gnu'
    | '@csszyx/core-linux-arm64-musl'
    | '@csszyx/core-darwin-x64'
    | '@csszyx/core-darwin-arm64'
    | '@csszyx/core-win32-x64-msvc'
    | '@csszyx/core-win32-arm64-msvc';

/** Source file passed to the native batch transform. */
export interface NativeTransformFile {
    /** Absolute or project-relative filename used for diagnostics and cache identity. */
    filename: string;
    /** Source module contents. */
    source: string;
}

/** Native transform output shape returned per source file. */
export interface NativeTransformResult {
    /** Rewritten source code. */
    code: string;
    /** Source map payload once native rewriting lands. */
    map: unknown;
    /** Generated csszyx/Tailwind classes. */
    classes: string[];
    /** Static className/class strings discovered in the source. */
    rawClassNames: string[];
    /** Non-fatal transform diagnostics. */
    diagnostics: string[];
    /** Recovery token metadata emitted for hydration safety. */
    recoveryTokens: Array<{
        /** Public token inserted into generated code. */
        token: string;
        /** Recovery mode encoded in the token. */
        mode: 'csr' | 'dev-only';
        /** Component label associated with the token. */
        component: string;
        /** Source path associated with the token. */
        path: string;
    }>;
    /** Native transform metadata used by unplugin and benchmarks. */
    metadata: {
        /** Whether source code changed. */
        transformed: boolean;
        /** Whether the result imports the runtime _sz helper. */
        usesRuntime: boolean;
        /** Whether the result imports the runtime _szMerge helper. */
        usesMerge: boolean;
        /** Whether the result imports the runtime color-var helper. */
        usesColorVar: boolean;
        /** Producer identity for cache safety. */
        producer: 'rust';
        /** Whether native AST budget protection fired. */
        astBudgetExceeded: boolean;
        /** Native timing breakdown in nanoseconds. */
        timings: {
            /** Fast pre-parser triage time. */
            triageNs: number;
            /** oxc parser time. */
            parseNs: number;
            /** Same-file scope collection time. */
            scopeNs: number;
            /** AST visitor to IR lowering time. */
            irNs: number;
            /** IR class lowering time. */
            lowerNs: number;
            /** Recovery token collection time. */
            recoveryNs: number;
            /** Safety diagnostic assembly time. */
            diagnosticsNs: number;
            /** Source rewrite time. */
            rewriteNs: number;
            /** Total native transform time. */
            totalNs: number;
        };
    };
    /** Native parser lane used for this file. */
    parserPath: 'fastRegex' | 'static' | 'semantic';
}

/** Error thrown when the native transform package is not installed/available. */
export class CsszyxNativeUnavailableError extends Error {
    /** Stable machine-readable error code. */
    readonly code: 'CSSZYX_NATIVE_UNAVAILABLE';
    /** Optional package expected for the current platform, when supported. */
    readonly packageName: NativePlatformPackage | null;

    /** Creates a native-unavailable error. */
    constructor(message?: string, packageName?: NativePlatformPackage | null);
}

/** Native binding shape exported by optional platform packages. */
export interface NativeBinding {
    /**
     * Transforms source files with the native Rust core.
     *
     * @param files Source files to transform.
     * @returns Native transform results in input order.
     */
    transformBatch(files: NativeTransformFile[]): NativeTransformResult[];
}

/**
 * Returns the optional native package name for the current platform.
 *
 * @returns Platform package name, or null when the platform is unsupported.
 */
export function getNativePackageName(): NativePlatformPackage | null;

/**
 * Loads the native binding once platform packages exist.
 *
 * @param packageName Optional package name override for tests and platform probes.
 * @returns Native binding after platform packages are available.
 */
export function loadNativeBinding(
    packageName?: NativePlatformPackage | string | null,
): NativeBinding;

/**
 * Transforms a batch of files with the future native Rust core.
 *
 * @param files Source files to transform.
 * @returns Native transform results in input order.
 */
export function transformBatch(files: NativeTransformFile[]): NativeTransformResult[];
