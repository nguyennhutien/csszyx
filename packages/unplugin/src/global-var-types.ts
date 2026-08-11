import type { GlobalVarUsageDiagnostic } from '@csszyx/compiler';

/** Source location for one CSS custom-property occurrence. */
export interface CssVarLocation {
    /** Source file path, when known. */
    filePath: string;
    /** 1-based source line. */
    line: number;
    /** 1-based source column. */
    column: number;
}

/** One CSS custom-property definition. */
export interface CssVarDefinition extends CssVarLocation {
    /** Custom-property name including the leading `--`. */
    name: string;
    /** Stable declaration scope key built from ancestor at-rules and selectors. */
    scopeId: string;
    /** Whether the definition lives inside a Tailwind v4 @theme block. */
    tailwindOwned: boolean;
    /** Whether this name is registered by an @property at-rule. */
    registered: boolean;
}

/** One var(--token) reference. */
export interface CssVarReference extends CssVarLocation {
    /** Custom-property name including the leading `--`. */
    name: string;
    /** Stable reference scope key built from ancestor at-rules and selectors. */
    scopeId: string;
    /** Declaration property or at-rule params where the reference appears. */
    owner: string;
    /** Whether the reference lives inside a Tailwind v4 @theme block. */
    tailwindOwned: boolean;
}

/** CSS custom-property scan output for one CSS source. */
export interface CssVarScanResult {
    /** Source file path, when known. */
    filePath: string;
    /** Custom-property declarations. */
    definitions: CssVarDefinition[];
    /** var(--token) references. */
    references: CssVarReference[];
    /** @property registered custom-property names. */
    registered: string[];
    /** Whether the file path appears to be third-party CSS. */
    thirdParty: boolean;
}

/** Cache entry for one CSS variable scan result. */
export interface GlobalVarScanCacheEntry {
    /** Cache key derived from file path, mtime, and content hash. */
    key: string;
    /** Cached scan result. */
    result: CssVarScanResult;
}

/** Inputs used to derive a scan cache key. */
export interface GlobalVarScanCacheKeyInput {
    /** Source file path. */
    filePath: string;
    /** CSS source text. */
    css: string;
    /** Source file mtime in milliseconds. */
    mtimeMs: number;
}

/** CSS source supplied to the global-variable validation orchestrator. */
export interface GlobalVarCssSource {
    /** Source file path. */
    filePath: string;
    /** CSS source text. */
    css: string;
    /** Source file mtime in milliseconds, used when cacheDir is set. */
    mtimeMs?: number;
}

/** JS/TS/JSX/TSX source supplied to the global-variable validation orchestrator. */
export interface GlobalVarCodeSource {
    /** Source file path. */
    filePath: string;
    /** JS/TS/JSX/TSX source text. */
    code: string;
}

/** CSS asset supplied by a bundler output hook. */
export interface GlobalVarCssAssetSource {
    /** CSS asset file name, relative to the build output or absolute. */
    fileName: string;
    /** CSS asset source contents. */
    source: string | Uint8Array;
    /** Source file mtime in milliseconds, used when cacheDir is set. */
    mtimeMs?: number;
}

/** Options for scanning one CSS source. */
export interface ScanGlobalVarCssOptions {
    /** File path used for diagnostics. */
    filePath?: string;
}

/** Planner diagnostic severity. */
export type GlobalVarAliasDiagnosticSeverity = 'error';

/** Planner diagnostic. */
export interface GlobalVarAliasDiagnostic {
    /** Machine-readable diagnostic code. */
    code:
        | 'missing-definition'
        | 'tailwind-reserved'
        | 'tailwind-owned'
        | 'registered-property'
        | 'alias-collision';
    /** Diagnostic severity. Every finding fails the build. */
    severity: GlobalVarAliasDiagnosticSeverity;
    /** Related custom-property name. */
    name: string;
    /** Human-readable message. */
    message: string;
    /** Source location when available. */
    location?: CssVarLocation;
}

