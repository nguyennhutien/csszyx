/** Optional native package names supported by the Node-native transform. */
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

/** Options passed to the native transform. */
export interface NativeTransformOptions {
    /** Whether dynamic CSS custom properties should use tiered short names. */
    mangleVars?: boolean;
    /** Maximum cascade depth for component-tier CSS variable hoisting. */
    mangleVarHoistMaxDepth?: number;
    /** Exact app-owned global custom-property aliases for static sz values. */
    globalVarAliases?: Array<{
        /** Original custom-property name, including `--`. */
        original: string;
        /** Alias custom-property name, including `--`. */
        alias: string;
    }>;
    /** Project root used only to render diagnostic file paths relative to it. */
    rootDir?: string;
    /** Per-file AST node cap override (`build.astBudgetLimit`). */
    astBudget?: number;
    /** Cross-module szv registry payload (ordered-pair JSON). */
    crossModuleStaticsJson?: string;
}

/** Native transform output shape returned per source file. */
export interface NativeTransformResult {
    /** Rewritten source code. */
    code: string;
    /** Source map payload, or null when the native rewrite does not emit a map. */
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
    /** CSS custom property mangle metadata. */
    cssVariableMap: Array<{
        /** Original csszyx-generated custom property name. */
        original: string;
        /** Mangled custom property name. */
        mangled: string;
    }>;
    /** Native transform metadata used by unplugin and benchmarks. */
    metadata: {
        /** Whether source code changed. */
        transformed: boolean;
        /** Whether the result imports the runtime _sz helper. */
        usesRuntime: boolean;
        /** Whether the result imports the runtime _szMerge helper. */
        usesMerge: boolean;
        /** Whether the result imports the runtime szcn helper (sz array composition). */
        usesSzcn: boolean;
        /** Whether the result imports the runtime _szPart helper (dynamic array elements). */
        usesSzPart: boolean;
        /** Whether the result imports the runtime __szvPick helper. */
        usesSzvPick: boolean;
        /** True when every emitted _szPart argument is provably string/falsy. */
        szPartArgsProvable: boolean;
        /** Whether the result imports the runtime color-var helper. */
        usesColorVar: boolean;
        /** Whether the emitted code calls the __szSpacingVar runtime helper. */
        usesSpacingVar?: boolean;
        /** Whether the emitted code calls the __szUnitVar runtime helper. */
        usesUnitVar?: boolean;
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
     * @param options Native transform options.
     * @returns Native transform results in input order.
     */
    transformBatch(
        files: NativeTransformFile[],
        options?: NativeTransformOptions,
    ): NativeTransformResult[];
}

/**
 * Returns the optional native package name for the current platform.
 *
 * @returns Platform package name, or null when the platform is unsupported.
 */
export function getNativePackageName(): NativePlatformPackage | null;

/**
 * Loads the native binding from the current or provided platform package.
 *
 * @param packageName Optional package name override for tests and platform probes.
 * @returns Native binding after platform packages are available.
 */
export function loadNativeBinding(
    packageName?: NativePlatformPackage | string | null,
): NativeBinding;

/**
 * Transforms a batch of files with the native Rust core.
 *
 * @param files Source files to transform.
 * @param options Native transform options.
 * @returns Native transform results in input order.
 */
export function transformBatch(
    files: NativeTransformFile[],
    options?: NativeTransformOptions,
): NativeTransformResult[];