/** One planned alias mapping. */
export interface GlobalVarAliasEntry {
    /** Original app-owned custom-property name. */
    original: string;
    /** Deterministic short alias name. */
    alias: string;
    /** Declaration scopes where aliases must be emitted. */
    scopes: string[];
}

/** Input to the pure global variable alias planner. */
export interface PlanGlobalVarAliasesInput {
    /** CSS scan results. */
    scans: CssVarScanResult[];
    /** Explicit app-owned custom-property names. */
    tokens?: string[];
    /** Optional app-owned prefix discovery. Empty string disables discovery. */
    autoPrefix?: string;
    /** Prefix for generated aliases. Defaults to `---g`. */
    aliasPrefix?: string;
    /** Additional reserved names or prefixes. Prefixes may end with `*`. */
    reserved?: string[];
}

/** Output from the pure global variable alias planner. */
export interface GlobalVarAliasPlan {
    /** Deterministic alias entries. Empty when diagnostics contain errors. */
    entries: GlobalVarAliasEntry[];
    /** Original-to-alias lookup. Empty when diagnostics contain errors. */
    aliases: Map<string, string>;
    /** Planner diagnostics. */
    diagnostics: GlobalVarAliasDiagnostic[];
}

/** Input for the global-variable scanner/planner/diagnostics integration. */
export interface ValidateGlobalVarAliasInputsOptions {
    /** CSS sources that define or reference custom properties. */
    cssFiles: GlobalVarCssSource[];
    /** JS/TS/JSX/TSX sources to scan for out-of-band usage. */
    sourceFiles?: GlobalVarCodeSource[];
    /** Explicit app-owned custom-property names. */
    tokens?: string[];
    /** Optional app-owned prefix discovery. Empty string disables discovery. */
    autoPrefix?: string;
    /** Prefix for generated aliases. Defaults to `---g`. */
    aliasPrefix?: string;
    /** Additional reserved names or prefixes. Prefixes may end with `*`. */
    reserved?: string[];
    /** Optional global-var scan cache directory. */
    cacheDir?: string;
}

/** Input for building validation options from bundler output state. */
export interface CreateGlobalVarAliasValidationOptionsInput {
    /** Project root used to normalize relative asset names. */
    rootDir: string;
    /** CSS assets emitted by the bundler. Non-CSS assets are ignored. */
    cssAssets: GlobalVarCssAssetSource[];
    /** Source files transformed or observed before bundling. */
    sourceFiles?: GlobalVarCodeSource[];
    /** Explicit app-owned custom-property names. */
    tokens?: string[];
    /** Optional app-owned prefix discovery. Empty string disables discovery. */
    autoPrefix?: string;
    /** Prefix for generated aliases. Defaults to `---g`. */
    aliasPrefix?: string;
    /** Additional reserved names or prefixes. Prefixes may end with `*`. */
    reserved?: string[];
    /** Optional global-var scan cache directory. */
    cacheDir?: string;
}

/** Output from the global-variable scanner/planner/diagnostics integration. */
export interface GlobalVarAliasValidationResult {
    /** CSS scan results. */
    scans: CssVarScanResult[];
    /** Deterministic alias plan. */
    plan: GlobalVarAliasPlan;
    /** JS/JSX out-of-band usage diagnostics for planned candidates. */
    usageDiagnostics: GlobalVarUsageDiagnostic[];
}

/** Options for rewriting CSS with a validated global variable alias plan. */
export interface RewriteGlobalVarCssAliasesOptions {
    /** CSS source text. */
    css: string;
    /** Validated alias plan. Diagnostics keep the rewrite as a no-op. */
    plan: GlobalVarAliasPlan;
    /** Source file path used by PostCSS diagnostics/source maps. */
    filePath?: string;
}

/** Result of a pure global variable CSS alias rewrite. */
export interface GlobalVarCssAliasRewriteResult {
    /** Rewritten CSS source. */
    css: string;
    /** Number of alias declarations inserted. */
    aliasDeclarations: number;
    /** Number of `var(--token)` references rewritten. */
    rewrittenReferences: number;
    /** Planner diagnostics that prevented rewriting, when any. */
    diagnostics: GlobalVarAliasDiagnostic[];
}
