import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
    ASTBudgetExceededError,
    type CssVariableMangleValue,
    ensureRustTransformAvailable,
    isRustTransformAvailable,
    type SourceTransformResult,
    sortStrings,
    szFallbackConsequenceOf,
    type TokenData,
    type TransformSourceCodeOptions,
    transform,
    transformOxc,
    transformRust,
    transformRustBatch,
    transformSourceCode,
} from '@csszyx/compiler';
import { compute_mangle_checksum, encode } from '@csszyx/core';
import { getNativePackageName } from '@csszyx/core/native';
import { type SvelteAdapterOptions, preprocess as sveltePreprocess } from '@csszyx/svelte-adapter';
import {
    CSSZYX_GLOBAL_ALIAS_PREFIX,
    DEFAULT_BUILD_CONFIG,
    DEFAULT_IMPORTED_STATIC_SZ,
    type GlobalVarMangleConfig,
    type PartialCsszyxConfig,
    validateGlobalVarMangleConfig,
} from '@csszyx/types';
import { type VueAdapterOptions, preprocess as vuePreprocess } from '@csszyx/vue-adapter';
import type { Plugin as EsbuildPlugin, PluginBuild } from 'esbuild';
import type { InputPluginOption } from 'rollup';
import { createUnplugin, type UnpluginInstance, type WebpackPluginInstance } from 'unplugin';
import type { PluginOption } from 'vite';
import type { Compilation as WebpackCompilation, Compiler as WebpackCompiler } from 'webpack';
import { collectAuthoredClassNames, findBalancedCodeEnd } from './authored-class-scanner.js';
import { babelFallbackReason } from './babel-fallback-reason.js';
import { findUnknownConfigKeys, unknownConfigKeysMessage } from './config-keys.js';
import {
    importedSpecifiersIn,
    mayExportSzvFactories,
    recordSzObjectRegistryFile,
    recordSzvRegistryFile,
    resolveCrossModuleStaticsFor,
    resolveProviderPath,
    resolveProviderPathWith,
    type SzvCrossModuleRegistry,
    specifierBases,
} from './cross-module-registry.js';
import { mangleCSSSync } from './css-mangler.js';
import { insertAfterUseDirective } from './directive-prologue.js';
import { expandFilePatterns, matchesAnyPattern } from './file-patterns.js';
import {
    createGlobalVarAliasValidationOptions,
    type GlobalVarAliasValidationResult,
    type GlobalVarCodeSource,
    type GlobalVarCssAssetSource,
    resolveGlobalVarScanCacheDir,
    rewriteGlobalVarCssAliases,
    validateGlobalVarAliasInputs,
} from './global-var-scanner.js';
import { escapeHtmlAttribute, renderTailwindScannerCandidates } from './html-escape.js';
import {
    buildRecoveryManifest,
    createHydrationMangleMap,
    transformIndexHtml as injectHydrationData,
    injectRecoveryManifest,
} from './html-transformer.js';
import { escapeForDoubleQuotedString, escapeJsonForInlineScript } from './inline-script-escape.js';
import {
    computeMangleSizeVerdict,
    createMangleSizeAccount,
    type MangleSizeAccount,
    mangleSizeMessage,
    recordCodePair,
    recordCssPair,
    resetMangleSizeAccount,
} from './mangle-size-report.js';
import { runtimeHelperGroupsFromUsage } from './next-runtime-injection.js';
import { resolveParserMode } from './parser-mode.js';
import { normalizePathSeparators } from './path-normalization.js';
import { isReadableProviderFile } from './provider-file.js';
import {
    assertNoRSCBoundaryViolation,
    assertNoRSCGraphViolation,
    createRSCModuleRecord,
    deleteRSCModuleRecord,
    type RSCModuleRecord,
} from './rsc-boundary.js';
import { findRuntimeImportClause, importsRuntimeHelper } from './runtime-import-scan.js';
import { collectSpecifierAliases, type SpecifierAlias } from './specifier-aliases.js';
import { readStableTextFileSnapshotSync } from './stable-file-snapshot.js';
import { discoverProjectTheme } from './theme-discovery.js';
import {
    ensureThemeGroupsFile,
    THEME_GROUPS_FILE_MARKER,
    themeGroupsSpecifier,
} from './theme-groups-file.js';
import { mergeThemes, type ParsedTheme, parseThemeBlocks } from './theme-scanner.js';
import { writeThemeDts } from './theme-type-writer.js';
import {
    createTransformCacheKey,
    evictMemoryCacheToBudget,
    evictOldTransformCacheEntries,
    readTransformCache,
    resolveTransformCacheDir,
    type TransformCacheKey,
    type TransformCacheKeyInput,
    writeTransformCache,
} from './transform-cache.js';
import {
    CHECKSUM_PLACEHOLDER,
    createChecksumModule,
    createMangleMapModule,
    createMangleRuntimeModule,
    createThemeGroupsModule,
    isVirtualModule,
    MANGLE_MAP_PLACEHOLDER,
    MANGLE_RUNTIME_VIRTUAL_ID,
    RESOLVED_MANGLE_RUNTIME_VIRTUAL_ID,
    RESOLVED_THEME_GROUPS_VIRTUAL_ID,
    RESOLVED_VIRTUAL_CHECKSUM_ID,
    RESOLVED_VIRTUAL_MODULE_ID,
    resolveVirtualModule,
    THEME_GROUPS_VIRTUAL_ID,
    type ThemeGroupTokens,
    VAR_MANGLE_MAP_PLACEHOLDER,
} from './virtual-modules.js';

/**
 * Plugin state for mangle map management.
 */
interface PluginState {
    /**
     * Every class csszyx wants Tailwind to generate CSS for — sz-generated
     * classes plus raw author `className` values seen during the fallback scan.
     * Drives the `@source` safelist; NOT the mangle map.
     */
    classes: Set<string>;
    /**
     * Merged @theme scan result — the ONLY consumer is the theme-groups virtual
     * module, so this is a merge-correctness input, not a typing one.
     */
    parsedTheme: import('./theme-scanner.js').ParsedTheme | null;
    /**
     * Tokens from the files `build.scanCss` lists, kept apart from the
     * project-wide discovery so a token deleted from either source disappears
     * from the merged result instead of lingering across a re-scan.
     */
    scanCssTheme: import('./theme-scanner.js').ParsedTheme | null;
    /**
     * CSS files the project-wide @theme scan found tokens in. Dev HMR re-scans
     * when one of these — or any other .css file — changes, mirroring the
     * explicit scanCss reload path.
     */
    autoThemeCssFiles: string[];
    /**
     * True once any processed CSS file was seen importing `tailwindcss`. Used to
     * warn at build end when csszyx generated classes but nothing makes Tailwind
     * emit their CSS (no entry → the classes resolve to no styles, silently).
     */
    sawTailwindEntry: boolean;
    /**
     * True once ANY CSS file passed through the transform hook. The missing-entry
     * warning only fires when csszyx actually observed the CSS pipeline but found
     * no `tailwindcss` entry — otherwise it false-positives in setups where CSS is
     * handled outside this hook or not yet processed at build end (`astro check`,
     * an early Astro build phase), where the build in fact emits valid CSS.
     */
    sawAnyCss: boolean;
    /** Guards the missing-Tailwind-entry warning so it fires at most once. */
    tailwindWarningEmitted: boolean;
    /** Whether a Tailwind entry scoped content detection (source()/@source not). */
    tailwindEntryScoped: boolean;
    /** Guards the unscoped-monorepo warning so it fires at most once. */
    contentScopeWarningEmitted: boolean;
    /** Memoized `isMonorepoPackage(rootDir)` result; `undefined` until computed. */
    inMonorepo?: boolean;
    /**
     * Classes csszyx generated by lowering `sz` props. Final map eligibility
     * subtracts authoredClasses because a class can be both generated and used
     * by a raw selector consumer.
     */
    ownedClasses: Set<string>;
    /**
     * Classes written through author-facing class/className attributes. Any
     * overlap with ownedClasses must keep its original name because bundled
     * helper calls may not preserve enough context for safe string rewriting.
     */
    authoredClasses: Set<string>;
    /** Unresolvable-spread warnings surfaced to the build log in every mode. */
    spreadWarnings: Set<string>;
    /**
     * Advisory sz fallbacks this build declined to list.
     *
     * Counted so the build can say the list is partial. Printing nothing is not
     * the same as printing "nothing happened", and a log that names five
     * fallbacks while holding three back reads as a total.
     */
    suppressedAdvisories: number;
    /**
     * Workspace-package files under `/packages/` that use csszyx but were
     * skipped by the hard-ignore (not under any `compileSources` dir). Surfaced at
     * build end so the silent no-op (skipped `sz` → no CSS) becomes visible.
     */
    skippedSzFiles: Set<string>;
    /**
     * The subset of {@link skippedSzFiles} that may export szv factories.
     *
     * Skipping one of these does more than lose a file's own CSS: it keeps the
     * module out of the cross-module registry, so every importer — compiled or
     * not — silently falls back to the runtime path. That is dropped csszyx
     * output rather than a usage nudge, so its presence promotes the warning
     * out of dev-only.
     */
    skippedSzvExportFiles: Set<string>;
    /** Guards the skipped-sz-files warning so it fires at most once. */
    skipWarningEmitted: boolean;
    /**
     * Set once the safelist class set hits {@link MAX_SAFELIST_CLASSES} and extra
     * classes are dropped — bounds memory/output growth from pathological input.
     */
    classesCapped: boolean;
    mangleMap: Record<string, string>;
    varMangleEntriesByFile: Map<string, Array<[string, string]>>;
    varMangleMap: Record<string, CssVariableMangleValue>;
    cssVarMetricsByFile: Map<string, CSSVariableMetrics>;
    cssVarMetrics: CSSVariableMetrics;
    checksum: string;
    finalized: boolean;
    rootDir: string;
    /**
     * Recovery tokens collected from szRecover JSX attributes across all
     * transformed files. Aggregated by the `transform` hook (compiler emits
     * the data-sz-recovery-token attribute and returns the per-file map),
     * then serialised into the manifest script tag injected into SSR HTML.
     */
    recoveryTokens: Map<string, TokenData>;
    /** RSC graph records collected from transformed TS/JS modules. */
    rscModules: Map<string, RSCModuleRecord>;
    /** Source files observed by the transform hook for global-var diagnostics. */
    globalVarSourceFilesByFile: Map<string, string>;
    /** Last validated global-var alias result for the current output hook. */
    globalVarValidationResult: GlobalVarAliasValidationResult | null;
}

/** CSS variable mangling and hoisting metrics emitted for debugging. */
interface CSSVariableMetrics {
    componentClassUses: number;
    componentStyleDeclarations: number;
    estimatedHoistedDeclarationsSaved: number;
    scopedClassUses: number;
    scopedStyleDeclarations: number;
}

/** Manifest emitted beside final Vite/Webpack assets. */
interface CSSzyxBundleManifest {
    version: string;
    buildId: string;
    classes: string[];
    mangleMap?: Record<string, string>;
    varMangleMap?: Record<string, CssVariableMangleValue>;
    globalVarAliases?: Record<string, string>;
    cssVarMetrics?: CSSVariableMetrics;
}

/** Final Webpack asset processor registered outside adapter callback nesting. */
type WebpackAssetProcessor = (
    assets: WebpackCompilation['assets'],
    compilation: WebpackCompilation,
    compiler: WebpackCompiler,
) => void;

/**
 * Register the Webpack process-assets stage without nesting it inside plugin factories.
 *
 * @param compiler Webpack compiler instance.
 * @param processAssets Final asset processor.
 */
function registerWebpackAssetProcessor(
    compiler: WebpackCompiler,
    processAssets: WebpackAssetProcessor,
): void {
    compiler.hooks.compilation.tap('csszyx:post', compilation => {
        const stage =
            compiler.webpack?.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE ||
            (compilation.constructor as { PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE?: number })
                .PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE;
        compilation.hooks.processAssets.tap({ name: 'csszyx:post', stage: stage || 400 }, assets =>
            processAssets(assets, compilation, compiler),
        );
    });
}

/** Source file queued by the prescan walker. */
interface PrescanSourceFile {
    /** Absolute source path. */
    filePath: string;
    /** Source contents. */
    content: string;
}

/** Prescan source file plus transform result. */
interface PrescanTransformResult {
    /** Absolute source path. */
    filePath: string;
    /** Compiler result for the file. */
    result: SourceTransformResult;
}

/** One Rust prescan input not satisfied by the transform cache. */
interface RustPrescanMiss {
    filePath: string;
    effectiveFilename: string;
    content: string;
    cacheInput: TransformCacheKeyInput;
    cacheKey: TransformCacheKey | null;
}

// Mangle placeholders (injected during transform, replaced in
// processAssets/generateBundle) live in virtual-modules.ts so the
// mangle-runtime virtual module can embed the same markers.
const UNKNOWN_PACKAGE_VERSION = '0.0.0';
const TRANSFORM_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const TRANSFORM_CACHE_MAX_ENTRIES = 10_000;
const TRANSFORM_MEMORY_CACHE_MAX_ENTRIES = 1_000;
// Entry count alone is not a memory bound: each entry retains the FULL
// transformed code string, so 1000 large generated files could hold ~hundreds
// of MB in a long-lived dev server. Cap the total retained code size too
// (~32M chars ≈ 64MB of JS string memory) and evict oldest-first past either
// limit.
const TRANSFORM_MEMORY_CACHE_MAX_CODE_CHARS = 32_000_000;
// Upper bound on the safelist class set. Far above any real project (a large app
// emits a few thousand unique utilities); the cap only trips on pathological /
// hostile input — e.g. unbounded unique arbitrary values — and bounds the memory
// and generated-file growth those would otherwise cause.
const MAX_SAFELIST_CLASSES = 100_000;
const DEFAULT_VAR_MANGLE_MAP_MAX_BYTES = 100 * 1024;
const GLOBAL_VAR_ALIAS_MAP_OWNER = '\0csszyx:global-var-aliases';
// Runtime-helper import detection now lives in runtime-import-scan.ts as a
// linear forward scan — the previous `\{[^{}]*\bNAME\b[^{}]*\}` regexes were
// quadratic-by-search (two open runs around the needle).

/** Byte span of an opening tag `<name …>` inside a source string. */
interface OpeningTagSpan {
    /** Index of the `<`. */
    readonly start: number;
    /** Index of the `>`. */
    readonly close: number;
}

/**
 * Locate the FIRST `<tag …>` opening (case-insensitive), or null when absent.
 * Linear indexOf scan replacing `/<tag([^>]*)>/i`, whose `[^>]*` re-scanned
 * from each `<tag` position when no `>` followed.
 *
 * @param source - Source to scan.
 * @param tag - Lowercase tag name.
 * @returns The `<`…`>` span, or null when the tag is absent.
 */
function findOpeningTag(source: string, tag: string): OpeningTagSpan | null {
    const lower = source.toLowerCase();
    const marker = `<${tag}`;
    let from = 0;
    for (;;) {
        const start = lower.indexOf(marker, from);
        if (start === -1) {
            return null;
        }
        // The char after `<tag` must end the tag name so `<body` does not match
        // `<bodyguard` — the regex `<body[^>]*>` required a `>` or attribute
        // char (whitespace/`/`) next, never a name character.
        const after = source[start + marker.length];
        if (after === undefined || after === '>' || after === '/' || /\s/.test(after)) {
            const close = source.indexOf('>', start + marker.length);
            if (close !== -1) {
                return { start, close };
            }
            return null;
        }
        from = start + marker.length;
    }
}

let _hasWarnedTsConfig = false;
let _hasWarnedTransformCacheVersion = false;
let _hasWarnedNativeFallback = false;
// Keyed by resolved parser mode, not a single boolean: one process can hold
// several plugin instances (client + SSR configs, or a tool that loads the
// config twice), and when the first instance resolved a different mode the log
// used to claim an engine the real build never used — which cost a field user
// an investigation. Each distinct mode announces itself once.
const _loggedActiveParsers = new Set<string>();
// Files for which an oxc→Babel fallback has already been reported, so the
// per-file warning is emitted once per file rather than on every re-transform.
const _babelFallbackFiles = new Set<string>();
const requireFromHere: NodeJS.Require = createRequire(import.meta.url);
const PLUGIN_VERSION = findPackageVersionFromFile(
    fileURLToPath(import.meta.url),
    UNKNOWN_PACKAGE_VERSION,
);
const COMPILER_VERSION = findPackageVersionFromModule('@csszyx/compiler', UNKNOWN_PACKAGE_VERSION);

let cachedNativeCacheIdentity: string | null = null;

/**
 * Identity of the installed native engine binary for transform-cache keys.
 *
 * Rust-mode output depends on the `.node` binary, and its package version is
 * not enough: rebuilding the same version from changed sources (workspace
 * development) previously kept serving stale cached transforms. Combine the
 * native package version with the resolved binary's mtime and size so an
 * engine rebuild invalidates the cache; a re-install can only cause an extra
 * miss, never a stale hit.
 *
 * @returns A stable identity string, or a sentinel when unresolvable.
 */
export function resolveNativeCacheIdentity(): string {
    if (cachedNativeCacheIdentity !== null) {
        return cachedNativeCacheIdentity;
    }
    try {
        const packageName = getNativePackageName();
        if (!packageName) {
            cachedNativeCacheIdentity = 'unavailable';
            return cachedNativeCacheIdentity;
        }
        const version = (requireFromHere(`${packageName}/package.json`) as { version?: string })
            .version;
        const binaryPath = requireFromHere.resolve(packageName);
        const stats = fs.statSync(binaryPath);
        cachedNativeCacheIdentity = `${packageName}@${version ?? '0'}:${Math.floor(
            stats.mtimeMs,
        )}:${stats.size}`;
    } catch {
        cachedNativeCacheIdentity = 'unresolved';
    }
    return cachedNativeCacheIdentity;
}
const BENCH_TRACE_ENABLED = process.env.CSSZYX_BENCH_TRACE === '1';
const BENCH_TRACE_FILE = process.env.CSSZYX_BENCH_TRACE_FILE;

/**
 * Appends an `@source "<relPath>";` directive to a CSS module so Tailwind v4
 * scans the csszyx-generated safelist file.
 *
 * `@source` is position-independent in Tailwind v4 — it can appear anywhere in
 * the compiled CSS — so the directive is **appended as its own statement**
 * rather than spliced next to the `@import "tailwindcss…"` line. Matching the
 * import syntax is the source of a real defect: the split / manual Tailwind v4
 * setup (`@import "tailwindcss/utilities.css" layer(…)` or `… source(…)`, or an
 * import without a trailing `;`) does not match an import-anchored regex, so the
 * injection silently no-ops and every csszyx-only class (e.g. the static
 * `bg-primary/50` produced by `sz={{ bg: { color, op } }}`) gets no CSS while a
 * raw `className` still works. Appending is correct for every import form.
 *
 * @param code - CSS module source already known to import tailwindcss.
 * @param relPath - safelist path relative to this CSS file (posix, `./`-prefixed).
 * @returns the code with the directive appended, or `null` if it is already
 *   present (idempotent — re-running the transform must not stack directives).
 */
export function appendTailwindSourceDirective(code: string, relPath: string): string | null {
    const directive = `@source "${relPath}";`;
    if (code.includes(directive)) {
        return null;
    }
    const separator = code.length === 0 || code.endsWith('\n') ? '' : '\n';
    return `${code}${separator}${directive}\n`;
}

/**
 * Strip CSS block comments in a single linear pass. The regex form
 * (`/\/\*[\s\S]*?\*\//`) is polynomial-ReDoS on adversarial input such as an
 * unterminated `/*` followed by many `a/*` repetitions (CodeQL
 * js/polynomial-redos), so scan by hand: O(n), no backtracking, copying only
 * the whole non-comment spans.
 *
 * @param code - CSS source that may contain block comments.
 * @returns the source with every block comment removed.
 */
function stripCssBlockComments(code: string): string {
    const SLASH = 47;
    const STAR = 42;
    let out = '';
    let last = 0;
    let i = 0;
    const n = code.length;
    while (i < n) {
        if (code.codePointAt(i) === SLASH && code.codePointAt(i + 1) === STAR) {
            out += code.slice(last, i);
            i += 2;
            while (i < n && !(code.codePointAt(i) === STAR && code.codePointAt(i + 1) === SLASH)) {
                i++;
            }
            i += 2; // skip past the closing */ (or past EOF if unterminated)
            last = i;
        } else {
            i++;
        }
    }
    return out + code.slice(last);
}

/**
 * Whether a CSS module actually imports the `tailwindcss` package, so the
 * `@source` directive should be appended.
 *
 * Tighter than a substring check on purpose: block comments are stripped first
 * (a commented-out `@import` must not trigger injection), and the package name
 * must end at a quote or a `/` subpath so a different package whose name merely
 * starts with `tailwindcss` (e.g. `tailwindcss-animate`) does not match. Import
 * options after the closing quote (`layer(…)`, `source(…)`) are irrelevant — the
 * match ends at the quote — so every real Tailwind v4 import form is covered.
 *
 * @param code - CSS module source.
 * @returns true if the module imports tailwindcss (exact or a subpath).
 */
export function cssImportsTailwind(code: string): boolean {
    const withoutBlockComments = stripCssBlockComments(code);
    return /@import\s+["']tailwindcss(?:\/[^"']*)?["']/.test(withoutBlockComments);
}

/**
 * Whether the discovered class set contains at least one real Tailwind
 * candidate worth injecting an `@source` for — at least two characters and
 * starting with a letter, which excludes pure mangled symbols.
 *
 * @param classes - the discovered class set.
 * @returns true if any class is an injectable candidate.
 */
export function hasInjectableTailwindCandidate(classes: Iterable<string>): boolean {
    for (const c of classes) {
        if (c.length >= 2 && /^[a-z]/.test(c)) {
            return true;
        }
    }
    return false;
}

/**
 * Whether to warn that csszyx generated classes Tailwind will not emit CSS for.
 * Fires only when csszyx owns at least one generated class AND no processed CSS
 * imported tailwindcss — i.e. nothing makes Tailwind scan the generated classes.
 *
 * @param ownedClassCount - number of csszyx-generated classes this build produced.
 * @param sawTailwindEntry - whether any processed CSS imported tailwindcss.
 * @param sawAnyCss - whether ANY CSS file passed through the transform hook. When
 *   false, csszyx never observed the CSS pipeline (e.g. `astro check`, an early
 *   Astro build phase, or CSS handled outside this hook) and cannot conclude the
 *   entry is missing — so it stays silent rather than false-positive on a build
 *   that does emit valid CSS.
 * @returns true when the missing-entry warning should fire.
 */
export function shouldWarnMissingTailwindEntry(
    ownedClassCount: number,
    sawTailwindEntry: boolean,
    sawAnyCss: boolean,
): boolean {
    return ownedClassCount > 0 && sawAnyCss && !sawTailwindEntry;
}

/**
 * Build the missing-Tailwind-entry warning message.
 * @param ownedClassCount - number of csszyx-generated classes this build produced.
 * @returns the warning string.
 */
export function missingTailwindEntryMessage(ownedClassCount: number): string {
    return (
        `[csszyx] generated ${ownedClassCount} sz class(es) but found no CSS entry ` +
        'importing "tailwindcss" — those classes will produce no CSS. Import "tailwindcss" ' +
        'in a CSS file (csszyx auto-injects @source for the generated classes) so Tailwind ' +
        'emits their styles.'
    );
}

/**
 * Hazards that make production mangling unsafe in a hybrid build (a separate
 * Tailwind plugin owns the utility CSS and/or hand-written CSS uses literal class
 * names). Computed from data `mangleCSSSync` already returns across every CSS
 * asset, so it is free to surface.
 */
export interface MangleHybridHazards {
    /**
     * Mangled tokens that ALSO appear as a class name in non-csszyx CSS. The
     * short token (e.g. `y` for `w-full`) then matches external `.y` elements and
     * cross-contaminates their styles — the core hybrid-mangle failure.
     */
    collisions: string[];
    /**
     * Map sources csszyx mangled but whose class never appeared in any emitted
     * CSS (e.g. a utility Tailwind never generated, or a malformed key). Their
     * DOM class is rewritten to a token with no rule → the element loses styling.
     */
    orphans: string[];
}

/**
 * Detect hybrid-mangle hazards from the accumulated per-asset mangle results.
 *
 * @param mangleMap - the full original→token map injected into the runtime.
 * @param mangledSources - map keys that were actually found and renamed in some CSS asset.
 * @param externalClasses - class names found in CSS that are NOT in the mangle map (non-csszyx).
 * @returns the colliding tokens and orphan sources (each sorted, deduped).
 */
export function collectMangleHybridHazards(
    mangleMap: Record<string, string>,
    mangledSources: ReadonlySet<string>,
    externalClasses: ReadonlySet<string>,
): MangleHybridHazards {
    const tokenValues = new Set(Object.values(mangleMap));
    const collisions = sortStrings([...tokenValues].filter(token => externalClasses.has(token)));
    const orphans = sortStrings(
        Object.keys(mangleMap).filter(source => !mangledSources.has(source)),
    );
    return { collisions, orphans };
}

/**
 * Build the hybrid-mangle hazard warning, or null when there is nothing to warn.
 *
 * @param hazards - the detected collisions and orphans.
 * @returns a warning string, or null when both lists are empty.
 */
export function mangleHybridHazardMessage(hazards: MangleHybridHazards): string | null {
    const { collisions, orphans } = hazards;
    if (collisions.length === 0 && orphans.length === 0) {
        return null;
    }
    const parts: string[] = ['[csszyx] production mangle found hybrid hazards:'];
    if (collisions.length > 0) {
        const sample = collisions.slice(0, 8).join(', ');
        parts.push(
            ` ${collisions.length} mangled token(s) collide with class names in non-csszyx CSS ` +
                `(e.g. ${sample}) — those tokens will cross-contaminate external ".${collisions[0]}" ` +
                'elements.',
        );
    }
    if (orphans.length > 0) {
        const sample = orphans.slice(0, 8).join(', ');
        parts.push(
            ` ${orphans.length} mangled class(es) have no emitted CSS rule (e.g. ${sample}) — ` +
                'those elements lose styling.',
        );
    }
    if (collisions.length > 0) {
        // Guide the prod hotfix first, then the two real fixes. Renaming is
        // preferred because single-letter / common class names collide with
        // mangle tokens AND risk specificity clashes with other libraries; an
        // exclude is the escape hatch only for names in code you cannot change.
        parts.push(
            ' HOTFIX: pass `production: { mangle: false }` to the csszyx plugin to ship now.' +
                ' THEN fix it: if these short names are in your OWN CSS, rename them to' +
                ' something specific (e.g. `.x` → `.resize-handle-x`) — short/common names' +
                ' also clash on specificity with other libraries. Only for names in a' +
                ' third-party stylesheet you cannot edit, list them in' +
                ' `production.mangleExclude` instead. Run `npx @csszyx/cli scan-collisions`' +
                ' to find every offending name.',
        );
    } else {
        parts.push(
            ' Those classes are csszyx-owned but no CSS was emitted for them' +
                ' (e.g. a separate Tailwind plugin owns the utility CSS, or the class is not' +
                ' a real utility). Ensure that CSS is generated, or pass' +
                ' `production: { mangle: false }` to the csszyx plugin until the pipelines' +
                ' are reconciled.',
        );
    }
    return parts.join('');
}

/**
 * A `@import "tailwindcss"` / `@import "tailwindcss/<layer>.css"` specifier.
 *
 * Global because the modifier scan below inspects every Tailwind import in the
 * file, not only the first: a split setup imports the layers separately and any
 * one of them may carry the scoping modifier.
 */
const TAILWIND_IMPORT_SPECIFIER = /@import\s+["']tailwindcss(?:\/[^"']*)?["']/g;

/** A `source()` modifier, as a whole word so `nosource(` cannot match. */
const SOURCE_MODIFIER = /\bsource\(/;

/**
 * Whether any Tailwind import carries a `source()` modifier.
 *
 * Tailwind v4 accepts the import modifiers — `layer()`, `important`, `theme()`,
 * `prefix()`, `source()` — in any order, so matching one arrangement recognises
 * only the projects that happen to write it that way. Reading the modifier list
 * up to the statement terminator is order-independent by construction, and
 * bounding it at the `;` stops an unscoped import from borrowing the scoping of
 * an unrelated import further down the file.
 *
 * @param css - CSS module source, block comments already stripped.
 * @returns true when a Tailwind import scopes content detection.
 */
function tailwindImportScopesContent(css: string): boolean {
    for (const match of css.matchAll(TAILWIND_IMPORT_SPECIFIER)) {
        const modifiersStart = match.index + match[0].length;
        const terminator = css.indexOf(';', modifiersStart);
        const modifiers =
            terminator === -1 ? css.slice(modifiersStart) : css.slice(modifiersStart, terminator);
        if (SOURCE_MODIFIER.test(modifiers)) return true;
    }
    return false;
}

/**
 * Whether a CSS module scopes Tailwind's content detection — `source(none)` or
 * `source("…")` on a `@import "tailwindcss"`, or any `@source not` exclusion.
 * A plain additive `@source "…"` does NOT count: it only adds a path, it does
 * not stop the automatic scan. Block comments are stripped first so a
 * commented-out directive does not count.
 *
 * @param code - CSS module source.
 * @returns true when the entry scopes (or excludes from) content detection.
 */
export function cssHasContentScope(code: string): boolean {
    const s = stripCssBlockComments(code);
    return tailwindImportScopesContent(s) || /@source\s+not\b/.test(s);
}

/**
 * Whether `root` is a package INSIDE a monorepo — an ancestor directory is a
 * workspace root (`pnpm-workspace.yaml`, a `package.json` with a `workspaces`
 * field, or an nx/lerna marker). In that case Tailwind v4 automatic content
 * detection would otherwise climb to the workspace root. Synchronous and cheap
 * (a handful of stat calls up the tree); intended to be memoized per build.
 * Mirrors `isInsideWorkspace` in the CLI's `init` command.
 *
 * @param root - the project/package root directory.
 * @returns true when an ancestor is a workspace root.
 */
export function isMonorepoPackage(root: string): boolean {
    let dir = path.dirname(path.resolve(root));
    const { root: fsRoot } = path.parse(dir);
    while (dir !== fsRoot) {
        if (
            fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
            fs.existsSync(path.join(dir, 'nx.json')) ||
            fs.existsSync(path.join(dir, 'lerna.json'))
        ) {
            return true;
        }
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                if ('workspaces' in (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as object)) {
                    return true;
                }
            } catch {
                // Malformed package.json — ignore and keep walking up.
            }
        }
        dir = path.dirname(dir);
    }
    return false;
}

/**
 * Whether to warn that Tailwind content detection is unscoped in a monorepo.
 * Fires only when a Tailwind entry exists, it is NOT scoped, and this package
 * sits inside a workspace — the exact condition that makes Tailwind scan the
 * whole repo and emit phantom/broken classes.
 *
 * @param sawTailwindEntry - whether any processed CSS imported tailwindcss.
 * @param tailwindEntryScoped - whether a Tailwind entry scoped its detection.
 * @param inMonorepo - whether this package sits inside a workspace.
 * @returns true when the unscoped-monorepo warning should fire.
 */
export function shouldWarnUnscopedMonorepo(
    sawTailwindEntry: boolean,
    tailwindEntryScoped: boolean,
    inMonorepo: boolean,
): boolean {
    return sawTailwindEntry && !tailwindEntryScoped && inMonorepo;
}

/**
 * Build the unscoped-monorepo warning message: what is wrong, why it matters,
 * the exact two-line fix, the guide link, and how to silence it.
 *
 * Describes the detection BASE rather than promising a climb to the workspace
 * root. Measured on a workspace package built through the Vite plugin, the scan
 * was rooted at the Vite root: files beside the entry were scanned, the sibling
 * package and the workspace root were not. Naming a worse failure than the one
 * that is happening is how an advisory gets discounted — a reader who checks
 * for phantom classes from sibling packages finds none and stops believing the
 * rest of the message.
 *
 * The suggested snippet carries no CSS comment on purpose. A block comment ends
 * at the first `*` followed by `/`, which any recursive glob contains, so
 * inviting the reader to annotate `@source` lines invites a stylesheet that
 * stops parsing where they documented it.
 *
 * @returns the warning string.
 */
export function unscopedMonorepoMessage(): string {
    return (
        '[csszyx] Tailwind content detection is UNSCOPED in a monorepo. Tailwind v4 ' +
        'scans every file under its detection base — .md/.mdx/.txt included — so a doc ' +
        'or fixture holding class-shaped strings becomes CSS, which can generate ' +
        'phantom or broken url() classes and fail the build. That base is as wide as ' +
        'the build makes it: a Vite build roots it at the Vite root, other setups at ' +
        'the workspace root. Scope it in your Tailwind CSS entry:\n' +
        '    @import "tailwindcss" source(none);\n' +
        '    @source ".";\n' +
        'That @source is your package, relative to the CSS file; csszyx auto-injects ' +
        'one for the classes it generates, so only your own templates need listing. ' +
        'Guide: https://csszyx.com/docs/monorepo-content-scope/\n' +
        'Silence (if a broad scan is intentional): csszyx({ contentScopeCheck: false }).'
    );
}

/**
 * Whether a diagnostic is an advisory one — the class a build may hold back.
 *
 * Spread warnings, budget bails and `missing-css` fallbacks all describe absent
 * output and print regardless. What is left says the runtime path was taken
 * where a compiled one was possible: real, worth acting on, and not a failure.
 *
 * @param message - One raw diagnostic line as an engine emitted it.
 * @returns True when the diagnostic is advisory rather than a build result.
 */
export function isAdvisoryDiagnostic(message: string): boolean {
    return !(
        message.includes('unresolvable sz spread') ||
        message.includes('AST budget exceeded') ||
        szFallbackConsequenceOf(message) === 'missing-css'
    );
}

/**
 * Build the one-line disclosure that the fallback list above is partial.
 *
 * Four of the five `sz`-site fallback kinds never print in a production build,
 * so a log can list the `szr` fallbacks it found and silently hold every
 * `sz={factory()}` beside them. A consumer counting affected sites from that
 * log counts a lower bound and has no way to know it — one reported a site
 * count that was short by half for exactly this reason, and only caught it by
 * reading sources instead.
 *
 * Suppression is the right default; implying zero is not. One line costs
 * nothing and keeps the difference visible.
 *
 * @param count - Advisory fallbacks the build declined to list.
 * @returns The disclosure, or null when nothing was held back.
 */
export function suppressedAdvisoryMessage(count: number): string | null {
    if (count <= 0) return null;
    // Count and noun interpolate together so the sentence after them is one
    // unbroken literal: the docs-sync gate matches verbatim runs, and a
    // placeholder in the middle splits the run it is trying to match.
    const held = count === 1 ? '1 advisory sz fallback' : `${count} advisory sz fallbacks`;
    return (
        `[csszyx] ${held} not listed above. At an sz prop a fallback is advisory — the ` +
        'runtime path works and the classes are collected — so a production build keeps the ' +
        'list short. A development build prints each one with its file and position.'
    );
}

/**
 * The `quiet` option, normalized.
 *
 * `'all'` is the blunt setting a plain `true` selects; `'nudges'` keeps every
 * report that the build produced less output than it was asked for.
 */
export type QuietMode = 'off' | 'nudges' | 'all';

/**
 * Normalize the authored `quiet` value. Idempotent, so a already-normalized
 * mode passes through unchanged.
 *
 * @param quiet - Authored option value, or an already-resolved mode.
 * @returns The mode the gates read.
 */
export function resolveQuietMode(quiet: boolean | 'nudges' | QuietMode | undefined): QuietMode {
    if (quiet === true || quiet === 'all') return 'all';
    if (quiet === 'nudges') return 'nudges';
    return 'off';
}

/**
 * Whether a csszyx build warning should be emitted.
 *
 * `devOnly` is already this plugin's marker for "usage nudge": it suppresses
 * the warning in a production build so it cannot noise a host app's output.
 * `'nudges'` mutes exactly that same set, which keeps one axis instead of
 * inventing a second classification for the same distinction. `true` mutes
 * everything. Pure so the gating policy is unit-tested without the
 * worker-based buildEnd wiring.
 *
 * @param quiet - Resolved quiet mode.
 * @param devOnly - This warning is a usage nudge.
 * @param isProduction - Whether this is a production build.
 * @returns true when the warning should be printed.
 */
export function shouldEmitWarning(
    quiet: QuietMode,
    devOnly: boolean,
    isProduction: boolean,
): boolean {
    // Normalized again despite the narrowed type: these gates are exported from
    // the package entry, and an untyped JavaScript caller passing `true` would
    // otherwise fall through to the `off` branch — quiet set, warnings still
    // printed. `resolveQuietMode` is idempotent, so this costs nothing.
    const mode = resolveQuietMode(quiet);
    if (mode === 'all') {
        return false;
    }
    if (devOnly && (isProduction || mode === 'nudges')) {
        return false;
    }
    return true;
}

/**
 * Whether a transform diagnostic describes missing CSS and may be printed.
 *
 * Only the blunt mode hides these. A missing-CSS diagnostic says classes never
 * reached the safelist, so the styles are absent from the output — a build
 * result, not a style opinion, and `'nudges'` exists so a calmer log does not
 * have to cost it.
 *
 * @param quiet - Resolved quiet mode.
 * @param message - Compiler diagnostic to classify.
 * @returns True when the diagnostic is an unsilenced missing-CSS failure.
 */
export function shouldEmitMissingCssFallback(quiet: QuietMode, message: string): boolean {
    return resolveQuietMode(quiet) !== 'all' && szFallbackConsequenceOf(message) === 'missing-css';
}

/**
 * Emit one missing-CSS fallback through the caller's output channel.
 *
 * @param quiet - Resolved quiet mode.
 * @param message - Compiler diagnostic to classify and emit.
 * @param id - Bundler module identifier included in the warning.
 * @param emit - Warning output channel.
 */
export function emitMissingCssFallback(
    quiet: QuietMode,
    message: string,
    id: string,
    emit: (message: string) => void,
): void {
    if (shouldEmitMissingCssFallback(quiet, message)) emit(`[csszyx] ${id}\n  ${message}`);
}

/**
 * Normalize a filesystem path / bundler id for prefix comparison: forward
 * slashes, and no trailing slash (so `dir` and `dir/` compare equal).
 *
 * @param p - A path or bundler id.
 * @returns The normalized path.
 */
function normalizeForMatch(p: string): string {
    const n = normalizePathSeparators(p);
    return n.length > 1 && n.endsWith('/') ? n.slice(0, -1) : n;
}

/**
 * Find the exclusive end of one JSX expression container.
 *
 * @param code Source code.
 * @param bodyStart Offset after the opening brace.
 * @returns Exclusive expression-body end offset.
 */
function findJsxExpressionEnd(code: string, bodyStart: number): number {
    return findBalancedCodeEnd(code, bodyStart);
}

/**
 * Warn that a prescan dropped a whole file after exceeding the AST node budget.
 *
 * @param filePath Source file the prescan skipped.
 */
function warnPrescanBudgetSkip(filePath: string): void {
    console.warn(
        `[csszyx] prescan skipped ${filePath}: the file exceeds the AST node budget, so ` +
            'NONE of its classes reached the safelist and their CSS will not be generated. ' +
            'Raise `build.astBudgetLimit` in the csszyx plugin options, or split the file.',
    );
}

/**
 * Resolve `compileSources` entries to absolute, realpath-resolved directories.
 * Each entry resolves like a Vite config path: relative to the project `root`
 * (`config.root`), absolute passes through. The result is realpath-resolved so a
 * pnpm-symlinked workspace package matches Vite's (realpath'd, since
 * `resolve.preserveSymlinks` defaults to false) module ids. Done ONCE at
 * config-resolved time; the per-module matcher then does pure prefix tests.
 *
 * @param root - the resolved project root (Vite `config.root` / build cwd).
 * @param sources - the configured `compileSources` paths (relative or absolute).
 * @param realpathDir - injectable resolver → realpath if it is an existing
 *   directory, else `null` (defaults to a real fs realpath + stat).
 * @returns `dirs` (existing, deduped, normalized) and `missing` (entries that did
 *   not resolve to a directory) for a build warning.
 */
export function resolveCompileSourceDirs(
    root: string,
    sources: readonly string[],
    realpathDir: (p: string) => string | null = p => {
        try {
            const real = fs.realpathSync(p);
            return fs.statSync(real).isDirectory() ? real : null;
        } catch {
            return null;
        }
    },
): { dirs: string[]; missing: string[] } {
    const dirs: string[] = [];
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const entry of sources) {
        const abs = path.resolve(root, entry);
        const real = realpathDir(abs);
        if (!real) {
            missing.push(entry);
            continue;
        }
        const key = normalizeForMatch(real);
        if (!seen.has(key)) {
            seen.add(key);
            dirs.push(key);
        }
    }
    return { dirs, missing };
}

/**
 * Whether `id` lives under one of the resolved `compileSources` directories.
 * Pure prefix match on normalized absolute paths — no fs (the fs work was done
 * once in {@link resolveCompileSourceDirs}).
 *
 * @param id - bundler file id or filesystem path.
 * @param sourceDirs - resolved, normalized `compileSources` directories.
 * @returns true when the file is in an opted-in source directory.
 */
export function isCompileSourceOptedIn(id: string, sourceDirs: readonly string[]): boolean {
    const p = normalizeForMatch(id);
    return sourceDirs.some(dir => p === dir || p.startsWith(`${dir}/`));
}

/**
 * Whether a file lives in a directory csszyx never transforms.
 *
 * An explicitly opted-in `compileSources` path wins over every default ignore —
 * the developer named the exact directory and takes responsibility for it. Then
 * `node_modules`, `.next` (non-static), and `/packages/` are ignored by default
 * (published libraries ship pre-extracted CSS). Pure so the precedence
 * (opt-in > the default ignores) is unit-tested.
 *
 * @param id - bundler file id or filesystem path.
 * @param sourceDirs - resolved, normalized `compileSources` directories.
 * @returns true when the file should be skipped regardless of user filters.
 */
export function isHardIgnoredPath(id: string, sourceDirs: readonly string[] = []): boolean {
    const p = normalizeForMatch(id);
    if (isCompileSourceOptedIn(p, sourceDirs)) {
        return false;
    }
    if (p.includes('node_modules')) {
        return true;
    }
    if (p.includes('.next') && !p.includes('static')) {
        return true;
    }
    if (p.includes('/packages/')) {
        return true;
    }
    return false;
}

/**
 * Whether a file's text may contain csszyx classes the prescan should extract
 * into the safelist. The prescan reads files instead of parsing every one, so it
 * needs a cheap text proxy for "worth transforming". A `sz=` / `sz:` prop is the
 * obvious case, but a `szv(...)` declaration ALSO produces safelistable classes
 * (the compiler extracts every variant from the config), and a layout component
 * built as a prop API resolves szv via `_sz(...)` with NO `sz=` in the file — so
 * gating on `sz` alone left those variants unsafelisted (silent dead classes).
 * `szv(` is a precise, csszyx-owned token, so including it costs at most an extra
 * file transform (the prescan is fail-open: when in doubt, scan).
 *
 * @param content - The source file text.
 * @returns true when the file should be prescanned for safelist extraction.
 */
export function fileMayContainSafelistableSz(content: string): boolean {
    return (
        content.includes('sz=') ||
        content.includes('szs=') ||
        content.includes('sz:') ||
        content.includes('szv(') ||
        content.includes('szr(') ||
        // dynamic() literal args are extracted for the safelist, but a module
        // containing ONLY dynamic() calls never passed this gate — the
        // engine-parity harness caught its classes missing on all engines.
        content.includes('dynamic(')
    );
}

/**
 * Return csszyx-owned classes that are safe to rename.
 *
 * @param ownedClasses Classes emitted from sz transforms.
 * @param authoredClasses Classes also written in class/className source positions.
 * @returns Owned classes with hybrid raw consumers removed.
 */
export function mangleEligibleClasses(
    ownedClasses: ReadonlySet<string>,
    authoredClasses: ReadonlySet<string>,
): string[] {
    return sortStrings([...ownedClasses].filter(className => !authoredClasses.has(className)));
}

/**
 * Allocate a short token per eligible class, skipping forbidden names.
 *
 * The forbidden set carries `mangleExclude`, every authored class, AND every
 * owned class name. Reserving the owned names keeps the map's key space and
 * token space disjoint, which is what lets a runtime consumer resolve a token
 * with one map lookup: a string that is a map key is always an original class,
 * never a token some other class was mangled to.
 *
 * @param eligibleClasses Classes to mangle, in stable sorted order.
 * @param forbiddenTokens Names the allocator must never emit as a token.
 * @returns The class → token map.
 */
/**
 * Token strings by encoder index. `encode` is a pure deterministic Base62
 * encoder behind the WASM boundary, and the boundary is ~95% of its cost
 * (~223ns/call measured vs ~ns of native work). The map finalizes several
 * times per build (buildEnd, each HTML page, output processing), re-encoding
 * the same indices each time — cache once, forever valid.
 */
const tokenByIndex: string[] = [];

/**
 * Deterministic token for one encoder index, crossing the WASM boundary at
 * most once per index per process.
 *
 * @param index Encoder sequence index.
 * @returns The Base62 token.
 */
function tokenAt(index: number): string {
    const cached = tokenByIndex[index];
    if (cached !== undefined) {
        return cached;
    }
    const fresh = encode(index);
    tokenByIndex[index] = fresh;
    return fresh;
}

/**
 * Allocate a short token per eligible class, skipping forbidden names.
 *
 * The forbidden set carries `mangleExclude`, every authored class, AND every
 * owned class name. Reserving the owned names keeps the map's key space and
 * token space disjoint, which is what lets a runtime consumer resolve a token
 * with one map lookup: a string that is a map key is always an original class,
 * never a token some other class was mangled to.
 *
 * @param eligibleClasses Classes to mangle, in stable sorted order.
 * @param forbiddenTokens Names the allocator must never emit as a token.
 * @returns The class → token map.
 */
export function allocateMangleTokens(
    eligibleClasses: readonly string[],
    forbiddenTokens: ReadonlySet<string>,
): Record<string, string> {
    const map: Record<string, string> = {};
    // `tokenIndex` advances independently of the class index whenever a token
    // is skipped, and never rewinds — total encoder calls stay linear in
    // census + skips even when the forbidden set blocks long runs.
    let tokenIndex = 0;
    for (const className of eligibleClasses) {
        let token = tokenAt(tokenIndex);
        while (forbiddenTokens.has(token)) {
            tokenIndex++;
            token = tokenAt(tokenIndex);
        }
        map[className] = token;
        tokenIndex++;
    }
    return map;
}

/**
 * Whether a file is workspace-package source that csszyx skipped only because it
 * lives under `/packages/` and is not under any opted-in `compileSources`
 * directory. Used to surface the silent no-op (skipped `sz` produces no CSS).
 * `node_modules` and `.next` are excluded — those are never workspace source the
 * developer authors, and scanning `node_modules` for `sz` would be slow and
 * false-positive-prone.
 *
 * @param id - filesystem path of the skipped file.
 * @param sourceDirs - resolved, normalized `compileSources` directories.
 * @returns true when the skip is a workspace-package `sz` skip worth warning on.
 */
export function isPackagesSkippedSource(id: string, sourceDirs: readonly string[] = []): boolean {
    const p = normalizeForMatch(id);
    if (p.includes('node_modules')) {
        return false;
    }
    if (p.includes('.next') && !p.includes('static')) {
        return false;
    }
    if (!p.includes('/packages/')) {
        return false;
    }
    return !isCompileSourceOptedIn(p, sourceDirs);
}

/**
 * Build the workspace-package skip warning. Lists the skipped files that use
 * csszyx so the developer can add the package directory to `compileSources`
 * instead of silently shipping no CSS for them.
 *
 * @param files - skipped `/packages/` file paths that use csszyx.
 * @param szvExportFiles - the subset that may export `szv` factories, whose
 *   skip also costs every importer its cross-module precompile.
 * @returns the warning string.
 */
export function skippedSzFilesMessage(
    files: readonly string[],
    szvExportFiles: readonly string[] = [],
): string {
    const list = files.map(file => `  - ${file}`).join('\n');
    const registryClause =
        szvExportFiles.length === 0
            ? ''
            : `\n${szvExportFiles.length} of them may export \`szv\` factories, so they stay ` +
              'out of the cross-module registry and every importer falls back to the ' +
              'runtime path.';
    return (
        `[csszyx] ${files.length} file(s) under packages/ use csszyx but were ` +
        `skipped by ignore rules:\n${list}\n` +
        'Add the package directory to `compileSources` (or move the file out of ' +
        'packages/) — otherwise their classes never reach the safelist.' +
        registryClause
    );
}

/**
 * Computes the `@source` target path for a CSS module: the location of the
 * generated safelist file relative to the CSS file, in posix form and always
 * `./`- or `../`-prefixed so Tailwind treats it as a relative path.
 *
 * This is the real-world failure surface — a wrong relative path makes Tailwind
 * silently scan nothing (no error, no CSS), the same symptom as a missing
 * directive — so it is extracted and unit-tested rather than left inline.
 *
 * @param rootDir - project root where the safelist file is written.
 * @param safelistFilename - the safelist file name (e.g. `csszyx-classes.html`).
 * @param cssId - absolute path of the CSS module receiving the directive.
 * @returns the posix relative path from the CSS file to the safelist file.
 */
export function computeSafelistRelPath(
    rootDir: string,
    safelistFilename: string,
    cssId: string,
): string {
    const safelistPath = normalizePathSeparators(path.join(rootDir, safelistFilename));
    const cssDir = normalizePathSeparators(path.dirname(cssId));
    let relPath = path.posix.relative(cssDir, safelistPath);
    if (!relPath.startsWith('.')) {
        relPath = `./${relPath}`;
    }
    return relPath;
}

/**
 * Reads CSS variable mangle metadata from compiler results. Older compiled
 * compiler artifacts and pre-v4 cache entries do not have this field, so the
 * unplugin treats it as empty instead of failing during dev/test transitions.
 *
 * @param result Compiler transform result.
 * @returns CSS variable mangle metadata.
 */
function cssVariableEntries(result: SourceTransformResult): Array<[string, string]> {
    const entries: Array<[string, string]> = [];
    for (const [original, value] of result.cssVariableMap ?? []) {
        if (Array.isArray(value)) {
            for (const mangled of value) {
                entries.push([original, mangled]);
            }
        } else {
            entries.push([original, value]);
        }
    }
    return entries;
}

/**
 * Records the complete CSS variable mangle output owned by one source file.
 *
 * Rebuilding the public map from per-file entries prevents stale mappings when
 * a dev-server transform reruns after a file changes or removes dynamic `sz`.
 *
 * @param state Plugin state to update.
 * @param filename Source filename that owns the entries.
 * @param entries Complete CSS variable entries emitted by this file.
 */
function recordFileVarMangleEntries(
    state: Pick<PluginState, 'varMangleEntriesByFile' | 'varMangleMap'>,
    filename: string,
    entries: Array<[string, string]>,
): void {
    const normalizedFilename = normalizeSourceFilename(filename);
    if (entries.length === 0) {
        state.varMangleEntriesByFile.delete(normalizedFilename);
    } else {
        state.varMangleEntriesByFile.set(normalizedFilename, entries);
    }
    state.varMangleMap = buildVarMangleMap(state.varMangleEntriesByFile);
}

/**
 * Whether transformed source text must be retained for global-var alias
 * validation. Retention is only consumed when `production.mangleGlobalVars`
 * is explicitly enabled; recording without that consumer keeps the full text
 * of every transformed JS/TS module alive for the plugin lifetime.
 *
 * @param config The `production.mangleGlobalVars` option value.
 * @param config.enabled Whether global-var mangling is turned on.
 * @returns True only when the feature is explicitly enabled.
 */
export function shouldTrackGlobalVarSources(config?: { enabled?: boolean }): boolean {
    return config?.enabled === true;
}

/**
 * Records source text available before bundling/minification for global-var
 * diagnostics.
 *
 * @param state Plugin state to update.
 * @param filename Source filename that owns the text.
 * @param code Source text, or null to clear this file.
 */
export function recordGlobalVarSourceFile(
    state: Pick<PluginState, 'globalVarSourceFilesByFile'>,
    filename: string,
    code: string | null,
): void {
    const normalizedFilename = normalizeSourceFilename(filename);
    if (!matchesScriptExtension(normalizedFilename, SCRIPT_ID_EXTENSIONS)) {
        return;
    }
    if (code === null) {
        state.globalVarSourceFilesByFile.delete(normalizedFilename);
    } else {
        state.globalVarSourceFilesByFile.set(normalizedFilename, code);
    }
}

/**
 * Builds stable source-file diagnostics input in filename order.
 *
 * @param state Plugin state to read.
 * @returns Source files for global-var validation.
 */
function buildGlobalVarSourceFiles(
    state: Pick<PluginState, 'globalVarSourceFilesByFile'>,
): GlobalVarCodeSource[] {
    return [...state.globalVarSourceFilesByFile.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([filePath, code]) => ({ filePath, code }));
}

/**
 *
 */
interface RollupBundleAssetLike {
    type: string;
    fileName?: string;
    source?: unknown;
}

/** Mutable output entry shape shared by Rollup and Vite's Rolldown adapter. */
interface ViteBundleEntryLike {
    type: string;
    fileName: string;
    source?: string | Uint8Array;
    code?: string;
}

/** Bundle surface used by the post-processing stages across Rollup engines. */
type ViteOutputBundleLike = Record<string, ViteBundleEntryLike>;

/**
 *
 */
interface WebpackAssetLike {
    source(): unknown;
}

/**
 * Extracts CSS assets from a Rollup/Vite output bundle for pure global-var
 * validation before output mutation.
 *
 * @param bundle Rollup output bundle.
 * @returns CSS assets in stable file-name order.
 */
function collectRollupGlobalVarCssAssets(
    bundle: Record<string, RollupBundleAssetLike>,
): GlobalVarCssAssetSource[] {
    return Object.values(bundle)
        .filter(
            (
                chunk,
            ): chunk is RollupBundleAssetLike & {
                fileName: string;
                source: string | Uint8Array;
            } =>
                chunk.type === 'asset' &&
                typeof chunk.fileName === 'string' &&
                /\.css(?:$|\?)/.test(chunk.fileName) &&
                (typeof chunk.source === 'string' || chunk.source instanceof Uint8Array),
        )
        .sort((left, right) => left.fileName.localeCompare(right.fileName))
        .map(asset => ({
            fileName: asset.fileName,
            source: asset.source,
        }));
}

/**
 * Reads configured source CSS files for global-variable validation.
 *
 * Some framework pipelines, notably Astro prerender builds, can invoke an
 * output hook before all user CSS is visible as a Rollup/Webpack asset. The
 * source CSS inventory keeps explicit-token validation tied to real files
 * while the later output rewrite still mutates only emitted assets.
 *
 * @param rootDir Project root used to resolve scan patterns.
 * @param scanCss User configured CSS scan patterns.
 * @returns CSS sources in stable file-name order.
 */
function collectConfiguredGlobalVarCssSources(
    rootDir: string,
    scanCss: string | string[] | undefined,
): GlobalVarCssAssetSource[] {
    if (!scanCss) {
        return [];
    }
    return expandFilePatterns(rootDir, scanCss)
        .filter(file => file.endsWith('.css'))
        .sort((left, right) => left.localeCompare(right))
        .flatMap(file => {
            try {
                const snapshot = readStableTextFileSnapshotSync(file);
                return [
                    {
                        fileName: file,
                        source: snapshot.source,
                        mtimeMs: snapshot.mtimeMs,
                    },
                ];
            } catch {
                return [];
            }
        });
}

/**
 * Extracts CSS assets from a Webpack asset map for pure global-var validation
 * before output mutation.
 *
 * @param assets Webpack compilation assets.
 * @returns CSS assets in stable file-name order.
 */
function collectWebpackGlobalVarCssAssets(
    assets: Record<string, WebpackAssetLike>,
): GlobalVarCssAssetSource[] {
    return Object.entries(assets)
        .flatMap(([fileName, asset]) => {
            if (!/\.css(?:$|\?)/.test(fileName)) {
                return [];
            }
            const source = asset.source();
            if (typeof source !== 'string' && !(source instanceof Uint8Array)) {
                return [];
            }
            return [{ fileName, source }];
        })
        .sort((left, right) => left.fileName.localeCompare(right.fileName))
        .map(({ fileName, source }) => ({ fileName, source }));
}

/**
 * Fails closed when the pure global-var validation pipeline reports unresolved
 * CSS planning diagnostics or out-of-band source usages.
 *
 * @param result Global-var validation result.
 */
function assertNoGlobalVarAliasValidationErrors(result: GlobalVarAliasValidationResult): void {
    const messages = [
        ...result.plan.diagnostics.map(diagnostic => {
            const location = diagnostic.location
                ? ` (${diagnostic.location.filePath}:${diagnostic.location.line}:${diagnostic.location.column})`
                : '';
            return `[${diagnostic.code}] ${diagnostic.name}${location}: ${diagnostic.message}`;
        }),
        ...result.usageDiagnostics.map(diagnostic => {
            const location = diagnostic.location;
            return `[${diagnostic.kind}] ${diagnostic.name} (${location.filePath}:${location.line}:${location.column}): ${diagnostic.message}`;
        }),
    ];

    if (messages.length > 0) {
        throw new Error(
            `[csszyx] production.mangleGlobalVars validation failed:\n${messages.join('\n')}`,
        );
    }
}

/**
 * Rewrites a CSS asset with the already validated global-var alias plan.
 *
 * @param css CSS asset source.
 * @param filePath CSS asset path for diagnostics.
 * @param result Validated global-var result for this output hook.
 * @returns Rewritten CSS, or the original source when no plan is active.
 */
function rewriteCssWithValidatedGlobalVarPlan(
    css: string,
    filePath: string,
    result: GlobalVarAliasValidationResult | null,
): string {
    if (result === null || result.plan.entries.length === 0) {
        return css;
    }
    const rewrite = rewriteGlobalVarCssAliases({
        css,
        plan: result.plan,
        filePath,
    });
    assertNoGlobalVarAliasValidationErrors({
        scans: result.scans,
        plan: {
            ...result.plan,
            diagnostics: rewrite.diagnostics,
        },
        usageDiagnostics: [],
    });
    return rewrite.css;
}

/**
 * Identifies PostCSS syntax failures that should leave third-party CSS untouched.
 *
 * @param error CSS mangler failure.
 * @returns True for a PostCSS syntax error.
 */
function isCssSyntaxError(error: unknown): boolean {
    return (
        !!error &&
        typeof error === 'object' &&
        'name' in error &&
        (error as { name: string }).name === 'CssSyntaxError'
    );
}

/**
 * Ensures the CSS-derived validation plan matches the early source-transform
 * alias table exactly.
 *
 * @param result Validated CSS/source result.
 * @param expectedEntries Early original-to-alias entries.
 */
function assertGlobalVarPlanMatchesEarlyAliases(
    result: GlobalVarAliasValidationResult,
    expectedEntries: ReadonlyArray<readonly [string, string]>,
): void {
    const actualEntries = [...result.plan.aliases.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
    );
    const expected = expectedEntries
        .map(([original, alias]) => [original, alias])
        .sort(([left], [right]) => left.localeCompare(right));
    const expectedJson = JSON.stringify(expected);
    const actualJson = JSON.stringify(actualEntries);
    if (expectedJson !== actualJson) {
        throw new Error(
            '[csszyx] production.mangleGlobalVars validation failed:\n' +
                `CSS alias plan ${actualJson} does not match source-transform alias table ${expectedJson}.`,
        );
    }
}

/**
 * Builds a stable one-to-many CSS variable mangle map from per-file ownership.
 *
 * @param entriesByFile Per-file CSS variable metadata.
 * @returns Public original-to-mangled map.
 */
function buildVarMangleMap(
    entriesByFile: ReadonlyMap<string, Array<[string, string]>>,
): Record<string, CssVariableMangleValue> {
    const next: Record<string, CssVariableMangleValue> = {};
    const files = sortStrings(entriesByFile.keys());
    for (const file of files) {
        for (const [original, mangled] of entriesByFile.get(file) ?? []) {
            addVarMangleMapping(next, original, mangled);
        }
    }
    return next;
}

/**
 * Extracts global custom-property aliases for manifest/debug tooling.
 *
 * The legacy `varMangleMap` also carries dynamic s/c-tier CSS variables. This
 * helper keeps manifest consumers from guessing tiers by exposing only aliases
 * that use the active generated prefix.
 *
 * @param varMangleMap CSS variable mangle metadata.
 * @param aliasPrefix Active generated alias prefix.
 * @param validationResult Validated CSS alias plan to include CSS-only aliases.
 * @returns Original global variable names mapped to their generated aliases.
 */
export function extractGlobalVarAliasesForManifest(
    varMangleMap: Record<string, CssVariableMangleValue>,
    aliasPrefix: string = CSSZYX_GLOBAL_ALIAS_PREFIX,
    validationResult: GlobalVarAliasValidationResult | null = null,
): Record<string, string> {
    const aliases: Record<string, string> = {};
    for (const [original, value] of Object.entries(varMangleMap).sort(([left], [right]) =>
        left.localeCompare(right),
    )) {
        const values = Array.isArray(value) ? value : [value];
        const alias = values.find(candidate => candidate.startsWith(aliasPrefix));
        if (alias) {
            aliases[original] = alias;
        }
    }
    for (const entry of validationResult?.plan.entries ?? []) {
        if (entry.alias.startsWith(aliasPrefix)) {
            aliases[entry.original] = entry.alias;
        }
    }
    return Object.fromEntries(
        Object.entries(aliases).sort(([left], [right]) => left.localeCompare(right)),
    );
}

/**
 * Serializes the standalone global-var map asset when g-tier aliases exist.
 *
 * @param varMangleMap CSS variable mangle metadata.
 * @param aliasPrefix Active generated alias prefix.
 * @param validationResult Validated CSS alias plan to include CSS-only aliases.
 * @returns JSON asset contents, or null when there are no global aliases.
 */
export function createGlobalVarMapAssetSource(
    varMangleMap: Record<string, CssVariableMangleValue>,
    aliasPrefix: string = CSSZYX_GLOBAL_ALIAS_PREFIX,
    validationResult: GlobalVarAliasValidationResult | null = null,
): string | null {
    const aliases = extractGlobalVarAliasesForManifest(varMangleMap, aliasPrefix, validationResult);
    return Object.keys(aliases).length > 0 ? JSON.stringify(aliases) : null;
}

/**
 * Normalizes compiler global-var aliases for transform-cache identity.
 *
 * @param aliases Compiler option value.
 * @returns Stable original-to-alias entries.
 */
export function normalizeGlobalVarAliasesForCache(
    aliases: TransformSourceCodeOptions['globalVarAliases'],
): Array<[string, string]> {
    if (!aliases) {
        return [];
    }
    let entries: Iterable<[string, string]>;
    if (aliases instanceof Map) entries = aliases.entries();
    else if (Array.isArray(aliases)) entries = aliases;
    else entries = Object.entries(aliases);
    const normalized = new Map<string, string>();
    for (const [original, alias] of entries) {
        if (original.startsWith('--') && alias.startsWith('--')) {
            normalized.set(original, alias);
        }
    }
    return [...normalized].sort(([left], [right]) => left.localeCompare(right));
}

/**
 * Builds the early alias table used by source transforms before CSS assets
 * exist. Only explicit tokens are safe here; prefix discovery still requires
 * CSS scanning in the output hook.
 *
 * @param config User global-var mangle config.
 * @param aliasPrefix Active generated alias prefix.
 * @returns Deterministic original-to-alias entries.
 */
function createEarlyGlobalVarAliasEntries(
    config: GlobalVarMangleConfig | undefined,
    aliasPrefix: string,
): Array<[string, string]> {
    if (config?.enabled !== true || !config.tokens || config.tokens.length === 0) {
        return [];
    }
    const tokens = sortStrings(new Set(config.tokens));
    return tokens.map((original, index) => [original, `${aliasPrefix}${encode(index)}`]);
}

/**
 * Checks whether csszyx should emit the standalone global-var map asset.
 *
 * `csszyx-manifest.json` still carries `globalVarAliases`; this controls only
 * the dedicated `.csszyx/global-var-map.json` tooling file.
 *
 * @param config User global-var mangle config.
 * @returns true when the standalone map should be emitted.
 */
function shouldEmitGlobalVarMapAsset(config: GlobalVarMangleConfig | undefined): boolean {
    return config?.emitMap !== false;
}

/**
 * Validates the CSS variable mangle map before it is emitted into HTML/assets.
 *
 * @param varMangleMap CSS variable mangle map.
 * @param maxBytes Maximum serialized UTF-8 bytes.
 */
function assertVarMangleMapSize(
    varMangleMap: Record<string, CssVariableMangleValue>,
    maxBytes: number,
): void {
    const size = Buffer.byteLength(JSON.stringify(varMangleMap), 'utf8');
    if (size <= maxBytes) {
        return;
    }
    throw new Error(
        `[csszyx] CSS variable mangle map is ${size} bytes, which exceeds the ` +
            `${maxBytes} byte safety cap. Reduce production.mangleVars usage, split the bundle, ` +
            'or raise CSSZYX_VAR_MANGLE_MAP_MAX_BYTES if this payload size is intentional.',
    );
}

/**
 * Reads the CSS variable mangle-map size cap from the environment.
 *
 * @returns Maximum serialized var-map bytes.
 */
function resolveVarMangleMapMaxBytes(): number {
    const raw = process.env.CSSZYX_VAR_MANGLE_MAP_MAX_BYTES;
    if (!raw) {
        return DEFAULT_VAR_MANGLE_MAP_MAX_BYTES;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_VAR_MANGLE_MAP_MAX_BYTES;
}

/**
 * Adds one CSS variable mapping to a metadata map.
 *
 * @param map Plugin metadata map to update.
 * @param original Original generated CSS custom-property name.
 * @param mangled Scoped or hoisted custom-property name.
 */
function addVarMangleMapping(
    map: Record<string, CssVariableMangleValue>,
    original: string,
    mangled: string,
): void {
    const existing = map[original];
    if (!existing) {
        map[original] = mangled;
        return;
    }
    const values = Array.isArray(existing) ? existing : [existing];
    if (!values.includes(mangled)) {
        map[original] = [...values, mangled];
    }
}

/**
 * Empty CSS variable metric counters.
 *
 * @returns Zeroed CSS variable metrics.
 */
function emptyCSSVariableMetrics(): CSSVariableMetrics {
    return {
        componentClassUses: 0,
        componentStyleDeclarations: 0,
        estimatedHoistedDeclarationsSaved: 0,
        scopedClassUses: 0,
        scopedStyleDeclarations: 0,
    };
}

/**
 * Records CSS variable hoisting metrics owned by one source file.
 *
 * @param state Plugin state to update.
 * @param filename Source filename that owns the metrics.
 * @param code Transformed source code, or null to clear this file.
 */
function recordFileCSSVariableMetrics(
    state: Pick<PluginState, 'cssVarMetricsByFile' | 'cssVarMetrics'>,
    filename: string,
    code: string | null,
): void {
    const normalizedFilename = normalizeSourceFilename(filename);
    if (!code) {
        state.cssVarMetricsByFile.delete(normalizedFilename);
    } else {
        const metrics = collectCSSVariableMetrics(code);
        if (hasCSSVariableMetrics(metrics)) {
            state.cssVarMetricsByFile.set(normalizedFilename, metrics);
        } else {
            state.cssVarMetricsByFile.delete(normalizedFilename);
        }
    }
    state.cssVarMetrics = buildCSSVariableMetrics(state.cssVarMetricsByFile);
}

/**
 * Collects CSS variable hoisting metrics from one transformed module.
 *
 * @param code Transformed source code.
 * @returns Metrics for component/scoped tier class uses and style declarations.
 */
function collectCSSVariableMetrics(code: string): CSSVariableMetrics {
    const componentUses = new Map<string, number>();
    const componentDeclarations = new Map<string, number>();
    const metrics = emptyCSSVariableMetrics();

    for (const match of code.matchAll(/\(--([cs][A-Za-z0-9]+)\)/g)) {
        const name = `--${match[1]}`;
        if (name.startsWith('--c')) {
            metrics.componentClassUses++;
            incrementCount(componentUses, name);
        } else {
            metrics.scopedClassUses++;
        }
    }
    for (const match of code.matchAll(/["'](--([cs][A-Za-z0-9]+))["']\s*:/g)) {
        const name = match[1];
        if (name.startsWith('--c')) {
            metrics.componentStyleDeclarations++;
            incrementCount(componentDeclarations, name);
        } else {
            metrics.scopedStyleDeclarations++;
        }
    }
    for (const [name, uses] of componentUses) {
        const declarations = componentDeclarations.get(name) ?? 0;
        metrics.estimatedHoistedDeclarationsSaved += Math.max(0, uses - declarations);
    }
    return metrics;
}

/**
 * Aggregates CSS variable metrics in stable filename order.
 *
 * @param metricsByFile Per-file metrics.
 * @returns Aggregated metrics.
 */
function buildCSSVariableMetrics(
    metricsByFile: ReadonlyMap<string, CSSVariableMetrics>,
): CSSVariableMetrics {
    const total = emptyCSSVariableMetrics();
    for (const file of sortStrings(metricsByFile.keys())) {
        const metrics = metricsByFile.get(file);
        if (!metrics) {
            continue;
        }
        total.componentClassUses += metrics.componentClassUses;
        total.componentStyleDeclarations += metrics.componentStyleDeclarations;
        total.estimatedHoistedDeclarationsSaved += metrics.estimatedHoistedDeclarationsSaved;
        total.scopedClassUses += metrics.scopedClassUses;
        total.scopedStyleDeclarations += metrics.scopedStyleDeclarations;
    }
    return total;
}

/**
 * Checks whether any CSS variable metrics were collected.
 *
 * @param metrics Metrics to inspect.
 * @returns True when at least one counter is non-zero.
 */
function hasCSSVariableMetrics(metrics: CSSVariableMetrics): boolean {
    return Object.values(metrics).some(value => value > 0);
}

/**
 * Increments one counter in a map.
 *
 * @param map Counter map.
 * @param key Counter key.
 */
function incrementCount(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Emits opt-in benchmark timing logs for local profiling harnesses.
 *
 * @param label Timing label.
 * @param filename Source filename.
 * @param elapsedMs Elapsed milliseconds.
 */
function traceBenchTiming(label: string, filename: string, elapsedMs: number): void {
    if (!BENCH_TRACE_ENABLED) {
        return;
    }
    if (BENCH_TRACE_FILE && !filename.includes(BENCH_TRACE_FILE)) {
        return;
    }
    console.log(
        `[csszyx:bench] ${label} ${elapsedMs.toFixed(3)}ms ${normalizeSourceFilename(filename)}`,
    );
}

/**
 * Scans CSS files for Tailwind v4 @theme blocks and writes .csszyx/theme.d.ts.
 * Called once at startup and again on HMR when a watched CSS file changes.
 * No-ops silently if scanCss is not configured or if files can't be read.
 * @param rootDir - project root directory (used to resolve relative paths and output dir)
 * @param scanCss - path or glob patterns to CSS files (from BuildConfig.scanCss)
 * @returns the merged parsed theme (feeds the szcn theme-groups virtual
 *   module), or null when nothing was scanned.
 */
function runThemeScan(rootDir: string, scanCss: string | string[] | undefined): ParsedTheme | null {
    if (!scanCss) {
        return null;
    }
    const sourceFiles = expandFilePatterns(rootDir, scanCss).filter(file => file.endsWith('.css'));
    if (sourceFiles.length === 0) {
        return null;
    }
    const themes = sourceFiles
        .map(f => {
            try {
                return parseThemeBlocks(readStableTextFileSnapshotSync(f).source);
            } catch {
                return null;
            }
        })
        .filter((t): t is NonNullable<typeof t> => t !== null);
    const merged = mergeThemes(themes);
    const outputPath = path.join(rootDir, '.csszyx', 'theme.d.ts');
    writeThemeDts({ outputPath, theme: merged, sourceFiles });

    // Smart Warning: Check if TypeScript knows about the generated theme file
    if (!_hasWarnedTsConfig) {
        _hasWarnedTsConfig = true;
        try {
            const checkFile = (cfgPath: string): boolean => {
                let content: string;
                try {
                    content = fs.readFileSync(cfgPath, 'utf-8');
                } catch (err) {
                    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
                        return false;
                    }
                    throw err;
                }
                if (!content.includes('.csszyx')) {
                    console.warn(
                        '\n\x1b[33m⚠️ CSSzyx: Theme Auto-Scan enabled, but TypeScript isn\'t configured. Run "npx @csszyx/cli init" to fix.\x1b[0m\n',
                    );
                }
                return true;
            };

            // Try standard Next.js / tsc config first
            if (!checkFile(path.join(rootDir, 'tsconfig.json'))) {
                // Fallback to Vite/Vue app config
                checkFile(path.join(rootDir, 'tsconfig.app.json'));
            }
        } catch {
            // Ignore file read errors
        }
    }
    return merged;
}

/**
 * Resolve a package entry and read the nearest package.json version.
 *
 * @param specifier Package specifier to resolve.
 * @param fallback Version used when package metadata is unavailable.
 * @returns Package version string.
 */
function findPackageVersionFromModule(specifier: string, fallback: string): string {
    try {
        return findPackageVersionFromFile(requireFromHere.resolve(specifier), fallback);
    } catch {
        return fallback;
    }
}

/**
 * Walk upward from a file until a package.json version is found.
 *
 * @param file File path inside a package.
 * @param fallback Version used when no package.json can be read.
 * @returns Package version string.
 */
function findPackageVersionFromFile(file: string, fallback: string): string {
    let dir = path.dirname(file);
    while (true) {
        const packageJson = path.join(dir, 'package.json');
        try {
            const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8')) as {
                version?: unknown;
            };
            if (typeof parsed.version === 'string') {
                return parsed.version;
            }
            return fallback;
        } catch {
            // Keep walking up until the filesystem root.
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return fallback;
        }
        dir = parent;
    }
}

/**
 * Normalizes source filenames before compiler calls and cache-key derivation.
 * Recovery tokens include the filename in their hash input, so cache identity
 * and compiler token generation must see the same path spelling.
 *
 * @param filename Source filename from the bundler.
 * @returns Filename with POSIX separators.
 */
function normalizeSourceFilename(filename: string): string {
    return normalizePathSeparators(filename);
}

/** TS/JS extensions accepted by the plain script-id gates. */
const SCRIPT_ID_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

/** Script extensions accepted by the transform gate, incl. module flavours. */
const SOURCE_MODULE_EXTENSIONS = [...SCRIPT_ID_EXTENSIONS, '.cts', '.mts', '.cjs', '.mjs'] as const;

/**
 * Whether a bundler id names a script file: an extension at the end of the id,
 * or an extension immediately followed by a `?` query (Vite-style resource
 * queries, including vue-SFC sub-request ids ending in `&lang.ts`).
 *
 * Exactly equivalent to the previous `/\.ext(\?.*)?$/`-shaped regexes, but in
 * two linear string scans — the regex form backtracked polynomially on
 * adversarial ids built from repeated `.js?` segments (CodeQL
 * js/polynomial-redos), and ids reach this check from outside the plugin.
 *
 * @param id Bundler module id (possibly carrying a query).
 * @param extensions Extensions to accept.
 * @returns True when the id names a script file with one of the extensions.
 */
function matchesScriptExtension(id: string, extensions: readonly string[]): boolean {
    return extensions.some(ext => id.endsWith(ext) || id.includes(`${ext}?`));
}

/**
 * Inserts a runtime import after a top-level client/server directive, preserving
 * leading comments and blank lines. Keeping `'use server'` before generated
 * imports is required for the RSC boundary guard to classify the module
 * correctly.
 *
 * @param code transformed module code
 * @param importStmt import statement to insert
 * @returns code with the import inserted
 */
function insertRuntimeImport(code: string, importStmt: string): string {
    return insertAfterUseDirective(code, importStmt);
}

/**
 * Scan a class-value expression until its first depth-zero terminator.
 *
 * @param source Code being scanned.
 * @param from Index of the first expression character.
 * @returns Index one past the last expression character.
 */
function scanClassExpression(source: string, from: number): number {
    let depth = 0;
    let index = from;
    while (index < source.length) {
        const char = source[index];
        if (char === '(' || char === '[') {
            depth++;
        } else if (char === ')' || char === ']') {
            if (depth === 0) {
                break;
            }
            depth--;
        } else if (depth === 0 && (char === ',' || char === ';' || char === '\n' || char === '}')) {
            break;
        }
        index++;
    }
    return index;
}

/**
 * Finds the offset after a balanced template interpolation.
 *
 * @param templateContent Template contents without backticks.
 * @param bodyStart Offset after the opening interpolation delimiter.
 * @returns Offset after the closing brace, or content length when unterminated.
 */
function findTemplateInterpolationEnd(templateContent: string, bodyStart: number): number {
    let depth = 0;
    for (let cursor = bodyStart; cursor < templateContent.length; cursor++) {
        if (templateContent[cursor] === '{') depth++;
        else if (templateContent[cursor] === '}' && depth-- === 0) return cursor + 1;
    }
    return templateContent.length;
}

/**
 * Mangles class strings in bundled code (JS/HTML assets) using the given mangle map.
 *
 * Exported for unit testing; the plugin calls this via the thin private wrapper that
 * supplies state.mangleMap.
 *
 * Pass 1:   Direct `className="..."` / `class="..."` static strings
 * Pass 1.5: Template literal quasi (static) segments in `className:\`...\``
 * Pass 2:   `className:EXPR` patterns with ternary operators containing quoted strings
 * Pass 3:   Quoted string arguments to csszyx runtime helpers (_szMerge, _sz, etc.)
 *
 * @param code     bundled source code
 * @param mangleMap class-name → mangled-token mapping
 * @returns code with mangled class names
 */
export function mangleCodeClassesSync(code: string, mangleMap: Record<string, string>): string {
    /**
     * Replaces each space-separated token in a class string with its mangled form.
     * @param classString - space-separated CSS class names
     * @returns mangled class string (unknown classes left unchanged)
     */
    function mangleClassString(classString: string): string {
        return classString
            .split(/\s+/)
            .filter(Boolean)
            .map((cls: string) => {
                // Class names inside a double-quoted JS string may have \" (and other
                // sequences) escaped. Unescape before map lookup so that e.g.
                // before:content-['\"\"'] resolves to its mangle map entry, which is
                // keyed by the actual class name before:content-['""'].
                // If not in the map, return the original (escaped) token unchanged.
                return mangleMap[cls.replace(/\\(.)/g, '$1')] || cls;
            })
            .join(' ');
    }

    /**
     * Mangles static quasis and quoted branches in one className template.
     *
     * @param fullMatch Complete className property match.
     * @param templateContent Template contents without backticks.
     * @returns Mangled property or the original match when unchanged.
     */
    function mangleClassTemplate(fullMatch: string, templateContent: string): string {
        let changed = false;
        let output = '';
        let cursor = 0;
        while (cursor < templateContent.length) {
            const interpolationStart = templateContent.indexOf('${', cursor);
            const quasiEnd =
                interpolationStart === -1 ? templateContent.length : interpolationStart;
            const quasi = mangleTemplateQuasi(templateContent.slice(cursor, quasiEnd));
            output += quasi.value;
            changed ||= quasi.changed;
            if (interpolationStart === -1) break;

            const interpolationEnd = findTemplateInterpolationEnd(
                templateContent,
                interpolationStart + 2,
            );
            const inner = templateContent.slice(interpolationStart + 2, interpolationEnd - 1);
            const interpolation = mangleTemplateInterpolation(inner);
            output += `\${${interpolation.value}}`;
            changed ||= interpolation.changed;
            cursor = interpolationEnd;
        }
        return changed ? `className:\`${output}\`` : fullMatch;
    }

    /** Mangled text fragment and whether a replacement occurred. */
    interface MangledTemplateFragment {
        value: string;
        changed: boolean;
    }

    /**
     * Mangles the non-whitespace content of one template quasi.
     *
     * @param quasi Static template fragment.
     * @returns Mangled fragment and change marker.
     */
    function mangleTemplateQuasi(quasi: string): MangledTemplateFragment {
        const trimmed = quasi.trim();
        if (!trimmed) return { value: quasi, changed: false };
        const mangled = mangleClassString(trimmed);
        return {
            value: mangled === trimmed ? quasi : quasi.replace(trimmed, mangled),
            changed: mangled !== trimmed,
        };
    }

    /**
     * Mangles double-quoted class strings within an interpolation.
     *
     * @param inner Interpolation body.
     * @returns Mangled body and change marker.
     */
    function mangleTemplateInterpolation(inner: string): MangledTemplateFragment {
        let changed = false;
        const value = inner.replace(/"([^"]*)"/g, (quoted: string, classString: string) => {
            const parts = classString.split(/\s+/).filter(Boolean);
            if (parts.length === 0) return quoted;
            const mangled = parts.map(className => mangleMap[className] || className).join(' ');
            if (mangled === classString) return quoted;
            changed = true;
            return `"${mangled}"`;
        });
        return { value, changed };
    }

    // Pass 1: Direct className="..." / class="..." / className:"..."
    // Use separate patterns for double-quoted and single-quoted strings so that
    // class names containing single quotes (e.g. before:content-['']) are mangled
    // correctly from double-quoted strings, and vice versa.
    // (?:[^"\\]|\\.)*  — proper JS string literal matcher: accepts any char except
    // `"` and `\`, OR a backslash followed by any char (handles \" \\  \n etc.).
    // Naive [^"]* broke on class names with embedded escaped quotes such as
    // before:content-['""'] which the pre-plugin emits as "before:content-['\"\"']".
    let result = code
        .replace(/(?:class(?:Name)?|sz)[:=]\s*"((?:[^"\\]|\\.)*)"/g, (match, classes) => {
            const mangled = mangleClassString(classes);
            if (mangled === classes) {
                return match;
            }
            return match.replace(classes, mangled);
        })
        .replace(/(?:class(?:Name)?|sz)[:=]\s*'((?:[^'\\]|\\.)*)'/g, (match, classes) => {
            const mangled = mangleClassString(classes);
            if (mangled === classes) {
                return match;
            }
            return match.replace(classes, mangled);
        });

    // Pass 1.5: Template literal quasi (static) segments in className:`...`
    // Generated by the pre-plugin for sz objects with ternary property values, e.g.:
    //   sz={{ display: 'flex', flexDir: isRow ? 'row' : 'col' }}
    //   → className={`flex items-center ${isRow ? "flex-row" : "flex-col"}`}
    // In minified client bundles:    className:`flex items-center ${isRow?"flex-row":"flex-col"}`
    // In unminified SSR bundles:     className: `flex items-center ${isRow?"flex-row":"flex-col"}`
    // The \s* allows the optional space after the colon that appears in unminified SSR output.
    // Pass 1 skips template literals (only targets "..." strings).
    // Pass 2 mangles the quoted parts of the ternary but leaves the quasi text unmangled.
    result = result.replace(/className:\s*`([^`]+)`/g, mangleClassTemplate);

    // Pass 2: className:EXPR with ternary operators containing quoted strings.
    // Handles all forms produced by the compiler:
    //   - Simple ternary:          className:cond?"class-a":"class-b"
    //   - Ternary in call arg:     className:r(cond?"class-a":"class-b")
    //   - Leading static + ternary:className:r("static",cond?"class-a":"class-b")
    //   - Multi-arg combos:        className:r("z",pe&&"p-4",cond?"rounded-xl":"scale-75")
    //
    // Uses character-level balanced-paren scanning to extract the full expression so
    // that commas inside nested call args do NOT prematurely stop extraction (the old
    // regex `[^,;}\])\n]+` stopped at the first `,`, missing ternaries after a leading
    // static argument).
    //
    // Skip `className:"..."`, `className:'...'`, `className:\`...\`` — Pass 1/1.5
    // handle those; re-mangling would corrupt already-mangled tokens.

    /**
     * Mangles every double-quoted class string inside a ternary expression.
     * @param expr - expression known to sit in a class-attribute position
     * @returns mangled expression, or null when nothing changed
     */
    function mangleTernaryClassStrings(expr: string): string | null {
        // Only process if there is a ternary operator — otherwise leave untouched
        // (e.g. className:someVar has no quoted strings to mangle anyway).
        const qIdx = expr.indexOf('?');
        if (qIdx === -1 || !expr.slice(qIdx).includes(':')) {
            return null;
        }
        let changed = false;
        const mangled = expr.replace(/"([^"]*)"/g, (qm: string, inner: string) => {
            const parts = inner.split(/\s+/).filter(Boolean);
            if (parts.length === 0) {
                return qm;
            }
            const mangledStr = parts.map((p: string) => mangleMap[p] || p).join(' ');
            if (mangledStr !== inner) {
                changed = true;
                return `"${mangledStr}"`;
            }
            return qm;
        });
        return changed ? mangled : null;
    }

    {
        const marker = 'className:';
        let searchFrom = 0;
        let out = '';
        while (searchFrom < result.length) {
            const idx = result.indexOf(marker, searchFrom);
            if (idx === -1) {
                out += result.slice(searchFrom);
                break;
            }
            out += result.slice(searchFrom, idx + marker.length);
            const afterColon = idx + marker.length;
            // Skip optional space (unminified SSR form: "className: `...")
            let exprStart = afterColon;
            while (exprStart < result.length && result[exprStart] === ' ') {
                exprStart++;
            }
            const firstChar = result[exprStart];
            // Static string or template literal → Pass 1/1.5 territory, leave untouched
            if (firstChar === '"' || firstChar === "'" || firstChar === '`') {
                searchFrom = afterColon;
                continue;
            }
            const j = scanClassExpression(result, afterColon);
            const expr = result.slice(afterColon, j);
            out += mangleTernaryClassStrings(expr) ?? expr;
            searchFrom = j;
        }
        result = out;
    }

    // Pass 2.5: class values passed as the argument AFTER a quoted "class" /
    // "className" attribute-name string. Produced by SolidJS compilation of
    // dynamic class expressions, on both lanes:
    //   SSR:    ssrAttribute("class", cond?"class-a":"class-b", false)
    //   client: l(el, "className", cond?"class-a":"class-b")
    // Pass 1/2 miss these because the attribute name is itself a string
    // literal (`"class",`), not a `class=`/`className:` prefix. The marker
    // requires the trailing comma so quoted object KEYS (`"className": x`)
    // never match, and the ternary requirement plus class-position context
    // keep rewrites scoped exactly like Pass 2.
    {
        const markerRe = /"class(?:Name)?"\s*,\s*/g;
        let out = '';
        let copiedTo = 0;
        let m: RegExpExecArray | null = markerRe.exec(result);
        while (m !== null) {
            const exprStart = m.index + m[0].length;
            const firstChar = result[exprStart];
            // Static string → not a ternary; Pass 3's argument heuristic owns it.
            if (firstChar === '"' || firstChar === "'" || firstChar === '`') {
                m = markerRe.exec(result);
                continue;
            }
            const j = scanClassExpression(result, exprStart);
            const expr = result.slice(exprStart, j);
            const mangled = mangleTernaryClassStrings(expr);
            if (mangled !== null) {
                out += result.slice(copiedTo, exprStart) + mangled;
                copiedTo = j;
            }
            markerRe.lastIndex = j;
            m = markerRe.exec(result);
        }
        if (copiedTo > 0) {
            result = out + result.slice(copiedTo);
        }
    }

    // Pass 3: Mangle quoted string arguments to csszyx runtime helpers (_szMerge, _sz, etc.)
    // that did NOT get a className= prefix in Pass 1. These are compiled class strings
    // produced by the sz array/conditional compiler path — e.g. the static arg in:
    //   _szMerge("demo-preview", "p-8 flex gap-6...", { bg })
    // Safe heuristic: only replace a string if ALL its space-separated tokens are in
    // the mangle map. Mangled tokens (e.g. "J", "h") are NOT keys in the map, so
    // already-mangled strings from Pass 1/2 are never double-mangled.
    //
    // Lookbehind (?<=[,(]\s*) ensures we only match strings preceded by a comma or
    // open-paren (i.e., function arguments), allowing optional whitespace between
    // the separator and the opening quote. Without this guard, the naive /"([^"]+)"/g
    // regex matches "garbage" between the close-quote of one string and the open-quote
    // of the next (e.g. `","` in `"demo-preview","p-8 flex..."`), consuming the opening
    // quote of the target string so it is never matched.
    // The \s* is required because SSR bundles are NOT minified — spaces appear after
    // commas and operators (e.g. `_szMerge(x, "p-8 flex...")`, `pe && "text-right"`).
    // The lookbehind also covers && so that conditional array elements compiled by the
    // sz-array path (condition && "class-string") are mangled correctly.
    // The separator (`,`/`(`/`&&`) and any whitespace are consumed and re-emitted
    // rather than matched in a variable-length `(?<=…\s*)` lookbehind, which is
    // quadratic (the engine retries the `\s*` length at every position). Consuming
    // them keeps the scan linear and re-prepends them unchanged.
    result = result.replace(/([,(]|&&)(\s*)"([^"]+)"/g, (match, sep, ws, inner) => {
        const tokens = inner.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) {
            return match;
        }
        let changed = false;
        const mangled: string[] = [];
        for (const t of tokens) {
            const m = mangleMap[t];
            if (m === undefined) {
                return match;
            } // any unknown token → skip whole string
            if (m !== t) {
                changed = true;
            }
            mangled.push(m);
        }
        if (!changed) {
            return match;
        }
        return `${sep}${ws}"${mangled.join(' ')}"`;
    });

    // Pass 4: compiled szs slot maps. The compiler replaces `szs={{...}}` with
    // `szsc={{ header: "bg-gray-100" }}`, which bundles to
    // `szsc: { header: "bg-gray-100", ... }` (a flat map of class strings) —
    // none of the passes above match it: the values sit after a `:`, not a
    // className= prefix or a helper-argument separator. The `szsc:` key makes
    // the context unambiguous, so each quoted value is mangled per-token like
    // Pass 1 (known classes swapped, unknown left, already-mangled tokens are
    // not map keys so double-mangling cannot happen).
    result = result.replace(/\bszsc:\s*\{([^{}]*)\}/g, (whole: string, body: string) => {
        const mangledBody = mangleQuotedStringLiterals(body, mangleClassString);
        return whole.replace(body, mangledBody);
    });

    return result;
}

/**
 * Mangle the inner text of every `"…"` / `'…'` string literal in `body`,
 * leaving everything else verbatim. Linear single forward pass replacing the
 * two `/("|')((?:[^\1\\]|\\.)*)\1/g` replaces — those "unrolled" string regexes
 * are linear WITHIN a match but quadratic ACROSS search positions (the `/g`
 * scan retries from every quote when a literal is unterminated), which a ReDoS
 * checker flags. A backslash escapes the next character inside a literal, as in
 * the `\\.` alternative it replaces.
 *
 * @param body - The `szs` map body (already brace-bounded by the caller).
 * @param mangle - Per-literal transform applied to each string's inner text.
 * @returns `body` with every literal's inner text mangled.
 */
function mangleQuotedStringLiterals(body: string, mangle: (inner: string) => string): string {
    let out = '';
    let i = 0;
    while (i < body.length) {
        const quote = body[i];
        if (quote !== '"' && quote !== "'") {
            out += quote;
            i++;
            continue;
        }
        let inner = '';
        let j = i + 1;
        let closed = false;
        while (j < body.length) {
            const ch = body[j];
            if (ch === '\\') {
                // Escape: consume the backslash and the character it escapes.
                inner += ch + (body[j + 1] ?? '');
                j += 2;
                continue;
            }
            if (ch === quote) {
                closed = true;
                break;
            }
            inner += ch;
            j++;
        }
        if (!closed) {
            // Unterminated — the regex would not have matched here; emit the
            // opening quote and resume scanning after it.
            out += quote;
            i++;
            continue;
        }
        out += `${quote}${mangle(inner)}${quote}`;
        i = j + 1;
    }
    return out;
}

/**
 * Validates the planned global-variable alias config before plugin
 * state is created.
 *
 * @param options User plugin options.
 */
function assertGlobalVarMangleConfig(options: PartialCsszyxConfig): void {
    const config = options.production?.mangleGlobalVars;
    const errors = validateGlobalVarMangleConfig(config);
    if (errors.length > 0) {
        throw new Error(
            `[csszyx] Invalid production.mangleGlobalVars config:\n${errors.join('\n')}`,
        );
    }
    if (config?.enabled === true) {
        if (!config.tokens || config.tokens.length === 0) {
            throw new Error(
                '[csszyx] production.mangleGlobalVars.enabled requires explicit tokens. Aliasing ' +
                    'a property csszyx was not told about would rename references it cannot see.',
            );
        }
        if (config.autoPrefix !== undefined && config.autoPrefix !== '') {
            throw new Error(
                '[csszyx] production.mangleGlobalVars.autoPrefix is not available: choosing tokens ' +
                    'by prefix needs a CSS pre-scan that does not exist yet. List the tokens instead.',
            );
        }
    }
}

/**
 * Core factory that creates the shared state and both pre/post plugins.
 * @param options configuration options
 * @returns pre and post plugins
 */
function createCsszyxPlugins(options: PartialCsszyxConfig = {}): {
    prePlugin: UnpluginInstance<PartialCsszyxConfig, boolean>;
    postPlugin: UnpluginInstance<PartialCsszyxConfig, boolean>;
} {
    assertGlobalVarMangleConfig(options);

    // Mangling is opt-IN: it obfuscates class names and, over a compressed
    // response, costs bytes rather than saving them (utility names compress far
    // better than the map that has to ship alongside them), so a build only pays
    // for it when it asks. It also has no value in a dev server: the dev CSS
    // pipeline (e.g. a separate @tailwindcss/vite) serves UN-mangled class names,
    // so applying a mangle map at runtime via `szr` would emit class names that
    // have no matching CSS — silently collapsing szv-driven layouts in
    // `vite serve` only. Forced off for `command === 'serve'` below
    // (configResolved), so dev always uses readable class names that match the
    // dev CSS. `let` because the command is only known at configResolved.
    let manglingEnabled = options.production?.mangle === true;
    // Cross-module szv registry: filled by the prescan, refreshed per edit by
    // `refreshSzvRegistryEntry`, resolved per file. Watch lanes used to switch
    // this off because a one-shot prescan left an edited factory serving its
    // startup table; refreshing the entry removes that staleness at the source,
    // so the precompile now runs in a dev server too.
    const crossModuleRegistryEnabled = true;
    // Resolved once: the shared default is not merged into plugin options, so
    // every read site would otherwise have to remember the fallback, and one
    // that forgot would run a different feature than the rest of the plugin.
    const importedStaticSzEnabled = options.build?.importedStaticSz ?? DEFAULT_IMPORTED_STATIC_SZ;
    /** absPath (separator-normalized) → exported factory configs. */
    const szvCrossModuleRegistry: SzvCrossModuleRegistry = new Map();
    // Provider paths already read for sz objects this session. A module that
    // exports nothing usable is absent from the registry, so the registry alone
    // cannot answer "have I looked at this?" — without the set, every edit of a
    // file would re-read and re-parse each of its relative imports.
    const szObjectProvidersExamined = new Set<string>();
    // What a non-relative specifier stands for, read from the bundler's own
    // resolve config and the project's tsconfig. Assigned before the prescan
    // runs on each lane that has one: the prescan decides which modules to read
    // using this table, and the transform looks them up using the same table,
    // so a late assignment would collect a demand nothing later resolves.
    let specifierAliases: SpecifierAlias[] = [];
    // Class names the mangler must never produce as a token, so a short alias
    // can't collide with a literal class in non-csszyx CSS (hybrid builds). Comes
    // from config, so it is available identically at every finalizeMangleMap call
    // site (buildEnd / transformIndexHtml / generateBundle / processAssets) — the
    // reason a config exclude-list is consistent where a bundle-CSS scan would not.
    const mangleReserved = new Set(options.production?.mangleExclude ?? []);
    // Which delivery channels carry the runtime mangle map. Both channels ship
    // the whole census, so a build that needs only one was paying for the map
    // twice across HTML and JS. Defaults to 'both': dropping a channel is only
    // safe against a known deployment shape, and guessing wrong leaves runtime
    // helpers mapless while the CSS ships mangled.
    const mangleMapDelivery = options.production?.mangleMapDelivery ?? 'both';
    if (!['both', 'html', 'bundle'].includes(mangleMapDelivery)) {
        // A typo ('htlm') would otherwise read as 'both' through the two
        // negative comparisons below — silently, in the option whose whole
        // point is narrowing against a known deployment shape.
        throw new Error(
            `[csszyx] production.mangleMapDelivery must be 'both', 'html' or 'bundle'; got ${JSON.stringify(mangleMapDelivery)}.`,
        );
    }
    const deliverMapInHtml = mangleMapDelivery !== 'bundle';
    const deliverMapInBundle = mangleMapDelivery !== 'html';
    // Weighs the map against the CSS it bought. Counts channels that actually
    // shipped rather than the configured ones: a webpack build never takes the
    // bundle module, and a library build emits no HTML, so charging for a
    // channel the build did not use would overstate the cost.
    const sizeAccount: MangleSizeAccount = createMangleSizeAccount();
    // User can raise/lower the AST node budget per build via the existing
    // `BuildConfig.astBudgetLimit` field in @csszyx/types. Undefined here =
    // compiler falls back to the default 50 000 in @csszyx/compiler.
    const astBudgetOverride = options.build?.astBudgetLimit;
    // The prescan is the build's ONLY safelist source under Tailwind
    // `source(none)`: a file the budget bails contributes zero classes and its
    // CSS silently never exists. Engines also count AST nodes differently, so a
    // real page file can trip the 50k default under one engine and pass under
    // another (a parser-flip safelist divergence, field-reported). The prescan
    // is a one-shot batch over sz-bearing files where correctness outranks the
    // per-file latency the default cap protects, so it runs with a 10× budget;
    // an explicit `build.astBudgetLimit` still wins in both lanes.
    const prescanAstBudget = astBudgetOverride ?? 500_000;
    const cacheRequested = (options.build?.cache ?? DEFAULT_BUILD_CONFIG.cache) !== false;
    const cacheVersionsKnown =
        PLUGIN_VERSION !== UNKNOWN_PACKAGE_VERSION && COMPILER_VERSION !== UNKNOWN_PACKAGE_VERSION;
    const cacheEnabled = cacheRequested && cacheVersionsKnown;
    const varMangleMapMaxBytes = resolveVarMangleMapMaxBytes();
    const globalVarMangleConfig = options.production?.mangleGlobalVars;
    const globalVarSourceTrackingEnabled = shouldTrackGlobalVarSources(globalVarMangleConfig);
    const globalVarAliasPrefix = globalVarMangleConfig?.aliasPrefix ?? CSSZYX_GLOBAL_ALIAS_PREFIX;
    const encodedGlobalVarAliasPrefix = encodeURIComponent(globalVarAliasPrefix);
    const earlyGlobalVarAliasEntries = createEarlyGlobalVarAliasEntries(
        globalVarMangleConfig,
        globalVarAliasPrefix,
    );
    if (cacheRequested && !cacheVersionsKnown && !_hasWarnedTransformCacheVersion) {
        _hasWarnedTransformCacheVersion = true;
        console.warn(
            '[csszyx] Transform cache disabled because package versions could not be resolved.',
        );
    }
    // Source locations opted into compilation by path (relaxes the /packages/
    // hard-ignore + adds prescan roots). Resolved to absolute realpath'd dirs
    // lazily once the project root is known (configResolved / beforeCompile),
    // because the entries resolve relative to that root.
    const compileSources = options.compileSources ?? [];
    // `quiet` mutes csszyx build warnings (e.g. to focus on another tool's
    // output). Errors that throw are unaffected — only warnings are silenced.
    // `'nudges'` keeps the reports that say output is missing.
    const quiet = resolveQuietMode(options.quiet);
    // An option the plugin does not read is silent, so whatever it was set for
    // simply does not happen — the renamed `compilePackages` cost a field user
    // an afternoon exactly that way. Reported at the top, before any build
    // output, because it explains everything that follows. NOT `devOnly`: a
    // production build is where the missing behaviour actually costs something.
    const unknownConfigKeys = findUnknownConfigKeys(options);
    if (unknownConfigKeys.length > 0) {
        emitWarning(unknownConfigKeysMessage(unknownConfigKeys));
    }
    /**
     * Emit a csszyx build warning, unless `quiet` mutes all of them. `devOnly`
     * additionally suppresses it in production — for usage nudges that should not
     * noise a host app's production build (a csszyx-output defect is NOT devOnly).
     *
     * @param message - The warning text (already `[csszyx]`-prefixed).
     * @param opts - Emission options.
     * @param opts.devOnly - Suppress this warning in a production build.
     */
    function emitWarning(message: string, opts: { devOnly?: boolean } = {}): void {
        if (
            shouldEmitWarning(quiet, opts.devOnly ?? false, process.env.NODE_ENV === 'production')
        ) {
            console.warn(message);
        }
    }
    // Graceful degradation: when `rust` is only the DEFAULT (not opted into) and no
    // prebuilt native binary is installed for this platform (unsupported arch,
    // optional deps omitted, or a cross-platform frozen lockfile), fall back to
    // `oxc` — which produces parity-identical classes — with a one-time warning,
    // instead of hard-failing a build the user never asked to run on `rust`. An
    // EXPLICIT `rust` (env or config) keeps its loud-failure contract.
    const { parser: parserMode, degraded: parserDegraded } = resolveParserMode({
        configParser: options.build?.parser,
        envParser: process.env.CSSZYX_PARSER,
        defaultParser: DEFAULT_BUILD_CONFIG.parser ?? 'rust',
        isRustAvailable: isRustTransformAvailable,
    });
    /**
     * Announce the engine actually in effect (and the native-binary degrade, if
     * any). Called from build-lifecycle hooks, NOT from the factory body: the
     * module exports a default plugin instance for compatibility, so the factory
     * runs at import time with default options — announcing there printed
     * `active parser: rust (native engine)` in processes whose real build was
     * configured for another engine, which cost a field user an investigation.
     * Once per resolved mode per process.
     */
    function announceActiveParser(): void {
        if (parserDegraded && !_hasWarnedNativeFallback) {
            _hasWarnedNativeFallback = true;
            console.warn(
                '[csszyx] No prebuilt native binary (@csszyx/core-*) is available for this ' +
                    'platform, so the default `rust` parser fell back to `oxc`. Output classes ' +
                    'are identical (parity-tested); only parse speed differs. To use the native ' +
                    'engine, install the matching @csszyx/core-<platform> package (or do not ' +
                    'omit optional dependencies). Set `build.parser` explicitly to silence this.',
            );
        }
        if (!_loggedActiveParsers.has(parserMode)) {
            _loggedActiveParsers.add(parserMode);
            let detail: string = parserMode;
            if (parserDegraded) {
                detail = 'oxc (degraded from default `rust`: no native binary for this platform)';
            } else if (parserMode === 'rust') {
                detail = 'rust (native engine)';
            }
            // stderr (console.warn), not stdout: a consumer like @csszyx/mcp-server
            // runs a stdio JSON-RPC protocol where any stray stdout corrupts the stream.
            console.warn(`[csszyx] active parser: ${detail}`);
        }
    }
    let evictedCacheRoot: string | null = null;
    const transformMemoryCache = new Map<string, SourceTransformResult>();
    let transformMemoryCacheCodeChars = 0;
    // One-shot handoff of prescan transform results to the transform hook.
    // The two lanes intentionally never share the transform CACHE (the prescan
    // runs a larger AST budget, and a cache entry must not be served to a lane
    // whose budget could not have produced it) — but within ONE process, for
    // UNCHANGED content, the prescan result IS the hook result, so re-deriving
    // it made every cold build/dev start transform each sz-file twice.
    // Entries are keyed by normalized filename, guarded by the full source
    // sha256, and deleted on first probe (hit or miss) so the map drains as
    // the module graph loads; buildEnd and the first HMR update clear any
    // residue for files the bundler never requested.
    const prescanResultHandoff = new Map<
        string,
        { inputSha256: string; result: SourceTransformResult }
    >();

    const state: PluginState = {
        classes: new Set<string>(),
        parsedTheme: null,
        scanCssTheme: null,
        autoThemeCssFiles: [],
        sawTailwindEntry: false,
        sawAnyCss: false,
        tailwindWarningEmitted: false,
        tailwindEntryScoped: false,
        contentScopeWarningEmitted: false,
        spreadWarnings: new Set<string>(),
        suppressedAdvisories: 0,
        skippedSzFiles: new Set<string>(),
        skippedSzvExportFiles: new Set<string>(),
        skipWarningEmitted: false,
        classesCapped: false,
        ownedClasses: new Set<string>(),
        authoredClasses: new Set<string>(),
        mangleMap: {},
        varMangleEntriesByFile: new Map(),
        varMangleMap: Object.fromEntries(earlyGlobalVarAliasEntries),
        cssVarMetricsByFile: new Map(),
        cssVarMetrics: emptyCSSVariableMetrics(),
        checksum: '',
        finalized: false,
        rootDir: process.cwd(),
        recoveryTokens: new Map<string, TokenData>(),
        rscModules: new Map<string, RSCModuleRecord>(),
        globalVarSourceFilesByFile: new Map<string, string>(),
        globalVarValidationResult: null,
    };
    if (earlyGlobalVarAliasEntries.length > 0) {
        state.varMangleEntriesByFile.set(GLOBAL_VAR_ALIAS_MAP_OWNER, earlyGlobalVarAliasEntries);
    }

    const SAFELIST_FILENAME = 'csszyx-classes.html';
    // Module flavours included: the engine-parity harness caught the prescan
    // walk skipping `.mjs` entirely — every class in such a file was silently
    // dead under Tailwind `source(none)` on ALL engines.
    const SOURCE_EXTENSIONS = new Set([
        '.tsx',
        '.jsx',
        '.ts',
        '.js',
        '.mjs',
        '.cjs',
        '.mts',
        '.cts',
    ]);
    const IGNORE_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.turbo']);

    /**
     * User exclude filters must run before any parser call. This is the escape
     * hatch for large generated source files that contain an incidental `sz`
     * marker and would otherwise trip the AST budget guard.
     *
     * @param id - Bundler file id or filesystem path.
     * @returns True when user config excludes this file.
     */
    function isUserExcluded(id: string): boolean {
        return matchesAnyPattern(id, options.exclude, state.rootDir);
    }

    /**
     * Checks the optional user include filter for source transforms.
     *
     * @param id - Bundler file id or filesystem path.
     * @returns True when the file is allowed by include config.
     */
    function isUserIncluded(id: string): boolean {
        return !options.include || matchesAnyPattern(id, options.include, state.rootDir);
    }

    /**
     * Resolves the scan cache directory for pure global-var validation.
     *
     * @returns Cache directory when build cache is enabled.
     */
    function resolveGlobalVarValidationCacheDir(): string | undefined {
        if (!cacheEnabled) {
            return undefined;
        }
        const cacheRoot = path.resolve(
            state.rootDir,
            options.build?.cacheDir ?? DEFAULT_BUILD_CONFIG.cacheDir ?? '.csszyx/cache',
        );
        return resolveGlobalVarScanCacheDir(cacheRoot);
    }

    /**
     * Validates CSS assets and observed source files before global-var output
     * rewriting is allowed to mutate a production bundle.
     *
     * @param cssAssets Bundler CSS assets.
     * @returns Validated global-var result when the feature is enabled.
     */
    function validateGlobalVarBundleInputs(
        cssAssets: GlobalVarCssAssetSource[],
    ): GlobalVarAliasValidationResult | null {
        if (globalVarMangleConfig?.enabled !== true) {
            return null;
        }
        const configuredCssAssets = collectConfiguredGlobalVarCssSources(
            state.rootDir,
            options.build?.scanCss,
        );
        const result = validateGlobalVarAliasInputs(
            createGlobalVarAliasValidationOptions({
                rootDir: state.rootDir,
                cssAssets: [...configuredCssAssets, ...cssAssets],
                sourceFiles: buildGlobalVarSourceFiles(state),
                tokens: globalVarMangleConfig.tokens,
                autoPrefix: globalVarMangleConfig.autoPrefix,
                aliasPrefix: globalVarAliasPrefix,
                reserved: globalVarMangleConfig.reserved,
                cacheDir: resolveGlobalVarValidationCacheDir(),
            }),
        );
        assertNoGlobalVarAliasValidationErrors(result);
        assertGlobalVarPlanMatchesEarlyAliases(result, earlyGlobalVarAliasEntries);
        return result;
    }

    /**
     * Records source text for global-var diagnostics, but only while the
     * feature that consumes it (`production.mangleGlobalVars`) is enabled.
     * The delete path (`watchChange`) stays on `recordGlobalVarSourceFile`
     * directly — clearing is always safe.
     *
     * @param filename Source filename that owns the text.
     * @param code Source text to retain.
     */
    function trackGlobalVarSourceFile(filename: string, code: string): void {
        if (!globalVarSourceTrackingEnabled) {
            return;
        }
        recordGlobalVarSourceFile(state, filename, code);
    }

    // Resolved compileSources directories (absolute, realpath'd). Filled once the
    // project root is known; recomputed if the root changes (e.g. webpack reuse).
    let compileSourceDirs: string[] = [];
    let compileSourceDirsRoot: string | null = null;

    /**
     * Resolve `compileSources` against the current project root (memoized per
     * root) and warn once about entries that did not resolve to a directory.
     */
    function refreshCompileSourceDirs(): void {
        if (compileSources.length === 0 || compileSourceDirsRoot === state.rootDir) {
            return;
        }
        compileSourceDirsRoot = state.rootDir;
        const { dirs, missing } = resolveCompileSourceDirs(state.rootDir, compileSources);
        compileSourceDirs = dirs;
        if (missing.length > 0) {
            emitWarning(
                `[csszyx] compileSources: ${missing.length} path(s) did not resolve to a ` +
                    `directory (relative to ${state.rootDir}): ${missing.join(', ')}. ` +
                    'Their `sz`/`szv` will not be compiled or safelisted.',
            );
        }
    }

    /**
     * Project-wide @theme discovery. Walks the project root (plus opted-in
     * compileSources dirs outside it) for .css files carrying an @theme block
     * and merges their tokens into `state.parsedTheme`, so szcn's custom-token
     * groups work without wiring.
     *
     * Runs whether or not `build.scanCss` is set. That option says which CSS
     * drives `.csszyx/theme.d.ts` — a TYPING scope, and this scan writes no
     * .d.ts. Letting it also narrow the merge groups meant a project that
     * listed one stylesheet silently lost last-wins for every token declared in
     * another: both classes survive and the STYLESHEET order picks the winner
     * instead of the author's. A missing type is an autocomplete gap; a missing
     * merge group is wrong output.
     *
     * @param rootDir - project root directory to walk.
     */
    function runAutoThemeScan(rootDir: string): void {
        refreshCompileSourceDirs();
        const discovered = discoverProjectTheme(rootDir, [...compileSourceDirs]);
        state.autoThemeCssFiles = discovered.files;
        // Recomputed from both sources every time rather than merged into the
        // previous value: a token deleted from a stylesheet must disappear, and
        // accumulating into `state.parsedTheme` would keep it registered.
        const sources = [state.scanCssTheme, discovered.theme].filter(
            (theme): theme is ParsedTheme => theme !== null,
        );
        if (sources.length > 0) {
            state.parsedTheme = mergeThemes(sources);
        }
    }

    /**
     * Checks built-in directories that csszyx never transforms.
     *
     * @param id - Bundler file id or filesystem path.
     * @returns True when the file should be skipped regardless of user filters.
     */
    function isHardIgnored(id: string): boolean {
        refreshCompileSourceDirs();
        return isHardIgnoredPath(id, compileSourceDirs);
    }

    /**
     * Checks whether a source module should enter the csszyx AST transform.
     *
     * @param id - Bundler file id or filesystem path.
     * @returns True when csszyx should parse and transform the source file.
     */
    function shouldProcessSource(id: string): boolean {
        // `[cm]?` admits the ESM/CJS module flavours (.mjs/.cjs/.mts/.cts): the
        // engine-parity harness caught `.mjs` files being neither transformed
        // nor scanned — their sz props reached the bundle untouched and every
        // class was silently dead under Tailwind `source(none)`.
        return (
            !isHardIgnored(id) &&
            !isUserExcluded(id) &&
            isUserIncluded(id) &&
            (matchesScriptExtension(id, SOURCE_MODULE_EXTENSIONS) ||
                id.endsWith('.vue') ||
                id.endsWith('.svelte'))
        );
    }

    /**
     * Checks whether a CSS module should receive Tailwind safelist injection.
     *
     * @param id - Bundler file id or filesystem path.
     * @returns True when csszyx should process the CSS file.
     */
    function shouldProcessCss(id: string): boolean {
        return !isHardIgnored(id) && !isUserExcluded(id) && matchesScriptExtension(id, ['.css']);
    }

    /**
     * Runs the configured source transform. Rust is the default parser after
     * the max-speed pass and routes through the native engine. Oxc is
     * the documented JavaScript fallback for native-unavailable platforms, and
     * Babel remains the final compatibility safety net for unexpected
     * parser/compiler failures on either engine.
     *
     * @param source Source module contents.
     * @param filename Source filename for parser diagnostics.
     * @param astBudget Effective AST node cap for this lane; defaults to the
     *        transform-hook budget (`build.astBudgetLimit` or the compiler's
     *        50 000 default), while the prescan passes its larger cap.
     * @returns Compiler transform result.
     */
    function transformConfiguredSource(
        source: string,
        filename: string,
        astBudget?: number,
    ): SourceTransformResult {
        const compilerOptions = createCompilerOptions(astBudget);
        const effectiveFilename = normalizeSourceFilename(filename);
        const crossModuleStatics = resolveCrossModuleStaticsFor(
            szvCrossModuleRegistry,
            filename,
            source,
            specifierAliases,
        );
        // The registry is filled in every mode; only the REWRITE is gated, so
        // an edited factory can never serve importers a stale table.
        if (crossModuleRegistryEnabled && crossModuleStatics.szvConfigs !== undefined) {
            compilerOptions.crossModuleStatics = crossModuleStatics.szvConfigs;
        }
        if (crossModuleStatics.szObjects !== undefined) {
            compilerOptions.crossModuleSzObjects = crossModuleStatics.szObjects;
        }
        const cacheRoot = resolveTransformCacheDir(state.rootDir, options.build?.cacheDir);

        if (cacheEnabled) {
            evictTransformCacheOnce();
        }

        const cacheInput = createConfiguredTransformCacheInput(
            source,
            effectiveFilename,
            compilerOptions,
        );

        if (parserMode === 'rust') {
            ensureRustTransformAvailable();
        }

        // Hoist the cache key once per transform call. The previous version
        // computed it inside the lookup block AND again inside
        // `readTransformCache` / `writeTransformCache` (each call sha256s
        // the full source), so a cold cache miss could pay three or four
        // identical hashes per file. Computing it here lets every cache
        // operation reuse the same digest.
        const cacheKey = cacheEnabled ? createTransformCacheKey(cacheInput) : null;

        if (cacheEnabled && cacheKey) {
            const cached = findConfiguredTransformCacheEntry(
                cacheRoot,
                cacheInput,
                cacheKey,
                effectiveFilename,
                astBudget,
            );
            if (cached) return cached;
        }

        const execution = runConfiguredParser(source, effectiveFilename, compilerOptions);
        if (cacheEnabled && cacheKey && execution.cacheable) {
            writeTransformCache(cacheRoot, cacheInput, execution.result, cacheKey);
            rememberTransformCacheEntry(cacheKey.key, execution.result);
        }
        return execution.result;
    }

    /**
     * Finds an in-memory, disk, or prescan-handoff transform result.
     * @param cacheRoot Transform cache directory.
     * @param cacheInput Full transform cache identity.
     * @param cacheKey Precomputed cache key.
     * @param effectiveFilename Normalized source filename.
     * @param astBudget Explicit prescan budget, when this is a prescan lane.
     * @returns A reusable result, or null on a cold miss.
     */
    function findConfiguredTransformCacheEntry(
        cacheRoot: string,
        cacheInput: TransformCacheKeyInput,
        cacheKey: TransformCacheKey,
        effectiveFilename: string,
        astBudget: number | undefined,
    ): SourceTransformResult | null {
        const memoryCached = transformMemoryCache.get(cacheKey.key);
        if (memoryCached) {
            transformMemoryCache.delete(cacheKey.key);
            transformMemoryCache.set(cacheKey.key, memoryCached);
            return memoryCached;
        }

        const diskCached = readTransformCache(cacheRoot, cacheInput, cacheKey);
        if (diskCached) {
            rememberTransformCacheEntry(cacheKey.key, diskCached);
            return diskCached;
        }

        if (astBudget !== undefined) return null;
        const handoff = prescanResultHandoff.get(effectiveFilename);
        if (!handoff) return null;
        prescanResultHandoff.delete(effectiveFilename);
        return handoff.inputSha256 === cacheKey.inputSha256 ? handoff.result : null;
    }

    /**
     * Runs the selected parser and marks fallback output as non-cacheable.
     * @param source Source module contents.
     * @param effectiveFilename Normalized source filename.
     * @param compilerOptions Compiler options.
     * @returns Transform result plus whether it is safe under the configured cache key.
     */
    function runConfiguredParser(
        source: string,
        effectiveFilename: string,
        compilerOptions: TransformSourceCodeOptions,
    ): { result: SourceTransformResult; cacheable: boolean } {
        if (parserMode === 'babel') {
            return {
                result: transformSourceCode(source, effectiveFilename, compilerOptions),
                cacheable: true,
            };
        }
        if (parserMode === 'rust') {
            // Honour the documented contract: `rust` is opt-in and never
            // silently falls back to oxc/Babel. Any failure here surfaces
            // to the caller with the same compatibility error the compiler
            // wrapper raises when the native addon is missing for the current
            // host, so misconfigured environments fail loudly instead of
            // producing oxc output users were not expecting.
            return {
                result: transformRust(source, effectiveFilename, compilerOptions),
                cacheable: true,
            };
        }

        try {
            return {
                result: transformOxc(source, effectiveFilename, compilerOptions),
                cacheable: true,
            };
        } catch (error) {
            return {
                result: runBabelFallback(source, effectiveFilename, compilerOptions, error),
                cacheable: false,
            };
        }
    }

    /**
     * Runs and reports the compatibility fallback for an Oxc parser failure.
     * @param source Source module contents.
     * @param effectiveFilename Normalized source filename.
     * @param compilerOptions Compiler options.
     * @param error Oxc parser failure.
     * @returns Babel compatibility transform result.
     */
    function runBabelFallback(
        source: string,
        effectiveFilename: string,
        compilerOptions: TransformSourceCodeOptions,
        error: unknown,
    ): SourceTransformResult {
        const result = transformSourceCode(source, effectiveFilename, compilerOptions);
        const reason = babelFallbackReason(error);
        result.diagnostics.push(
            `[csszyx] oxc parser fell back to Babel for ${effectiveFilename}: ${reason}`,
        );
        if (!_babelFallbackFiles.has(effectiveFilename)) {
            _babelFallbackFiles.add(effectiveFilename);
            console.warn(
                `[csszyx] oxc parser fell back to Babel for ${effectiveFilename}: ${reason} ` +
                    `(${_babelFallbackFiles.size} file(s) so far). Output is still correct; ` +
                    'this usually means the file uses a syntax the oxc lane does not yet handle.',
            );
        }
        return result;
    }

    /**
     * Builds compiler options shared by single-file and prescan-batch transforms.
     *
     * @param astBudget Effective AST node cap for this lane (transform hook
     *        default vs the larger prescan budget).
     * @returns Compiler options.
     */
    function createCompilerOptions(
        astBudget: number | undefined = astBudgetOverride,
    ): TransformSourceCodeOptions {
        return {
            astBudget,
            mangleVars: options.production?.mangleVars === true,
            mangleVarHoistMaxDepth: options.production?.mangleVarHoistMaxDepth,
            globalVarAliases:
                earlyGlobalVarAliasEntries.length > 0 ? earlyGlobalVarAliasEntries : undefined,
            // Render dev-mode unknown-property warnings relative to the project root.
            rootDir: state.rootDir,
        };
    }

    /**
     * Builds cache identity for the configured parser/compiler options.
     *
     * @param source Source module contents.
     * @param effectiveFilename Normalized source filename.
     * @param compilerOptions Compiler options.
     * @returns Transform cache input.
     */
    function createConfiguredTransformCacheInput(
        source: string,
        effectiveFilename: string,
        compilerOptions: TransformSourceCodeOptions,
    ): TransformCacheKeyInput {
        return {
            pluginVersion: PLUGIN_VERSION,
            compilerVersion: COMPILER_VERSION,
            nativeIdentity: parserMode === 'rust' ? resolveNativeCacheIdentity() : undefined,
            parserMode,
            producer: parserMode,
            // The EFFECTIVE budget, not the raw override: prescan-lane results
            // (larger budget) must not be served to the transform hook, whose
            // smaller budget could not have produced them (and vice versa).
            astBudget: compilerOptions.astBudget,
            mangleVars: compilerOptions.mangleVars,
            mangleVarHoistMaxDepth: compilerOptions.mangleVarHoistMaxDepth,
            globalVarAliases: normalizeGlobalVarAliasesForCache(compilerOptions.globalVarAliases),
            // The registry entries fed to this file are part of its identity:
            // module A's config change must miss B's cached transform, or the
            // cache serves a stale table.
            crossModuleStatics:
                compilerOptions.crossModuleStatics === undefined
                    ? undefined
                    : JSON.stringify(compilerOptions.crossModuleStatics),
            crossModuleSzObjects:
                compilerOptions.crossModuleSzObjects === undefined
                    ? undefined
                    : JSON.stringify(compilerOptions.crossModuleSzObjects),
            filename: effectiveFilename,
            source,
        };
    }

    /**
     * Transforms prescan files, batching Rust cache misses in one native call.
     *
     * The batch carries ONE options object for every file in it, so a file
     * whose imports resolve to registry entries cannot ride in it — its
     * `crossModuleStatics` are its own. Those files take the per-file path and
     * the rest still batch, which keeps the native round-trip saving where it
     * came from: in a real project almost nothing imports a style module.
     *
     * @param files Source files discovered during prescan.
     * @returns Transform results for files that compiled successfully.
     */
    function transformPrescanSources(files: PrescanSourceFile[]): PrescanTransformResult[] {
        if (parserMode !== 'rust' || files.length <= 1) {
            return transformPrescanSourcesIndividually(files);
        }

        const perFile: PrescanSourceFile[] = [];
        const batchable: PrescanSourceFile[] = [];
        for (const file of files) {
            (hasCrossModuleStatics(file) ? perFile : batchable).push(file);
        }
        const individual = transformPrescanSourcesIndividually(perFile);

        const compilerOptions = createCompilerOptions(prescanAstBudget);
        const cacheRoot = resolveTransformCacheDir(state.rootDir, options.build?.cacheDir);
        const results = new Map<string, SourceTransformResult>();

        if (cacheEnabled) evictTransformCacheOnce();
        ensureRustTransformAvailable();
        const misses = collectRustPrescanMisses(batchable, compilerOptions, cacheRoot, results);
        if (misses.length > 0) {
            try {
                runRustPrescanBatch(misses, compilerOptions, cacheRoot, results);
            } catch {
                runRustPrescanFallback(misses, results);
            }
        }
        return [...individual, ...orderPrescanResults(batchable, results)];
    }

    /**
     * Whether one prescan file's imports resolve to anything in the registry.
     *
     * Asked with the same function the transform uses, so a file routed to the
     * batch is one the transform would also have given no statics.
     *
     * @param file - Source file discovered during prescan.
     * @returns True when the file has per-file cross-module options.
     */
    function hasCrossModuleStatics(file: PrescanSourceFile): boolean {
        const resolved = resolveCrossModuleStaticsFor(
            szvCrossModuleRegistry,
            file.filePath,
            file.content,
            specifierAliases,
        );
        return resolved.szvConfigs !== undefined || resolved.szObjects !== undefined;
    }

    /**
     * Resolves cached Rust prescan inputs and returns the remaining misses.
     *
     * @param files Source files discovered during prescan.
     * @param compilerOptions Effective compiler options.
     * @param cacheRoot Transform cache directory.
     * @param results Result sink keyed by authored file path.
     * @returns Inputs requiring a native batch transform.
     */
    function collectRustPrescanMisses(
        files: PrescanSourceFile[],
        compilerOptions: TransformSourceCodeOptions,
        cacheRoot: string,
        results: Map<string, SourceTransformResult>,
    ): RustPrescanMiss[] {
        const misses: RustPrescanMiss[] = [];
        for (const file of files) {
            const effectiveFilename = normalizeSourceFilename(file.filePath);
            const cacheInput = createConfiguredTransformCacheInput(
                file.content,
                effectiveFilename,
                compilerOptions,
            );
            const cacheKey = cacheEnabled ? createTransformCacheKey(cacheInput) : null;
            const cached = cacheKey
                ? findConfiguredTransformCacheEntry(
                      cacheRoot,
                      cacheInput,
                      cacheKey,
                      effectiveFilename,
                      prescanAstBudget,
                  )
                : null;
            if (cached) results.set(file.filePath, cached);
            else misses.push({ ...file, effectiveFilename, cacheInput, cacheKey });
        }
        return misses;
    }

    /**
     * Executes and stores one native Rust prescan batch.
     *
     * @param misses Inputs requiring transformation.
     * @param compilerOptions Effective compiler options.
     * @param cacheRoot Transform cache directory.
     * @param results Result sink keyed by authored file path.
     */
    function runRustPrescanBatch(
        misses: RustPrescanMiss[],
        compilerOptions: TransformSourceCodeOptions,
        cacheRoot: string,
        results: Map<string, SourceTransformResult>,
    ): void {
        const batchResults = transformRustBatch(
            misses.map(file => ({ filename: file.effectiveFilename, source: file.content })),
            compilerOptions,
        );
        for (let index = 0; index < misses.length; index++) {
            const miss = misses[index];
            const result = batchResults[index];
            if (!miss || !result) continue;
            cacheRustPrescanResult(miss, result, cacheRoot);
            results.set(miss.filePath, result);
        }
    }

    /**
     * Caches one successful Rust prescan result when caching is enabled.
     *
     * @param miss Original cache miss metadata.
     * @param result Transform result.
     * @param cacheRoot Transform cache directory.
     */
    function cacheRustPrescanResult(
        miss: RustPrescanMiss,
        result: SourceTransformResult,
        cacheRoot: string,
    ): void {
        if (!cacheEnabled || !miss.cacheKey) return;
        writeTransformCache(cacheRoot, miss.cacheInput, result, miss.cacheKey);
        rememberTransformCacheEntry(miss.cacheKey.key, result);
    }

    /**
     * Retries failed native batches one file at a time.
     *
     * @param misses Inputs from the failed batch.
     * @param results Result sink keyed by authored file path.
     */
    function runRustPrescanFallback(
        misses: RustPrescanMiss[],
        results: Map<string, SourceTransformResult>,
    ): void {
        for (const miss of misses) {
            try {
                const result = transformConfiguredSource(
                    miss.content,
                    miss.effectiveFilename,
                    prescanAstBudget,
                );
                results.set(miss.filePath, result);
            } catch {
                // Safelist discovery intentionally skips files that cannot transform.
            }
        }
    }

    /**
     * Restores source discovery order while omitting failed transforms.
     *
     * @param files Source files in discovery order.
     * @param results Results keyed by authored file path.
     * @returns Successful transforms in discovery order.
     */
    function orderPrescanResults(
        files: PrescanSourceFile[],
        results: Map<string, SourceTransformResult>,
    ): PrescanTransformResult[] {
        return files.flatMap(file => {
            const result = results.get(file.filePath);
            return result ? [{ filePath: file.filePath, result }] : [];
        });
    }

    /**
     * Transforms prescan files one by one.
     *
     * @param files Source files discovered during prescan.
     * @returns Transform results for files that compiled successfully.
     */
    function transformPrescanSourcesIndividually(
        files: PrescanSourceFile[],
    ): PrescanTransformResult[] {
        const results: PrescanTransformResult[] = [];
        for (const file of files) {
            try {
                results.push({
                    filePath: file.filePath,
                    result: transformConfiguredSource(
                        file.content,
                        file.filePath,
                        prescanAstBudget,
                    ),
                });
            } catch (err) {
                // Historical prescan behavior keeps the build alive, but the skip
                // itself must be visible: every class in this file is silently
                // dead under Tailwind `source(none)`.
                if (err instanceof ASTBudgetExceededError) {
                    warnPrescanBudgetSkip(file.filePath);
                    continue;
                }
                console.warn(
                    `[csszyx] prescan skipped ${file.filePath}: transform failed, so none of ` +
                        `its classes reached the safelist. ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }
        return results;
    }

    /**
     * Stores one transform result in the in-process L1 cache with a small LRU cap.
     *
     * @param key Transform cache key.
     * @param result Transform result.
     */
    function rememberTransformCacheEntry(key: string, result: SourceTransformResult): void {
        const existing = transformMemoryCache.get(key);
        if (existing) {
            transformMemoryCacheCodeChars -= existing.code.length;
            transformMemoryCache.delete(key);
        }
        transformMemoryCache.set(key, result);
        transformMemoryCacheCodeChars += result.code.length;
        transformMemoryCacheCodeChars = evictMemoryCacheToBudget(
            transformMemoryCache,
            transformMemoryCacheCodeChars,
            TRANSFORM_MEMORY_CACHE_MAX_ENTRIES,
            TRANSFORM_MEMORY_CACHE_MAX_CODE_CHARS,
        );
    }

    /** Runs transform-cache eviction once per resolved project cache root. */
    function evictTransformCacheOnce(): void {
        if (!cacheEnabled) {
            return;
        }
        const cacheRoot = resolveTransformCacheDir(state.rootDir, options.build?.cacheDir);
        if (evictedCacheRoot === cacheRoot) {
            return;
        }
        evictedCacheRoot = cacheRoot;
        evictOldTransformCacheEntries(cacheRoot, {
            maxAgeMs: TRANSFORM_CACHE_MAX_AGE_MS,
            maxEntries: TRANSFORM_CACHE_MAX_ENTRIES,
        });
    }

    /**
     * Adds a class to the safelist set, enforcing {@link MAX_SAFELIST_CLASSES}.
     * Past the cap, extra classes are dropped and {@link PluginState.classesCapped}
     * is set so a single warning can be surfaced at build end — this bounds the
     * memory and generated-file growth that pathological/hostile input (e.g.
     * unbounded unique arbitrary values) would otherwise cause.
     *
     * @param cls - the class name to record.
     */
    function addSafelistClass(cls: string): void {
        if (state.classes.size >= MAX_SAFELIST_CLASSES) {
            state.classesCapped = true;
            return;
        }
        state.classes.add(cls);
    }

    /**
     * Writes the safelist manifest (csszyx-classes.html) from the given class set.
     * No-ops if the file content is already up to date.
     *
     * HTML format is required (not JS string) because Tailwind v4's oxide scanner
     * only generates child-combinator CSS (used by space-y-*, divide-y-*, etc.) when
     * it sees the class applied to an element that has children in a scanned file.
     * A flat JS string export generates an empty .space-y-N {} rule — no margin CSS.
     * The HTML below puts every class on both a parent div and two child divs so that
     * all utility variants (parent-targeting and child-targeting) are correctly emitted.
     * @param classes - the full set of discovered classes to write
     */
    function writeSafelistFile(classes: Set<string>): void {
        if (classes.size === 0) {
            return;
        }
        const safelistPath = path.join(state.rootDir, SAFELIST_FILENAME);
        // The structural copy stays fully escaped. Exact candidate bytes are
        // appended in a scanner-only section because arbitrary variants can use
        // every HTML-sensitive character and Tailwind does not decode entities.
        // The three nested divs are intentional: Tailwind v4's oxide scanner only
        // emits child-combinator CSS (space-y-*, divide-y-*) when it sees the class
        // on an element that has children — a single div would drop that CSS.
        const classNames = Array.from(classes);
        const classList = escapeHtmlAttribute(classNames.join(' '));
        const content =
            '<!-- Auto-generated by csszyx — DO NOT EDIT -->\n' +
            '<!-- Tailwind CSS scans this file for class name detection -->\n' +
            `<div class="${classList}">` +
            `<div class="${classList}">x</div>` +
            `<div class="${classList}">x</div>` +
            '</div>\n' +
            renderTailwindScannerCandidates(classNames);
        try {
            let existing = '';
            try {
                existing = fs.readFileSync(safelistPath, 'utf-8');
            } catch (err) {
                if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
                    throw err;
                }
            }
            if (existing !== content) {
                fs.writeFileSync(safelistPath, content);
            }
        } catch {
            // Non-fatal: Tailwind just won't see prescanned classes
        }
    }

    /**
     * Records a skipped file when it is workspace-package source under
     * `/packages/` (not under any `compileSources` directory) that carries
     * csszyx authoring surface. These are the silent no-op cases — the file is
     * never prescanned, so its classes never reach the safelist and any szv
     * factory it exports never reaches the cross-module registry — surfaced
     * once at build end. node_modules/.next are never scanned (handled by
     * {@link isPackagesSkippedSource}).
     *
     * The marker set is the prescan's own, not a subset: a module holding only
     * `szv` factories carries no `sz=` or `sz:` at all, and that is exactly the
     * module whose skip costs every importer its precompile.
     *
     * @param filePath - filesystem path of the file the prescan skipped.
     */
    function recordPackagesSkipIfSz(filePath: string): void {
        // Called per module from `transformInclude` as well as from the prescan
        // walk, and a build with several environments resolves the same file
        // more than once — never read it twice.
        if (
            state.skippedSzFiles.has(filePath) ||
            !isPackagesSkippedSource(filePath, compileSourceDirs)
        ) {
            return;
        }
        let content: string;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch {
            return;
        }
        if (!fileMayContainSafelistableSz(content)) {
            return;
        }
        state.skippedSzFiles.add(filePath);
        if (mayExportSzvFactories(content)) {
            state.skippedSzvExportFiles.add(filePath);
        }
    }

    /**
     * Process one compiler result produced by the prescan batch.
     *
     * @param filePath Source file path.
     * @param content Original source content.
     * @param result Compiler result.
     * @param discoveredClasses sz-generated class sink.
     * @param rawDiscoveredClasses Raw class-name sink.
     */
    function processPrescanTransform(
        filePath: string,
        content: string | undefined,
        result: SourceTransformResult,
        discoveredClasses: Set<string>,
        rawDiscoveredClasses: Set<string>,
    ): void {
        const budgetExceeded = result.diagnostics.some(diagnostic =>
            diagnostic.includes('AST budget exceeded'),
        );
        if (cacheEnabled && !budgetExceeded && content !== undefined) {
            prescanResultHandoff.set(normalizeSourceFilename(filePath), {
                inputSha256: createHash('sha256').update(content).digest('hex'),
                result,
            });
        }
        if (budgetExceeded) {
            warnPrescanBudgetSkip(filePath);
            return;
        }
        const parseFailed = result.diagnostics.some(diagnostic =>
            diagnostic.includes('[csszyx] parse error in '),
        );
        if (result.classes.size === 0 && result.rawClassNames.size === 0 && parseFailed) {
            console.warn(
                `[csszyx] prescan skipped ${filePath}: the file failed to parse, so ` +
                    'none of its classes reached the safelist. Fix the syntax error ' +
                    '(or check the file extension matches its contents).',
            );
            return;
        }
        if (!result.transformed && result.classes.size === 0) {
            return;
        }
        collectPrescanResult(result, filePath, discoveredClasses, rawDiscoveredClasses);
    }

    /**
     * Refresh one file's registry entry after a watch-mode edit.
     *
     * The prescan fills the registry once, so without this an edited factory
     * keeps serving importers the table it had at startup. That is why the
     * cross-module precompile used to be switched off entirely outside a
     * one-shot production build.
     *
     * Invalidating the importers is the bundler's job and it already does it:
     * the rewrite replaces the factory CALL but leaves the `import` statement
     * standing, so the module graph keeps the edge and every importer
     * re-transforms on its own. The transform cache keys on the resolved
     * statics, so a changed table cannot be served from cache either. Refreshing
     * the entry before those re-transforms run is the whole fix.
     *
     * @param filePath - Absolute path of the changed or deleted file.
     * @param content - New source text, or null when the file was deleted.
     */
    function refreshSzvRegistryEntry(filePath: string, content: string | null): void {
        if (!shouldProcessSource(filePath)) return;
        if (content === null) {
            szvCrossModuleRegistry.delete(normalizePathSeparators(filePath));
            return;
        }
        recordSzvRegistryFile(szvCrossModuleRegistry, filePath, content);
        // A provider edited during a watch has to lose its stale value the same
        // way an edited factory does. Re-reading the changed file for both kinds
        // costs one parse of one file; deciding whether it is still demanded
        // would cost the import graph, and a recorded export nothing imports
        // resolves for nobody anyway.
        if (importedStaticSzEnabled) {
            recordSzObjectRegistryFile(szvCrossModuleRegistry, filePath, content);
            szObjectProvidersExamined.add(normalizePathSeparators(filePath));
            recordProvidersDemandedBy(filePath, content);
        }
    }

    /**
     * Read the providers one changed file newly imports from.
     *
     * The prescan collects demand from a whole-project walk, so it only knows
     * the imports that existed when the server started. Adding a cross-file
     * style import mid-session named a module nothing had demanded: it was
     * absent from the registry, the importer fell back, and only touching the
     * provider afterwards brought it in — a recovery step nothing tells the
     * author about, at the moment they have just opted in and are least able
     * to tell a limitation from a bug.
     *
     * Resolution goes through the same probe list the prescan uses, against
     * the same disk predicate the Turbopack loader uses, so a specifier lands
     * on one file whichever lane resolved it.
     *
     * @param filePath - Absolute path of the changed file.
     * @param content - Its new source text.
     */
    function recordProvidersDemandedBy(filePath: string, content: string): void {
        // Demand comes from files that author sz, matching the prescan's gate:
        // an edited module that styles nothing imports nothing worth reading.
        if (!fileMayContainSafelistableSz(content)) return;
        const directory = path.dirname(filePath);
        for (const specifier of importedSpecifiersIn(content)) {
            for (const base of specifierBases(specifier, directory, specifierAliases)) {
                const providerPath = resolveProviderPathWith(base, isReadableProviderFile);
                if (providerPath === undefined) continue;
                const key = normalizePathSeparators(providerPath);
                // Already-seen providers are kept current by their own refresh,
                // so re-reading here would buy nothing.
                if (!szObjectProvidersExamined.has(key)) {
                    szObjectProvidersExamined.add(key);
                    readAndRecordSzObjectProvider(providerPath);
                }
                break;
            }
        }
    }

    /**
     * Record one provider's exported sz objects, ignoring a file that cannot
     * be read.
     *
     * @param providerPath - Absolute provider path.
     */
    function readAndRecordSzObjectProvider(providerPath: string): void {
        let content: string;
        try {
            content = fs.readFileSync(providerPath, 'utf-8');
        } catch {
            return;
        }
        recordSzObjectRegistryFile(szvCrossModuleRegistry, providerPath, content);
    }

    /**
     * Read every module an sz-authoring file imports from, and record what it
     * exports.
     *
     * Runs after the walk because the demand is only complete once every
     * sz-authoring file has been seen. Reading from disk rather than keeping
     * every file's text in memory: the demanded set is small, and holding the
     * project's sources to serve it would not be.
     *
     * @param seenSourcePaths - Paths the prescan walked.
     * @param demand - Specifier bases imported by files that author sz.
     */
    function recordDemandedSzObjectProviders(
        seenSourcePaths: ReadonlySet<string>,
        demand: ReadonlySet<string>,
    ): void {
        for (const base of demand) {
            const providerPath = resolveProviderPath(seenSourcePaths, base);
            // A specifier resolving to nothing the walk saw is ordinary — a
            // package, a tsconfig alias, a file outside the compiled roots. It
            // costs the optimization and the importer keeps the runtime path,
            // which is exactly what v1 promises for those.
            if (providerPath === undefined) continue;
            // Marked seen so a later watch edit does not re-read what the walk
            // already answered; the entry stays current through its own refresh.
            szObjectProvidersExamined.add(normalizePathSeparators(providerPath));
            readAndRecordSzObjectProvider(providerPath);
        }
    }

    /**
     * Read a changed file and refresh its registry entry.
     *
     * @param filePath - Absolute path of the changed file.
     */
    function refreshSzvRegistryEntryFromDisk(filePath: string): void {
        if (!shouldProcessSource(filePath)) return;
        let content: string;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch {
            // Read failures are the delete race; drop the entry rather than
            // keep one nothing can refresh.
            refreshSzvRegistryEntry(filePath, null);
            return;
        }
        refreshSzvRegistryEntry(filePath, content);
    }

    /**
     * Pre-scans source files to discover class names before Tailwind CSS runs.
     * Tailwind v4 reads source files from disk and can't detect classes generated
     * by the csszyx transform (e.g. `sz={{ hover: { bg: 'gray-700' } }}` → `hover:bg-gray-700`).
     * This writes a manifest file with all discovered class names so Tailwind can scan it.
     */
    function prescanAndWriteClasses(): void {
        refreshCompileSourceDirs();
        // A registry entry outlives its file otherwise: a module that stops
        // exporting a qualifying factory would keep its old table through any
        // later prescan in the same process.
        szvCrossModuleRegistry.clear();
        // Cleared with the registry it describes: a provider "already examined"
        // against entries that no longer exist would never be read again.
        szObjectProvidersExamined.clear();
        const prescanStarted = performance.now();
        const discoveredClasses = new Set<string>();
        // Raw className values feed both Tailwind safelisting and the authored
        // ownership set, but never become csszyx-owned by themselves.
        const rawDiscoveredClasses = new Set<string>();
        const prescanSources: PrescanSourceFile[] = [];
        // Paths the walk saw, so the second pass can turn a specifier into the
        // file a consumer meant without going back to the filesystem to guess.
        const seenSourcePaths = new Set<string>();
        // Specifier bases imported by files that author sz, filled during the
        // walk and read once it finishes.
        const szObjectDemand = new Set<string>();

        /**
         * Read one processable source into the prescan queue.
         *
         * @param filePath Source file path.
         */
        function collectPrescanSource(filePath: string): void {
            if (!shouldProcessSource(filePath)) {
                recordPackagesSkipIfSz(filePath);
                return;
            }
            let content: string;
            try {
                content = fs.readFileSync(filePath, 'utf-8');
            } catch {
                return;
            }
            // Ownership must be complete before a virtual mangle-map module can
            // load. Raw-only modules therefore participate even when they do not
            // need the expensive sz parser pass.
            recordAuthoredClasses(content);
            recordSzvRegistryEntries(filePath, content);
            seenSourcePaths.add(normalizePathSeparators(filePath));
            if (fileMayContainSafelistableSz(content)) {
                prescanSources.push({ filePath, content });
                recordSzObjectDemand(filePath, content);
            }
        }

        /**
         * Note every module an sz-authoring file imports from.
         *
         * This is what keeps the sz-object pass demand-driven. `szv(` is a
         * cheap marker a provider carries in its own text; a plain exported
         * object has none, and `export const` is far too common to gate on —
         * asking every module in a project would parse code with nothing to do
         * with styling, on every build. What a file that USES sz imports is a
         * small set, and it is the only set that can matter.
         *
         * @param filePath Importing file path.
         * @param content Importing file text.
         */
        function recordSzObjectDemand(filePath: string, content: string): void {
            if (!importedStaticSzEnabled) return;
            const directory = path.dirname(filePath);
            for (const specifier of importedSpecifiersIn(content)) {
                for (const base of specifierBases(specifier, directory, specifierAliases)) {
                    szObjectDemand.add(base);
                }
            }
        }

        /**
         * Record one file's exported szv factories into the cross-module
         * registry, so importing files can precompile them.
         *
         * @param filePath Absolute source path.
         * @param content Source text.
         */
        function recordSzvRegistryEntries(filePath: string, content: string): void {
            // Recorded even when the registry is disabled for rewriting. Only
            // `transformConfiguredSource` gates on that flag; here the entries
            // are what lets the diagnostics tell "this factory would have been
            // precompiled, csszyx just turned the feature off for this build"
            // apart from a genuine authoring problem. A stale entry cannot
            // affect emitted code through that path.
            recordSzvRegistryFile(szvCrossModuleRegistry, filePath, content);
        }

        /**
         * Recursively walks directories to discover source files containing sz prop usage.
         * @param dir - the directory path to scan recursively
         */
        function scanDir(dir: string): void {
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                        scanDir(path.join(dir, entry.name));
                    }
                    continue;
                }
                if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
                    collectPrescanSource(path.join(dir, entry.name));
                }
            }
        }

        scanDir(state.rootDir);
        // Also walk opted-in compileSources directories that live OUTSIDE rootDir
        // (a sibling design-system package), so their sz/szv classes reach the
        // safelist. Dirs inside rootDir are already covered by the walk above.
        // shouldProcessSource relaxes the ignore for these (they are opted in), so
        // scanDir accepts their files.
        const normRoot = normalizeForMatch(state.rootDir);
        for (const sourceDir of compileSourceDirs) {
            if (sourceDir === normRoot || sourceDir.startsWith(`${normRoot}/`)) {
                continue;
            }
            scanDir(sourceDir);
        }

        recordDemandedSzObjectProviders(seenSourcePaths, szObjectDemand);

        const prescanContentByPath = new Map(
            prescanSources.map(file => [file.filePath, file.content]),
        );
        for (const { filePath, result } of transformPrescanSources(prescanSources)) {
            processPrescanTransform(
                filePath,
                prescanContentByPath.get(filePath),
                result,
                discoveredClasses,
                rawDiscoveredClasses,
            );
        }

        // sz-generated classes are csszyx-owned: safe to both safelist and mangle.
        // Raw className values are added to the safelist below but never to
        // ownedClasses. Shared raw/sz names are subtracted when the map finalizes.
        for (const cls of discoveredClasses) {
            addSafelistClass(cls);
            state.ownedClasses.add(cls);
        }

        // Write manifest file for Tailwind to scan — includes both sz-generated AND raw class names
        // so Tailwind JIT can detect any custom utilities that happen to shadow TW class names.
        const safelistClasses = new Set([...discoveredClasses, ...rawDiscoveredClasses]);
        writeSafelistFile(safelistClasses);
        traceBenchTiming('prescan', state.rootDir, performance.now() - prescanStarted);
    }

    /**
     * Collects class and metadata side effects from one prescan transform.
     *
     * @param result Compiler result.
     * @param filePath Source file path.
     * @param discoveredClasses sz-generated class sink.
     * @param rawDiscoveredClasses raw className sink.
     */
    function collectPrescanResult(
        result: SourceTransformResult,
        filePath: string,
        discoveredClasses: Set<string>,
        rawDiscoveredClasses: Set<string>,
    ): void {
        // Piggyback: use classes collected inside the JSXAttribute visitor.
        // Risk-free: only JSXAttribute nodes are visited, so text content,
        // JSDoc, comments, and string literals in other positions never
        // produce false positives.
        for (const cls of result.classes) {
            discoveredClasses.add(cls);
        }
        for (const cls of result.rawClassNames) {
            rawDiscoveredClasses.add(cls);
        }
        for (const [token, data] of result.recoveryTokens) {
            state.recoveryTokens.set(token, data);
        }
        recordFileVarMangleEntries(state, filePath, cssVariableEntries(result));
        recordFileCSSVariableMetrics(state, filePath, result.code);
        collectRuntimeStaticClasses(result, discoveredClasses);
    }

    /**
     * Extracts static classes hidden inside generated `_sz({...})` runtime calls.
     *
     * @param result Compiler result.
     * @param discoveredClasses sz-generated class sink.
     */
    function collectRuntimeStaticClasses(
        result: SourceTransformResult,
        discoveredClasses: Set<string>,
    ): void {
        if (!result.usesRuntime) {
            return;
        }
        const szCallRe = /_sz\(\s*\{/g;
        for (const szMatch of result.code.matchAll(szCallRe)) {
            let depth = 1;
            let idx = (szMatch.index ?? 0) + szMatch[0].length;
            while (idx < result.code.length && depth > 0) {
                if (result.code[idx] === '{') {
                    depth++;
                } else if (result.code[idx] === '}') {
                    depth--;
                }
                idx++;
            }
            const objStr = result.code.slice((szMatch.index ?? 0) + szMatch[0].length, idx - 1);
            collectRuntimeStringClasses(objStr, discoveredClasses);
            collectRuntimeNumberClasses(objStr, discoveredClasses);
            collectRuntimeBooleanClasses(objStr, discoveredClasses);
        }
    }

    /**
     * Extracts static string values from an `_sz({...})` object string.
     *
     * @param objStr Object source text.
     * @param discoveredClasses sz-generated class sink.
     */
    function collectRuntimeStringClasses(objStr: string, discoveredClasses: Set<string>): void {
        const strKv = /\b(\w+)\s*:\s*(?:"([^"]*)"|'([^']*)')/g;
        for (const kv of objStr.matchAll(strKv)) {
            try {
                const val = kv[2] ?? kv[3];
                collectTransformClasses(transform({ [kv[1]]: val }), discoveredClasses);
            } catch {
                // Skip invalid runtime static fragments.
            }
        }
    }

    /**
     * Extracts static number values from an `_sz({...})` object string.
     *
     * @param objStr Object source text.
     * @param discoveredClasses sz-generated class sink.
     */
    function collectRuntimeNumberClasses(objStr: string, discoveredClasses: Set<string>): void {
        const numKv = /\b(\w+)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?=[,}\n])/g;
        for (const kv of objStr.matchAll(numKv)) {
            try {
                collectTransformClasses(
                    transform({ [kv[1]]: Number.parseFloat(kv[2]) }),
                    discoveredClasses,
                );
            } catch {
                // Skip invalid runtime static fragments.
            }
        }
    }

    /**
     * Extracts static boolean values from an `_sz({...})` object string.
     *
     * @param objStr Object source text.
     * @param discoveredClasses sz-generated class sink.
     */
    function collectRuntimeBooleanClasses(objStr: string, discoveredClasses: Set<string>): void {
        const boolKv = /\b(\w+)\s*:\s*(true|false)\s*(?=[,}\n])/g;
        for (const kv of objStr.matchAll(boolKv)) {
            try {
                collectTransformClasses(
                    transform({ [kv[1]]: kv[2] === 'true' }),
                    discoveredClasses,
                );
            } catch {
                // Skip invalid runtime static fragments.
            }
        }
    }

    /**
     * Adds transform() className output to a class sink.
     *
     * @param result transform() result.
     * @param discoveredClasses sz-generated class sink.
     */
    function collectTransformClasses(
        result: ReturnType<typeof transform>,
        discoveredClasses: Set<string>,
    ): void {
        for (const cls of result.className.split(/\s+/).filter(Boolean)) {
            discoveredClasses.add(cls);
        }
    }

    /**
     * Add every whitespace-delimited class from one string to the safelist.
     *
     * @param value Class string.
     */
    function addSafelistClasses(value: string): void {
        for (const className of value.split(/\s+/).filter(Boolean)) {
            addSafelistClass(className);
        }
    }

    /**
     * Collect direct quoted class and sz attributes.
     *
     * @param code Source code.
     */
    function collectQuotedAttributeClasses(code: string): void {
        const patterns = [
            /(?:class(?:Name)?|sz)[:=]\s*"([^"]*)"/g,
            /(?:class(?:Name)?|sz)[:=]\s*'([^']*)'/g,
        ];
        for (const pattern of patterns) {
            for (const match of code.matchAll(pattern)) {
                addSafelistClasses(match[1] ?? '');
            }
        }
    }

    /**
     * Collect quoted class strings inside className expression containers.
     *
     * @param code Source code.
     */
    function collectExpressionClasses(code: string): void {
        for (const match of code.matchAll(/className=\{/g)) {
            const bodyStart = (match.index ?? 0) + match[0].length;
            const expression = code.slice(bodyStart, findJsxExpressionEnd(code, bodyStart));
            for (const stringMatch of expression.matchAll(/"([^"]+)"|'([^']+)'/g)) {
                addSafelistClasses(stringMatch[1] ?? stringMatch[2] ?? '');
            }
        }
    }

    /**
     * Extracts classes from source code into the safelist (state.classes) so
     * Tailwind generates their CSS. This is the regex fallback for files the
     * Babel sz pass did not handle (non-sz files, Vue/Svelte adapter output),
     * where owned and author classes are indistinguishable by regex — so these
     * deliberately do NOT enter ownedClasses and are never mangled.
     * Handles both static patterns (className="...") and expression patterns
     * (className={cond ? "..." : "..."}) which arise from pre-compiled ternary expressions.
     * @param code source code
     */
    function extractClasses(code: string): void {
        collectQuotedAttributeClasses(code);
        collectExpressionClasses(code);
    }

    /**
     * Record raw author classes for safelisting and mangle ownership.
     *
     * @param code Source text before csszyx transforms it.
     */
    function recordAuthoredClasses(code: string): void {
        for (const className of collectAuthoredClassNames(code)) {
            addSafelistClass(className);
            state.authoredClasses.add(className);
        }
    }

    /**
     * Finalizes the mangle map from all collected classes.
     * Always rebuilds to ensure completeness (called after all files
     * processed). The one repeated WASM cost — `encode` per token — is memoized
     * inside `allocateMangleTokens`; the checksum is a single call whose input
     * (the var map) is rebuilt wholesale per CSS file, so it is not safely
     * skippable on a size heuristic and is left to run each time.
     */
    function finalizeMangleMap(): void {
        // Mangle only csszyx-owned classes with no raw author consumer. A shared
        // name can enter both sets, so ownership must be resolved explicitly
        // rather than inferred from its presence in ownedClasses.
        //
        // Forbid as tokens: reserved (external) class names so no mangled alias
        // collides with one, plus every authored AND owned class name so the
        // map's key and token spaces stay disjoint (see allocateMangleTokens).
        const forbiddenTokens = new Set([
            ...mangleReserved,
            ...state.authoredClasses,
            ...state.ownedClasses,
        ]);
        state.mangleMap = allocateMangleTokens(
            mangleEligibleClasses(state.ownedClasses, state.authoredClasses),
            forbiddenTokens,
        );
        assertVarMangleMapSize(state.varMangleMap, varMangleMapMaxBytes);
        state.checksum = compute_mangle_checksum(
            createHydrationMangleMap(state.mangleMap, state.varMangleMap),
        );
        state.finalized = true;
    }

    /**
     * Thin wrapper: supplies state.mangleMap to the exported pure function.
     * @param code - bundled source code to mangle
     * @returns code with mangled class names
     */
    function mangleCodeClasses(code: string): string {
        return mangleCodeClassesSync(code, state.mangleMap);
    }

    /**
     * Mangle a whitespace-separated HTML class attribute value.
     * @param classes - Original attribute value.
     * @returns Attribute value with known classes replaced.
     */
    function mangleHtmlClassList(classes: string): string {
        const output: string[] = [];
        for (const className of classes.split(/\s+/)) {
            if (className) output.push(state.mangleMap[className] || className);
        }
        return output.join(' ');
    }

    /**
     * Replace one double-quoted HTML class attribute.
     * @param match - Complete matched attribute.
     * @param classes - Captured class list.
     * @returns Original or mangled attribute.
     */
    function replaceDoubleQuotedHtmlClass(match: string, classes: string): string {
        const output = mangleHtmlClassList(classes);
        return output !== classes ? `class="${output}"` : match;
    }

    /**
     * Replace one single-quoted HTML class attribute.
     * @param match - Complete matched attribute.
     * @param classes - Captured class list.
     * @returns Original or mangled attribute.
     */
    function replaceSingleQuotedHtmlClass(match: string, classes: string): string {
        const output = mangleHtmlClassList(classes);
        return output !== classes ? `class='${output}'` : match;
    }

    /**
     * Mangle class attributes in one HTML asset.
     * @param source - HTML source.
     * @returns HTML with known class attributes mangled.
     */
    function mangleHtmlClasses(source: string): string {
        return source
            .replace(/\bclass="([^"]*)"/g, replaceDoubleQuotedHtmlClass)
            .replace(/\bclass='([^']*)'/g, replaceSingleQuotedHtmlClass);
    }

    /**
     * Replaces checksum and mangle map placeholders with actual values.
     * @param code code containing placeholders
     * @returns code with placeholders replaced
     */
    function replacePlaceholders(code: string): string {
        let result = code;
        if (result.includes(CHECKSUM_PLACEHOLDER)) {
            result = result.split(CHECKSUM_PLACEHOLDER).join(state.checksum);
        }
        // Webpack's eval devtool wraps each module in eval("…"), so a
        // placeholder there is parsed twice and needs its quotes escaped for
        // the outer string. `eval(` ALONE is not that signal: any production
        // chunk can carry a user eval call, and double-escaping a placeholder
        // that sits in plain code (the bundled mangle-runtime module holds the
        // map in identifier position) is a syntax error in the emitted chunk.
        // The eval devtool always stamps `//# sourceURL=webpack…` inside its
        // wrappers, so require both markers.
        const isEvalWrapped = result.includes('eval(') && result.includes('sourceURL=webpack');
        if (result.includes(MANGLE_MAP_PLACEHOLDER)) {
            // Map keys are class names, and arbitrary-value classes can carry
            // backticks, ${ or </script — escape so the JSON cannot break out
            // of the template literal / script tag it gets pasted into.
            const jsonMap = escapeJsonForInlineScript(JSON.stringify(state.mangleMap));
            const escapedMap = isEvalWrapped ? escapeForDoubleQuotedString(jsonMap) : jsonMap;
            result = result.split(MANGLE_MAP_PLACEHOLDER).join(escapedMap);
        }
        if (result.includes(VAR_MANGLE_MAP_PLACEHOLDER)) {
            const jsonMap = escapeJsonForInlineScript(JSON.stringify(state.varMangleMap));
            const escapedMap = isEvalWrapped ? escapeForDoubleQuotedString(jsonMap) : jsonMap;
            result = result.split(VAR_MANGLE_MAP_PLACEHOLDER).join(escapedMap);
        }
        return result;
    }

    /** Per-module output accumulated before final class discovery. */
    interface PreTransformOutput {
        code: string;
        transformed: boolean;
        usesRuntime: boolean;
        usesMerge: boolean;
        usesSzcn: boolean;
        usesSzPart: boolean;
        usesSzvPick: boolean;
        usesSzvPick1: boolean;
        szPartArgsProvable: boolean;
        usesColorVar: boolean;
        usesSpacingVar: boolean;
        usesUnitVar: boolean;
        szClasses?: Set<string>;
    }

    /**
     * Create the unchanged transform state used by adapter and compiler lanes.
     *
     * @param code Original module source.
     * @returns Transform state with every helper flag disabled.
     */
    function unchangedPreTransform(code: string): PreTransformOutput {
        return {
            code,
            transformed: false,
            usesRuntime: false,
            usesMerge: false,
            usesSzcn: false,
            usesSzPart: false,
            usesSzvPick: false,
            usesSzvPick1: false,
            szPartArgsProvable: true,
            usesColorVar: false,
            usesSpacingVar: false,
            usesUnitVar: false,
        };
    }

    /**
     * Process a Tailwind CSS entry and inject the generated-class source.
     *
     * @param code CSS source.
     * @param id Bundler module identifier.
     * @returns Rewritten CSS result when a directive was added, otherwise null.
     */
    function transformTailwindCssEntry(
        code: string,
        id: string,
    ): { code: string; map: null } | null {
        state.sawAnyCss = true;
        if (!cssImportsTailwind(code)) return null;
        state.sawTailwindEntry = true;
        if (cssHasContentScope(code)) state.tailwindEntryScoped = true;
        if (!hasInjectableTailwindCandidate(state.classes)) return null;

        const relPath = computeSafelistRelPath(state.rootDir, SAFELIST_FILENAME, id);
        const transformed = appendTailwindSourceDirective(code, relPath);
        return transformed === null ? null : { code: transformed, map: null };
    }

    /**
     * Surface compiler diagnostics through their production-safe channels.
     *
     * @param result Compiler transform result.
     * @param id Bundler module identifier.
     * @param warn Bundler warning callback.
     */
    function reportTransformDiagnostics(
        result: SourceTransformResult,
        id: string,
        warn: (message: string) => void,
    ): void {
        for (const message of result.diagnostics) {
            if (message.includes('unresolvable sz spread')) {
                state.spreadWarnings.add(`${id}\n  ${message}`);
                continue;
            }
            if (message.includes('AST budget exceeded')) {
                console.warn(`[csszyx] ${id}\n  ${message}`);
                continue;
            }
            // missing-css means the classes never reached the safelist — the
            // styles are simply absent, which is the failure class that must
            // surface in production builds too (same tier as the spread
            // warning above). Only `quiet: true` silences it; `'nudges'` exists
            // precisely so a calmer log does not have to cost this report.
            emitMissingCssFallback(quiet, message, id, console.warn);
        }
        const advisories = result.diagnostics.filter(isAdvisoryDiagnostic);
        if (advisories.length === 0) return;
        if (quiet !== 'off' || process.env.NODE_ENV === 'production') {
            // Held back, but counted. These are advisory by design — the
            // runtime path works and the classes are collected — so a
            // production build is right not to list them. It is not right to
            // leave the reader believing the fallbacks it DID list are all of
            // them, which is how a site that only ever falls back at an sz prop
            // stays invisible to anyone reading the log.
            state.suppressedAdvisories += advisories.length;
            return;
        }
        for (const message of advisories) {
            warn(`[csszyx] ${id}\n  ${message}`);
        }
    }

    /**
     * Convert a compiler result into the shared pre-transform state.
     *
     * @param result Compiler transform result.
     * @returns Transform output carrying compiler helper usage and classes.
     */
    function compilerPreTransformOutput(result: SourceTransformResult): PreTransformOutput {
        return {
            code: result.code,
            transformed: result.transformed,
            usesRuntime: result.usesRuntime,
            usesMerge: result.usesMerge,
            usesSzcn: result.usesSzcn,
            usesSzPart: result.usesSzPart,
            usesSzvPick: result.usesSzvPick,
            usesSzvPick1: result.usesSzvPick1,
            szPartArgsProvable: result.szPartArgsProvable,
            usesColorVar: result.usesColorVar,
            usesSpacingVar: result.usesSpacingVar,
            usesUnitVar: result.usesUnitVar,
            szClasses: result.classes,
        };
    }

    /**
     * Dispatch one sz-bearing source module to its framework/compiler lane.
     *
     * @param code Source module contents.
     * @param id Bundler module identifier.
     * @param warn Bundler warning callback.
     * @returns Adapter or compiler output with runtime-helper usage.
     */
    function transformSzSource(
        code: string,
        id: string,
        warn: (message: string) => void,
    ): PreTransformOutput {
        if (id.endsWith('.vue')) {
            const result = vuePreprocess(code, options as VueAdapterOptions);
            return { ...unchangedPreTransform(result.code), transformed: result.transformed };
        }
        if (id.endsWith('.svelte')) {
            const result = sveltePreprocess(code, options as SvelteAdapterOptions);
            return result
                ? { ...unchangedPreTransform(result.code), transformed: true }
                : unchangedPreTransform(code);
        }

        const transformStarted = performance.now();
        const result = transformConfiguredSource(code, id);
        traceBenchTiming('transform-hook', id, performance.now() - transformStarted);
        recordFileVarMangleEntries(state, id, cssVariableEntries(result));
        recordFileCSSVariableMetrics(state, id, result.code);
        reportTransformDiagnostics(result, id, warn);
        for (const [token, data] of result.recoveryTokens) state.recoveryTokens.set(token, data);
        return compilerPreTransformOutput(result);
    }

    /**
     * Inject checksum/debug placeholders into an SSR document module.
     *
     * @param code Transformed source module.
     * @param id Bundler module identifier.
     * @returns Rewritten source for a layout document, otherwise null.
     */
    function injectLayoutHydration(code: string, id: string): string | null {
        if (!code.includes('<html') || !/(?:layout|Root|Document|app)\.tsx?$/i.test(id)) {
            return null;
        }
        let transformedCode = code;
        const attrName = options.production?.minify ? 'data-sz-cs' : 'data-sz-checksum';
        const htmlTag = findOpeningTag(transformedCode, 'html');
        if (htmlTag) {
            transformedCode = `${transformedCode.slice(0, htmlTag.close)} ${attrName}="${CHECKSUM_PLACEHOLDER}"${transformedCode.slice(htmlTag.close)}`;
        }

        const debugScript = `<script dangerouslySetInnerHTML={{__html: \`(function(){var m=${MANGLE_MAP_PLACEHOLDER};var vm=${VAR_MANGLE_MAP_PLACEHOLDER};var gp=decodeURIComponent(${escapeJsonForInlineScript(JSON.stringify(encodedGlobalVarAliasPrefix))});var r={};var vr={};for(var k in m)r[m[k]]=k;for(var vk in vm){var vv=vm[vk];var vs=Array.isArray(vv)?vv:[vv];for(var vi=0;vi<vs.length;vi++)(vr[vs[vi]]||(vr[vs[vi]]=[])).push(vk)}window.__csszyx={mangleMap:m,varMangleMap:vm,checksum:"${CHECKSUM_PLACEHOLDER}",decode:function(c){return r[c]},encode:function(c){return m[c]},decodeVar:function(v){return vr[v]||[]},encodeVar:function(v){return vm[v]},decodeGlobalVar:function(v){var a=vr[v]||[];return v.indexOf(gp)===0?a[0]:void 0},decodeAll:function(el){return(el.className||"").split(" ").map(function(c){return r[c]||c})}}})()\`}} />`;
        const bodyTag = findOpeningTag(transformedCode, 'body');
        if (bodyTag) {
            transformedCode = `${transformedCode.slice(0, bodyTag.close + 1)}${debugScript}${transformedCode.slice(bodyTag.close + 1)}`;
        }
        return transformedCode;
    }

    /**
     * Collect runtime helpers required by one compiler transform.
     *
     * @param output Pre-transform helper usage.
     * @returns Runtime export names in stable import order.
     */
    function requiredRuntimeHelpers(output: PreTransformOutput): {
        barrel: string[];
        merge: string[];
    } {
        // A file whose only object-capable emissions are _szPart calls with
        // provably string-or-falsy arguments never lowers at runtime: its
        // merge helpers come from the compiler-free entry, saving the whole
        // browser transform. Any _sz or _szMerge emission keeps the barrel,
        // whose helpers self-register the lowerer.
        return runtimeHelperGroupsFromUsage(output);
    }

    /**
     * Inject compiler runtime helpers that are not already imported.
     *
     * @param code Transformed source module.
     * @param output Pre-transform helper usage.
     * @returns Rewritten source when imports were added, otherwise null.
     */
    function injectRuntimeHelpers(code: string, output: PreTransformOutput): string | null {
        const groups = requiredRuntimeHelpers(output);
        let result: string | null = null;
        let current = code;
        if (groups.merge.length > 0 && !current.includes('@csszyx/runtime/merge')) {
            current = insertRuntimeImport(
                current,
                `import { ${groups.merge.join(', ')} } from '@csszyx/runtime/merge';\n`,
            );
            result = current;
        }
        const imports = groups.barrel;
        const hasRuntimeImport = imports.length > 0 && current.includes('@csszyx/runtime');
        const needed = hasRuntimeImport
            ? imports.filter(name => !importsRuntimeHelper(current, name))
            : imports;
        if (needed.length === 0) return result;

        const existingImport = findRuntimeImportClause(current);
        if (existingImport) {
            return current.replace(
                existingImport.statement,
                `${existingImport.prefixWithBody}, ${needed.join(', ')} } from '@csszyx/runtime'`,
            );
        }
        const importStatement = `import { ${needed.join(', ')} } from '@csszyx/runtime';\n`;
        return insertRuntimeImport(current, importStatement);
    }

    /**
     * The theme token names the registration module carries.
     *
     * One source for the module's payload and for the hot-update comparison
     * that decides whether a stylesheet edit changed anything — building the
     * shape twice is how the two would drift and the reload stop firing.
     *
     * @returns Token names per szcn merge-group category.
     */
    function themeGroupTokens(): ThemeGroupTokens {
        const theme = state.parsedTheme;
        return {
            colors: theme?.colors ?? [],
            textSizes: theme?.textSizes ?? [],
            fontFamilies: theme?.fonts ?? [],
            fontWeights: theme?.fontWeights ?? [],
        };
    }

    /**
     * Inject theme-group registration into modules that can call szcn.
     *
     * @param code Original source used for authored szcn detection.
     * @param transformedCode Current transformed source.
     * @param id Bundler module identifier.
     * @param usesSzcn Whether the compiler emitted szcn usage.
     * @returns Rewritten source when registration is needed, otherwise null.
     */
    function injectThemeGroups(
        code: string,
        transformedCode: string,
        id: string,
        usesSzcn: boolean,
    ): string | null {
        if (
            (!usesSzcn && !/\bszcn\s*\(/.test(code)) ||
            transformedCode.includes(THEME_GROUPS_VIRTUAL_ID) ||
            transformedCode.includes(THEME_GROUPS_FILE_MARKER) ||
            !shouldProcessSource(id)
        ) {
            return null;
        }
        // webpack reads the colon in `virtual:` as a URI scheme and fails the
        // build before any resolve plugin runs — the same reason the
        // mangle-runtime injection is lane-gated. Gating this one off instead
        // would silently cost the lane its theme merge groups, so it gets the
        // registration as a real file, exactly like the Turbopack loader does.
        if (activeFramework === 'webpack') {
            const groups = ensureThemeGroupsFile(
                state.rootDir,
                path.join(state.rootDir, '.csszyx'),
            );
            if (groups.file === null) return null;
            // `split` always yields a first element, so there is nothing to
            // fall back to: an id with no query answers with the whole id.
            const [from] = id.split('?');
            return `import '${themeGroupsSpecifier(from, groups.file)}';\n${transformedCode}`;
        }
        return `import '${THEME_GROUPS_VIRTUAL_ID}';\n${transformedCode}`;
    }

    /** Matches an import/re-export from a package whose runtime helpers read the mangle map. */
    const MANGLE_RUNTIME_CONSUMER_RE = /from\s*['"](?:csszyx|@csszyx\/runtime)['"]/;

    /**
     * Bundler lane this instance is running under, recorded by each lane's
     * entry hook. Gates the mangle-runtime injection: `virtual:`-prefixed
     * imports resolve through rollup-convention hooks, but webpack parses the
     * colon as a URI scheme and fails the build with an UnhandledSchemeError
     * before any resolve plugin runs.
     */
    let activeFramework: 'vite' | 'rollup' | 'webpack' | undefined;

    /**
     * Inject the self-installing mangle map into modules that call runtime
     * helpers. The map otherwise reaches the page only through the transformed
     * HTML document — a delivery path embedded builds and inline-script CSP
     * policies do not have — and without it `szr`/`szv` resolve classes to
     * their original names while the CSS ships mangled (field-reported as
     * silently dropped styles). Importing the module from every helper
     * consumer keeps the map inside the JS bundle, ahead of first helper use
     * in module order; the module itself is checksum-guarded so the HTML
     * script and multiple importers cannot fight.
     *
     * @param transformedCode Current transformed source.
     * @param id Bundler module identifier.
     * @returns Rewritten source when the module needs the map, otherwise null.
     */
    function injectMangleRuntime(transformedCode: string, id: string): string | null {
        // Bundle delivery is rollup-convention only: webpack rejects the
        // `virtual:` specifier (see `activeFramework`), and its lane already
        // delivers the map through the SSR document. esbuild never receives
        // csszyx virtual imports today and is left out until exercised.
        if (activeFramework !== 'vite' && activeFramework !== 'rollup') {
            return null;
        }
        // Guard order is cost order: flag, then the short id, and only then
        // the two scans over module code (this runs for every module of a
        // production build).
        if (
            !manglingEnabled ||
            !deliverMapInBundle ||
            !shouldProcessSource(id) ||
            !MANGLE_RUNTIME_CONSUMER_RE.test(transformedCode) ||
            transformedCode.includes(MANGLE_RUNTIME_VIRTUAL_ID)
        ) {
            return null;
        }
        // After any use directive, not prepended: an import ahead of
        // `'use server'` would demote the directive to a plain string and the
        // RSC boundary guard would misclassify the module.
        return insertRuntimeImport(transformedCode, `import '${MANGLE_RUNTIME_VIRTUAL_ID}';\n`);
    }

    /**
     * Register class candidates and decide whether the hook returns source.
     *
     * @param output Completed pre-transform state.
     * @returns Bundler transform output when class discovery ran, otherwise null.
     */
    function collectPreTransformClasses(
        output: PreTransformOutput,
    ): { code: string; map: null } | null {
        if (
            !output.transformed &&
            !output.code.includes('class=') &&
            !output.code.includes('className=')
        ) {
            return null;
        }
        if (output.szClasses) {
            for (const className of output.szClasses) {
                addSafelistClass(className);
                state.ownedClasses.add(className);
            }
        } else {
            extractClasses(output.code);
        }
        return { code: output.code, map: null };
    }

    const prePlugin = createUnplugin<PartialCsszyxConfig, boolean>(
        (_pluginOptions: PartialCsszyxConfig) => ({
            name: 'csszyx:pre',
            enforce: 'pre',

            /**
             * Resolves virtual module IDs for csszyx mangle-map and checksum modules.
             * @param id - the module ID to resolve
             * @returns resolved ID if virtual, null otherwise
             */
            resolveId(id) {
                if (isVirtualModule(id)) {
                    return resolveVirtualModule(id);
                }
                return null;
            },

            /**
             * Restricts the load hook to csszyx's own virtual modules.
             *
             * Without this, unplugin's webpack adapter registers its load
             * loader with `type: 'javascript/auto'` for every module (its
             * include defaults to all ids when no loadInclude exists). That
             * corrupts binary asset modules (images, fonts) in webpack apps —
             * Next.js builds fail with "not a valid image file" / "Module
             * parse failed" on assets that build fine without csszyx.
             * @param id - the module ID webpack is about to load
             * @returns true only for csszyx virtual modules
             */
            loadInclude(id) {
                return (
                    id === RESOLVED_VIRTUAL_MODULE_ID ||
                    id === RESOLVED_VIRTUAL_CHECKSUM_ID ||
                    id === RESOLVED_THEME_GROUPS_VIRTUAL_ID ||
                    id === RESOLVED_MANGLE_RUNTIME_VIRTUAL_ID
                );
            },

            /**
             * Loads virtual module content — generates mangle map or checksum module code.
             * @param id - the resolved module ID to load
             * @returns generated module source if virtual, null otherwise
             */
            load(id) {
                if (id === RESOLVED_VIRTUAL_MODULE_ID) {
                    finalizeMangleMap();
                    return createMangleMapModule(
                        state.mangleMap,
                        state.checksum,
                        state.varMangleMap,
                        state.cssVarMetrics,
                    );
                }
                if (id === RESOLVED_VIRTUAL_CHECKSUM_ID) {
                    finalizeMangleMap();
                    return createChecksumModule(state.checksum);
                }
                if (id === RESOLVED_MANGLE_RUNTIME_VIRTUAL_ID) {
                    // No finalize here: the module carries placeholders that
                    // output processing fills from the FINAL map, after the
                    // mangle passes have run over the chunk.
                    sizeAccount.channels.add('bundle');
                    return createMangleRuntimeModule(globalVarAliasPrefix);
                }
                if (id === RESOLVED_THEME_GROUPS_VIRTUAL_ID) {
                    return createThemeGroupsModule(themeGroupTokens());
                }
                return null;
            },

            /**
             * Filters files for the pre-transform phase — source files plus CSS files.
             * CSS files need special handling to append an @source directive for Tailwind class discovery.
             * @param id - the file path to check for inclusion
             * @returns true if the file should be transformed, false otherwise
             */
            transformInclude(id) {
                // Handle CSS files to point Tailwind at the discovered-class safelist via @source
                if (shouldProcessCss(id)) {
                    return true;
                }
                // Only handle source files in PRE phase
                if (shouldProcessSource(id)) {
                    return true;
                }
                // The bundler resolved this module, so it is genuinely part of
                // the build even when the prescan never walked its directory —
                // which is the case for a package tree OUTSIDE the project
                // root. Recording the skip here is the only way that layout can
                // ever be reported; the prescan walk alone sees nothing.
                recordPackagesSkipIfSz(id);
                return false;
            },

            /**
             * Core transform: detects sz prop, compiles to className, injects runtime, collects classes.
             * For CSS files: appends an @source directive so Tailwind generates CSS for sz-derived classes.
             * @param code - the source code to transform
             * @param id - the file path of the module being transformed
             * @returns transformed code with source map, or null if no changes were made
             */
            transform(code, id) {
                // Bundlers without the vite/webpack lifecycle hooks (rollup,
                // esbuild) still announce on the first real transform.
                announceActiveParser();
                if (!shouldProcessCss(id) && !shouldProcessSource(id)) {
                    return null;
                }
                if (shouldProcessSource(id)) {
                    trackGlobalVarSourceFile(id, code);
                    recordAuthoredClasses(code);
                }

                if (matchesScriptExtension(id, SCRIPT_ID_EXTENSIONS)) {
                    assertNoRSCBoundaryViolation(code, id);
                }

                if (matchesScriptExtension(id, ['.css'])) {
                    return transformTailwindCssEntry(code, id);
                }

                const hasSzProp =
                    code.includes('sz=') ||
                    code.includes('szs=') ||
                    /\bsz\s*:\s*["'{]/.test(code) ||
                    code.includes('sz: "') ||
                    // szr-only modules (no sz attribute) historically skipped the
                    // compiler entirely — which also skipped the szr import
                    // rewrite AND the szr fallback diagnostics. The substring is
                    // deliberately loose; a false positive only costs one file
                    // the compiler pass, which then changes nothing.
                    code.includes('szr(');
                const output = hasSzProp
                    ? transformSzSource(code, id, message => this.warn(message))
                    : unchangedPreTransform(code);
                if (!hasSzProp && shouldProcessSource(id)) {
                    recordFileVarMangleEntries(state, id, []);
                    recordFileCSSVariableMetrics(state, id, null);
                }

                const layoutCode = injectLayoutHydration(output.code, id);
                if (layoutCode !== null) {
                    output.code = layoutCode;
                    output.transformed = true;
                }

                const runtimeCode = injectRuntimeHelpers(output.code, output);
                if (runtimeCode !== null) {
                    output.code = runtimeCode;
                    output.transformed = true;
                }

                const themedCode = injectThemeGroups(code, output.code, id, output.usesSzcn);
                if (themedCode !== null) {
                    output.code = themedCode;
                    output.transformed = true;
                }

                const mangleRuntimeCode = injectMangleRuntime(output.code, id);
                if (mangleRuntimeCode !== null) {
                    output.code = mangleRuntimeCode;
                    output.transformed = true;
                }

                if (matchesScriptExtension(id, SCRIPT_ID_EXTENSIONS)) {
                    assertNoRSCBoundaryViolation(output.code, id);
                    const record = createRSCModuleRecord(output.code, id);
                    state.rscModules.set(record.id, record);
                }
                return collectPreTransformClasses(output);
            },

            /** Finalizes the mangle map after all source modules have been processed. */
            buildEnd() {
                finalizeMangleMap();
                assertNoRSCGraphViolation(state.rscModules);
                // csszyx rewrites sz props into Tailwind class names, but Tailwind
                // only emits CSS for classes a source/@source covers. The generated
                // classes live in csszyx-classes.html, which nothing imports — so
                // without a CSS entry importing "tailwindcss" (where csszyx injects
                // the @source), the rewritten classes silently resolve to no styles.
                if (
                    !state.tailwindWarningEmitted &&
                    shouldWarnMissingTailwindEntry(
                        state.ownedClasses.size,
                        state.sawTailwindEntry,
                        state.sawAnyCss,
                    )
                ) {
                    state.tailwindWarningEmitted = true;
                    emitWarning(missingTailwindEntryMessage(state.ownedClasses.size));
                }
                // A Tailwind entry exists but does not scope content detection.
                // In a monorepo that silently scans the whole repo (docs included)
                // and can emit phantom/broken url() classes — warn once with the
                // exact fix. The monorepo stat-walk runs only after the cheap
                // conditions pass, and is memoized.
                if (
                    !state.contentScopeWarningEmitted &&
                    options.contentScopeCheck !== false &&
                    state.sawTailwindEntry &&
                    !state.tailwindEntryScoped
                ) {
                    state.inMonorepo ??= isMonorepoPackage(state.rootDir);
                    if (
                        shouldWarnUnscopedMonorepo(
                            state.sawTailwindEntry,
                            state.tailwindEntryScoped,
                            state.inMonorepo,
                        )
                    ) {
                        state.contentScopeWarningEmitted = true;
                        emitWarning(unscopedMonorepoMessage());
                    }
                }
                // Workspace-package source under /packages/ is hard-ignored, so its
                // sz silently produces no CSS unless its dir is in compileSources.
                // Surface the skipped files once so the no-op is visible.
                if (!state.skipWarningEmitted && state.skippedSzFiles.size > 0) {
                    state.skipWarningEmitted = true;
                    // Gated by consequence. A skipped file that only carries its
                    // own `sz` is a usage nudge — dev-only, so it never noises a
                    // host app's production build. A skipped file that may EXPORT
                    // szv factories also drops every importer's precompile, which
                    // is missing csszyx output rather than a nudge, and a field
                    // report cost an afternoon of bisecting because the
                    // production build said nothing.
                    emitWarning(
                        skippedSzFilesMessage(
                            sortStrings(state.skippedSzFiles),
                            sortStrings(state.skippedSzvExportFiles),
                        ),
                        { devOnly: state.skippedSzvExportFiles.size === 0 },
                    );
                }
                // The safelist hit its hard cap; extra classes were dropped. This
                // only happens on pathological/hostile class cardinality — surface
                // it so the (otherwise silent) truncation is visible.
                if (state.classesCapped) {
                    emitWarning(
                        `[csszyx] safelist exceeded ${MAX_SAFELIST_CLASSES} classes; ` +
                            'additional classes were dropped. This usually means an ' +
                            'unbounded set of arbitrary values reached an sz prop.',
                    );
                }
                // Surface unresolvable-spread warnings to the build log in every
                // mode (collected during transform). The build log is not the
                // shipped bundle, so this never leaks paths to end users.
                for (const warning of state.spreadWarnings) {
                    emitWarning(`[csszyx] ${warning}`);
                }
                state.spreadWarnings.clear();
                // Drop prescan results the bundler never asked to transform
                // (unimported files) — each retains a full transformed-code
                // string, and the handoff's job ended with this build.
                prescanResultHandoff.clear();
                // Expose the mangle map as a Node.js global so that dynamic() SSR calls
                // (which run in the same process during Astro/Next.js SSG) can resolve
                // original class names to their mangled equivalents. Without this, dynamic()
                // in SSR returns unmangled names (e.g. "p-4") while the built CSS only has
                // mangled selectors (e.g. ".q0"), causing styles to silently not apply.
                if (manglingEnabled && Object.keys(state.mangleMap).length > 0) {
                    (globalThis as Record<string, unknown>).__csszyx_ssr_mangle_map =
                        state.mangleMap;
                }
            },

            watchChange(id, change) {
                if (change.event === 'delete') {
                    deleteRSCModuleRecord(state.rscModules, id);
                    recordGlobalVarSourceFile(state, id, null);
                    recordFileVarMangleEntries(state, id, []);
                    recordFileCSSVariableMetrics(state, id, null);
                    refreshSzvRegistryEntry(id, null);
                    return;
                }
                // The rollup-family lanes: `vite build --watch` and `rollup -w`,
                // where `handleHotUpdate` never fires. Runs before the rebuild,
                // so importers re-transform against the refreshed table rather
                // than the one from startup.
                refreshSzvRegistryEntryFromDisk(id);
            },

            /**
             * Webpack hook: pre-scans source files before compilation for Tailwind class discovery.
             * @param compiler - the Webpack compiler instance
             */
            webpack(compiler: WebpackCompiler) {
                activeFramework = 'webpack';
                // Write the szcn theme-group registration now, not when the
                // first module that imports it is transformed. webpack caches
                // transformed modules across builds, so a rebuild can replay an
                // already-injected import WITHOUT running the transform that
                // creates the file — and if anything removed the generated
                // directory in between (a clean script that spares webpack's own
                // cache is enough), the build fails on a module nobody touched.
                // Producing it at lane entry makes its existence a property of
                // the build rather than of what happened to be recompiled.
                compiler.hooks?.beforeCompile?.tap?.('csszyx:theme-groups', () => {
                    // The compiler's own context, not `state.rootDir`: that is
                    // assigned by another hook on this same event, and tap order
                    // follows registration order, so reading it here would
                    // depend on which of the two was wired first.
                    const root = compiler.context || process.cwd();
                    ensureThemeGroupsFile(root, path.join(root, '.csszyx'));
                });
                // Never mangle in a development-mode webpack build — the same
                // reason as the `vite serve` guard: dev CSS is unmangled, so a
                // delivered runtime map would encode classes to tokens no dev
                // rule matches. Asset mangling was already mode-gated, but the
                // bundled mangle-runtime module now DELIVERS the map through
                // the JS bundle, which the HTML lane's absence in webpack dev
                // used to prevent by accident.
                if (compiler.options?.mode === 'development') {
                    manglingEnabled = false;
                }
                // Delivery is decided by the vite/rollup hooks (module
                // injection + transformIndexHtml); this lane ships the map the
                // way it always did, so a narrowed value would silently not
                // narrow anything.
                if (manglingEnabled && mangleMapDelivery !== 'both') {
                    console.warn(
                        `[csszyx] production.mangleMapDelivery: '${mangleMapDelivery}' has no ` +
                            'effect on the webpack lane — map delivery only narrows on vite/rollup builds.',
                    );
                }
                compiler.hooks.beforeCompile.tap('csszyx:prescan', () => {
                    announceActiveParser();
                    const root = compiler.context || process.cwd();
                    state.rootDir = root;
                    // Next.js maps `@/*` with a resolver plugin rather than an
                    // alias table, so webpack's own alias object is empty on the
                    // framework that needs this most; `collectSpecifierAliases`
                    // reads tsconfig for exactly that case.
                    specifierAliases = collectSpecifierAliases(
                        root,
                        compiler.options?.resolve?.alias,
                    );
                    evictTransformCacheOnce();
                    if (state.classes.size === 0) {
                        prescanAndWriteClasses();
                    }
                    // A rebuild skips the prescan above, so an edited factory
                    // would keep serving importers its startup table. webpack
                    // hands the watcher's changed set straight to this hook;
                    // refresh those entries before any module re-transforms.
                    for (const changed of compiler.modifiedFiles ?? []) {
                        refreshSzvRegistryEntryFromDisk(changed);
                    }
                    for (const removed of compiler.removedFiles ?? []) {
                        refreshSzvRegistryEntry(removed, null);
                    }
                    // Generate theme type augmentation from @theme CSS blocks
                    state.scanCssTheme =
                        runThemeScan(root, options.build?.scanCss) ?? state.scanCssTheme;
                    // Always: project-wide @theme discovery feeds merge groups.
                    runAutoThemeScan(root);
                });
                // Register scanned CSS files as Webpack file dependencies so HMR triggers on changes
                if (options.build?.scanCss) {
                    compiler.hooks.thisCompilation.tap('csszyx:theme-deps', compilation => {
                        const root = compiler.context || process.cwd();
                        for (const file of expandFilePatterns(root, options.build?.scanCss ?? [])) {
                            compilation.fileDependencies.add(file);
                        }
                    });
                }
            },

            rollup: {
                /** Records the rollup lane for the mangle-runtime gate. */
                buildStart() {
                    // A watch rebuild reuses the one prescan registry forever:
                    // an edited factory module would keep serving its OLD
                    // variant table to every importer, and the transform cache
                    // would key on the stale value. The v1 cut (no
                    // registry-dependency invalidation) therefore extends to
                    // watch mode — `rollup -w` here, and vite build --watch
                    // through the same rollup context.
                    activeFramework = 'rollup';
                },
            },

            vite: {
                /**
                 * Vite hook: pre-scans source files when config is resolved.
                 * Also runs theme scan to generate .csszyx/theme.d.ts if scanCss is configured.
                 * @param config - the resolved Vite configuration object
                 */
                configResolved(config) {
                    activeFramework = 'vite';
                    announceActiveParser();
                    const root = config.root || process.cwd();
                    state.rootDir = root;
                    // Vite has already normalized `resolve.alias` into its array
                    // form here, which is also the form this reads — taking it
                    // from the RESOLVED config means an alias another plugin
                    // added is honoured exactly as the build will resolve it.
                    specifierAliases = collectSpecifierAliases(root, config.resolve?.alias);
                    // Never mangle in a dev server — the runtime mangle map would
                    // not match the un-mangled dev CSS. See `manglingEnabled` above.
                    if (config.command === 'serve') {
                        manglingEnabled = false;
                    }
                    evictTransformCacheOnce();
                    // Pre-scan source files so Tailwind can discover classes
                    prescanAndWriteClasses();
                    // Generate theme type augmentation from @theme CSS blocks
                    state.scanCssTheme =
                        runThemeScan(root, options.build?.scanCss) ?? state.scanCssTheme;
                    // Always: project-wide @theme discovery feeds merge groups.
                    runAutoThemeScan(root);
                },

                /**
                 * Vite HMR hook: re-runs theme scan when a watched CSS file changes,
                 * and incrementally updates csszyx-classes.html when a source file gains new sz classes.
                 * @param ctx - HMR context containing the changed file
                 */
                handleHotUpdate(ctx) {
                    // First edit = the initial module-load wave is over; any
                    // handoff entries left belong to files the dev server
                    // never imported, and each retains a transformed-code
                    // string for nothing.
                    prescanResultHandoff.clear();
                    // Theme scan for @theme CSS blocks
                    const scanCss = options.build?.scanCss;
                    /**
                     * Reloads the generated registration module: adding or
                     * removing theme tokens changes the szcn merge groups, so
                     * a dev server must pick them up without a restart.
                     */
                    const reloadThemeGroupsModule = (): void => {
                        const themeGroupsModule = ctx.server.moduleGraph.getModuleById(
                            RESOLVED_THEME_GROUPS_VIRTUAL_ID,
                        );
                        if (themeGroupsModule) {
                            ctx.server.moduleGraph.invalidateModule(themeGroupsModule);
                        }
                    };
                    if (ctx.file.endsWith('.css')) {
                        // ANY css edit may add or remove @theme tokens, including
                        // in a file `scanCss` does not list and one the scan has
                        // not seen yet — so re-discover project-wide either way.
                        // A file that IS listed additionally refreshes the typing
                        // scan, which is what rewrites `.csszyx/theme.d.ts`.
                        const root = ctx.server.config.root || process.cwd();
                        const before = createThemeGroupsModule(themeGroupTokens());
                        if (scanCss && matchesAnyPattern(ctx.file, scanCss, root)) {
                            state.scanCssTheme = runThemeScan(root, scanCss) ?? state.scanCssTheme;
                        }
                        runAutoThemeScan(root);
                        reloadThemeGroupsModule();
                        // Invalidating is not enough. A stylesheet edit is a CSS
                        // hot update: Vite swaps the styles and never re-executes
                        // a JS module, so the registration the page booted with
                        // stays in memory and a DELETED token keeps grouping
                        // classes the stylesheet no longer defines. Only a reload
                        // re-runs it — and only when the tokens actually changed,
                        // so ordinary CSS edits keep the hot update they should.
                        if (createThemeGroupsModule(themeGroupTokens()) !== before) {
                            ctx.server.ws.send({ type: 'full-reload' });
                        }
                    }

                    // Incremental sz class discovery: when a source file changes, scan it
                    // immediately and update csszyx-classes.html if new classes are found.
                    // This ensures Tailwind generates CSS for new sz props without a dev restart.
                    // handleHotUpdate fires before the module is re-transformed, so we must
                    // read and transform the file ourselves to discover any new classes.
                    if (!shouldProcessSource(ctx.file)) {
                        return;
                    }

                    let fileContent: string, result: SourceTransformResult;
                    try {
                        fileContent = fs.readFileSync(ctx.file, 'utf-8');
                    } catch {
                        refreshSzvRegistryEntry(ctx.file, null);
                        return;
                    }

                    // Before the importers re-transform: an edited factory must
                    // not serve them the table it had at server start. Reuses
                    // the read above, and runs ahead of the `sz` marker gate
                    // below because a module of pure `szv` factories carries
                    // none of those markers.
                    //
                    // Vite also calls `watchChange` in dev, so in THIS version
                    // either path alone would do — verified by disabling each
                    // in turn. They are kept because their lane coverage
                    // differs, not for redundancy: `handleHotUpdate` never
                    // fires for `vite build --watch` or `rollup -w`, and a
                    // bundler version that stops calling one must not silently
                    // bring the staleness back.
                    refreshSzvRegistryEntry(ctx.file, fileContent);

                    if (
                        !fileContent.includes('sz=') &&
                        !fileContent.includes('szs=') &&
                        !/\bsz\s*:\s*["'{]/.test(fileContent)
                    ) {
                        trackGlobalVarSourceFile(ctx.file, fileContent);
                        recordFileVarMangleEntries(state, ctx.file, []);
                        recordFileCSSVariableMetrics(state, ctx.file, null);
                        return;
                    }

                    try {
                        const hmrTransformStarted = performance.now();
                        result = transformConfiguredSource(fileContent, ctx.file);
                        traceBenchTiming(
                            'handle-hot-update',
                            ctx.file,
                            performance.now() - hmrTransformStarted,
                        );
                    } catch {
                        trackGlobalVarSourceFile(ctx.file, fileContent);
                        recordFileVarMangleEntries(state, ctx.file, []);
                        recordFileCSSVariableMetrics(state, ctx.file, null);
                        return;
                    }

                    if (!result.transformed) {
                        trackGlobalVarSourceFile(ctx.file, fileContent);
                        recordFileVarMangleEntries(state, ctx.file, []);
                        recordFileCSSVariableMetrics(state, ctx.file, null);
                        return;
                    }

                    const sizeBefore = state.classes.size;
                    trackGlobalVarSourceFile(ctx.file, fileContent);
                    for (const cls of result.classes) {
                        addSafelistClass(cls);
                        state.ownedClasses.add(cls);
                    }
                    recordFileVarMangleEntries(state, ctx.file, cssVariableEntries(result));
                    recordFileCSSVariableMetrics(state, ctx.file, result.code);
                    for (const [token, data] of result.recoveryTokens) {
                        state.recoveryTokens.set(token, data);
                    }

                    if (state.classes.size > sizeBefore) {
                        // New classes found — update manifest so Tailwind regenerates CSS
                        writeSafelistFile(state.classes);
                        // Emit a synthetic watcher event on the manifest file so Tailwind's
                        // internal file scanner (which listens on ctx.server.watcher) picks up
                        // the change immediately, even if the OS fs event arrives with a delay.
                        const safelistPath = path.join(state.rootDir, SAFELIST_FILENAME);
                        ctx.server.watcher.emit('change', safelistPath);
                    }
                },
                transformIndexHtml: {
                    order: 'pre',
                    /**
                     * Injects hydration data (mangle map + checksum) into the HTML document.
                     * Also mangles class attributes in SSR-rendered HTML so they match mangled CSS selectors.
                     * @param html - the raw HTML string to transform
                     * @returns transformed HTML with injected hydration data
                     */
                    handler(html) {
                        finalizeMangleMap();
                        // Empty the CLASS mangle map when mangling is off (explicitly,
                        // or forced off in a dev server) so `szr`/`decode` are identity
                        // and the runtime class names match the un-mangled Tailwind CSS.
                        // The CSS-VARIABLE mangle map is left intact: csszyx owns both
                        // the runtime var name and the CSS it emits for it (Tailwind
                        // never touches `--_sz-*`), so it is self-consistent in dev and
                        // needs no fallback.
                        const injectedMangleMap = manglingEnabled ? state.mangleMap : {};
                        let result = injectHydrationData(html, injectedMangleMap, state.checksum, {
                            // Always 'script'; the checksum itself is injected by
                            // injectHydrationData regardless of this mode.
                            mode: 'script',
                            minify: process.env.NODE_ENV === 'production',
                            varMangleMap: state.varMangleMap,
                            globalVarAliasPrefix,
                            installRuntimeObject: deliverMapInHtml,
                        });
                        // The hydration-verify contract reads the JSON tag from
                        // the DOM, so the census ships in the HTML whenever the
                        // page is built here — 'bundle' only drops the runtime
                        // installer. Charge the channel accordingly, or the
                        // advisory understates what actually shipped.
                        if (manglingEnabled) {
                            sizeAccount.channels.add('html');
                        }
                        // Recovery manifest is a no-op when zero szRecover tokens were
                        // emitted across the build, so pages without recovery sites get
                        // no extra script tag. In production, dev-only tokens are stripped
                        // and a single rolled-up warning lists the affected paths.
                        if (state.recoveryTokens.size > 0) {
                            const isProduction = process.env.NODE_ENV === 'production';
                            const { manifest, strippedDevOnlyPaths } = buildRecoveryManifest(
                                state.recoveryTokens,
                                {
                                    production: isProduction,
                                    mangleChecksum: state.checksum,
                                },
                            );
                            if (strippedDevOnlyPaths.length > 0) {
                                console.warn(
                                    `[csszyx] Stripped ${strippedDevOnlyPaths.length} ` +
                                        'szRecover="dev-only" token(s) from the production manifest. ' +
                                        'Recovery for these elements is disabled in production by design. ' +
                                        `Sites: ${strippedDevOnlyPaths.join(', ')}`,
                                );
                            }
                            result = injectRecoveryManifest(result, manifest);
                        }
                        return result;
                    },
                },
            },
        }),
    );

    /**
     * Build the manifest shared by Vite and Webpack output hooks.
     *
     * @param includeMangleMap Whether class mangling applies to this output.
     * @returns Complete dynamic-runtime manifest for the current plugin state.
     */
    function createBundleManifest(includeMangleMap: boolean): CSSzyxBundleManifest {
        const manifest: CSSzyxBundleManifest = {
            version: '0.4.0',
            buildId: state.checksum,
            classes: Object.keys(state.mangleMap),
        };
        if (includeMangleMap && Object.keys(state.mangleMap).length > 0) {
            manifest.mangleMap = state.mangleMap;
        }
        if (Object.keys(state.varMangleMap).length > 0) {
            manifest.varMangleMap = state.varMangleMap;
        }
        const globalVarAliases = extractGlobalVarAliasesForManifest(
            state.varMangleMap,
            globalVarAliasPrefix,
            state.globalVarValidationResult,
        );
        if (Object.keys(globalVarAliases).length > 0) {
            manifest.globalVarAliases = globalVarAliases;
        }
        if (hasCSSVariableMetrics(state.cssVarMetrics)) {
            manifest.cssVarMetrics = state.cssVarMetrics;
        }
        return manifest;
    }

    /**
     * Rewrite one code asset's class strings, weighing what the shortening saved.
     *
     * Shared by both output lanes because they do the same thing to the same
     * kind of asset — a rollup chunk and a webpack `.js` asset — and the
     * measurement has to agree between them or the advisory's figure depends on
     * the bundler.
     *
     * The map substitution runs on BOTH sides of the comparison. Its bytes are
     * charged once as `mapCost`, so letting them appear on only the "after"
     * side would bill the same payload twice and report a cost that is mostly
     * the map counted again.
     *
     * @param source - Asset source as the bundler produced it.
     * @param shouldMangle - Whether class mangling applies to this output.
     * @returns The rewritten source.
     */
    function rewriteCodeAsset(source: string, shouldMangle: boolean): string {
        if (!shouldMangle) return replacePlaceholders(source);
        const before = replacePlaceholders(source);
        const after = replacePlaceholders(mangleCodeClasses(source));
        recordCodePair(sizeAccount, before, after);
        return after;
    }

    /**
     * Rewrite one emitted CSS asset and collect hybrid-mangle ownership evidence.
     *
     * @param source Original CSS source.
     * @param file Output filename.
     * @param shouldMangle Whether class mangling applies to this output.
     * @param mangledSources Classes rewritten by csszyx.
     * @param externalClasses Classes left under external ownership.
     * @returns Rewritten CSS, or the original source after an ignorable syntax error.
     */
    function rewriteOutputCss(
        source: string,
        file: string,
        shouldMangle: boolean,
        mangledSources: Set<string>,
        externalClasses: Set<string>,
    ): string {
        const css = rewriteCssWithValidatedGlobalVarPlan(
            source,
            file,
            state.globalVarValidationResult,
        );
        if (!shouldMangle) return css;
        try {
            const result = mangleCSSSync(css, state.mangleMap, {
                debug: options.development?.debug,
                from: file,
            });
            for (const className of result.mangledClasses) mangledSources.add(className);
            for (const className of result.unmangledClasses) externalClasses.add(className);
            const mangled = result.transformedCount > 0 ? result.css : css;
            recordCssPair(sizeAccount, css, mangled);
            return mangled;
        } catch (error) {
            if (isCssSyntaxError(error)) return css;
            throw error;
        }
    }

    /**
     * Emit the hybrid ownership warning after every CSS asset is observed.
     *
     * @param shouldMangle Whether class mangling applies to this output.
     * @param mangledSources Classes rewritten by csszyx.
     * @param externalClasses Classes left under external ownership.
     */
    function reportOutputMangleHazards(
        shouldMangle: boolean,
        mangledSources: Set<string>,
        externalClasses: Set<string>,
    ): void {
        if (!shouldMangle) return;
        const message = mangleHybridHazardMessage(
            collectMangleHybridHazards(state.mangleMap, mangledSources, externalClasses),
        );
        if (message) console.warn(message);
    }

    /**
     * Say what the build did, once, where a reader is looking.
     *
     * Called from each lane's last moment rather than from the passes that
     * produce the numbers, because WHERE these land decides whether anyone
     * reads them. On the Vite lane the rewrite happens in `generateBundle`,
     * which prints ahead of the asset table — so the one figure that answers
     * "did mangling help" arrived before the table a reader compares to answer
     * that question, wedged between other `[csszyx]` lines. `closeBundle` runs
     * after the table.
     *
     * Both halves stay quiet when there is nothing to disclose: a build that
     * got what it paid for and held nothing back prints neither line.
     */
    function reportBuildSummary(): void {
        reportMangleSize();
        // Blunt mode asked for silence and gets it; `'nudges'` asked for a
        // calmer log, and one line saying how much was left out is the opposite
        // of noise — it is what stops the calm log from reading as a clean one.
        if (resolveQuietMode(quiet) !== 'all') {
            const message = suppressedAdvisoryMessage(state.suppressedAdvisories);
            if (message) console.warn(message);
        }
        state.suppressedAdvisories = 0;
    }

    /**
     * Tell the build what mangling actually cost, once every asset is weighed.
     *
     * @see reportBuildSummary for where this lands and why.
     */
    function reportMangleSize(): void {
        const verdict = computeMangleSizeVerdict(
            sizeAccount,
            JSON.stringify(createHydrationMangleMap(state.mangleMap, state.varMangleMap)),
        );
        const message = mangleSizeMessage(verdict);
        if (message) console.warn(message);
        // Each output pass weighs its own assets; see resetMangleSizeAccount.
        resetMangleSizeAccount(sizeAccount);
    }

    /**
     * Rewrite one non-CSS Webpack asset in its final output phase.
     *
     * @param file Output filename.
     * @param source Original asset source.
     * @param shouldMangle Whether class mangling applies to this output.
     * @param compilation Active Webpack compilation.
     * @param compiler Active Webpack compiler.
     */
    function rewriteWebpackCodeAsset(
        file: string,
        source: string,
        shouldMangle: boolean,
        compilation: WebpackCompilation,
        compiler: WebpackCompiler,
    ): void {
        if (shouldMangle && file.endsWith('.html')) {
            const mangledHtml = mangleHtmlClasses(source);
            if (mangledHtml !== source) {
                compilation.updateAsset(file, new compiler.webpack.sources.RawSource(mangledHtml));
            }
            return;
        }
        if (!file.endsWith('.js')) return;

        const rewritten = rewriteCodeAsset(source, shouldMangle);
        if (rewritten !== source) {
            compilation.updateAsset(file, new compiler.webpack.sources.RawSource(rewritten));
        }
    }

    /**
     * Process all Webpack assets after the full class map is available.
     *
     * @param assets Webpack output assets.
     * @param compilation Active Webpack compilation.
     * @param compiler Active Webpack compiler.
     */
    function processWebpackAssets(
        assets: WebpackCompilation['assets'],
        compilation: WebpackCompilation,
        compiler: WebpackCompiler,
    ): void {
        finalizeMangleMap();
        state.globalVarValidationResult = validateGlobalVarBundleInputs(
            collectWebpackGlobalVarCssAssets(assets),
        );
        const shouldMangle =
            manglingEnabled &&
            compiler.options.mode !== 'development' &&
            Object.keys(state.mangleMap).length > 0;
        const manifest = createBundleManifest(shouldMangle);
        compilation.emitAsset(
            'csszyx-manifest.json',
            new compiler.webpack.sources.RawSource(JSON.stringify(manifest)),
        );
        if (shouldEmitGlobalVarMapAsset(globalVarMangleConfig)) {
            const globalVarMap = createGlobalVarMapAssetSource(
                state.varMangleMap,
                globalVarAliasPrefix,
                state.globalVarValidationResult,
            );
            if (globalVarMap) {
                compilation.emitAsset(
                    '.csszyx/global-var-map.json',
                    new compiler.webpack.sources.RawSource(globalVarMap),
                );
            }
        }

        const mangledSources = new Set<string>();
        const externalClasses = new Set<string>();
        for (const file in assets) {
            const source = assets[file].source().toString();
            if (file.endsWith('.css')) {
                const css = rewriteOutputCss(
                    source,
                    file,
                    shouldMangle,
                    mangledSources,
                    externalClasses,
                );
                if (css !== source) {
                    compilation.updateAsset(file, new compiler.webpack.sources.RawSource(css));
                }
            } else {
                rewriteWebpackCodeAsset(file, source, shouldMangle, compilation, compiler);
            }
        }
        reportOutputMangleHazards(shouldMangle, mangledSources, externalClasses);
        // Webpack has no post-write hook in this plugin and prints no asset
        // table of its own, so the reason the Vite lane defers does not apply:
        // here the end of asset processing IS the end of the build's output.
        reportBuildSummary();
    }

    /**
     * Rewrite one Vite bundle entry after the mangle map is complete.
     *
     * @param chunk Rollup output entry.
     * @param file Output filename.
     * @param shouldMangle Whether class mangling applies to this output.
     * @param mangledSources Classes rewritten by csszyx.
     * @param externalClasses Classes left under external ownership.
     */
    function rewriteViteBundleEntry(
        chunk: ViteBundleEntryLike,
        file: string,
        shouldMangle: boolean,
        mangledSources: Set<string>,
        externalClasses: Set<string>,
    ): void {
        if (
            chunk.type === 'asset' &&
            chunk.fileName.endsWith('.css') &&
            chunk.source !== undefined
        ) {
            const originalCss = chunk.source.toString();
            const css = rewriteOutputCss(
                originalCss,
                file,
                shouldMangle,
                mangledSources,
                externalClasses,
            );
            if (css !== originalCss) chunk.source = css;
            return;
        }
        if (chunk.type !== 'chunk' || chunk.code === undefined) return;

        const rewritten = rewriteCodeAsset(chunk.code, shouldMangle);
        if (rewritten !== chunk.code) chunk.code = rewritten;
    }

    /**
     * Process a complete Vite bundle after all source modules were observed.
     *
     * @param bundle Rollup output bundle.
     * @param emitAsset Asset emitter supplied by the Rollup-compatible hook context.
     */
    function processRollupBundle(
        bundle: ViteOutputBundleLike,
        emitAsset: (fileName: string, source: string) => void,
    ): void {
        finalizeMangleMap();
        state.globalVarValidationResult = validateGlobalVarBundleInputs(
            collectRollupGlobalVarCssAssets(bundle),
        );
        const shouldMangle = manglingEnabled && Object.keys(state.mangleMap).length > 0;
        // Opt-in: only `@csszyx/dynamic` reads this, and only to skip injecting
        // rules the built CSS already has. The file carries the whole class
        // census to answer questions about the few classes `dynamic()` renders,
        // so on a measured 668-class census it costs ~2 kB gz to spare a few
        // hundred bytes of injection. A missing manifest is not a failure —
        // `dynamic()` injects instead, and the styles are identical.
        if (options.build?.emitManifest === true) {
            emitAsset('csszyx-manifest.json', JSON.stringify(createBundleManifest(shouldMangle)));
        }
        if (shouldEmitGlobalVarMapAsset(globalVarMangleConfig)) {
            const globalVarMap = createGlobalVarMapAssetSource(
                state.varMangleMap,
                globalVarAliasPrefix,
                state.globalVarValidationResult,
            );
            if (globalVarMap) emitAsset('.csszyx/global-var-map.json', globalVarMap);
        }

        const mangledSources = new Set<string>();
        const externalClasses = new Set<string>();
        for (const file in bundle) {
            rewriteViteBundleEntry(
                bundle[file],
                file,
                shouldMangle,
                mangledSources,
                externalClasses,
            );
        }
        reportOutputMangleHazards(shouldMangle, mangledSources, externalClasses);
    }

    const postPlugin = createUnplugin<PartialCsszyxConfig, boolean>(() => ({
        name: 'csszyx:post',
        enforce: 'post',

        // No transform hook — all mangling is deferred to asset processing
        // where the complete mangle map is available.

        /**
         * Webpack hook: mangles CSS/JS class names in processAssets after compilation.
         * @param compiler - the Webpack compiler instance
         */
        webpack(compiler: WebpackCompiler) {
            registerWebpackAssetProcessor(compiler, processWebpackAssets);
        },

        /**
         * Rollup-compatible hook used by both pure Rollup and Vite adapters.
         *
         * @param this Rollup-compatible output hook context.
         * @param this.emitFile Output asset emitter.
         * @param _options Output options (unused).
         * @param bundle Complete Rollup output bundle.
         */
        generateBundle(
            this: {
                emitFile(file: { type: 'asset'; fileName: string; source: string }): string;
            },
            _options: unknown,
            bundle: ViteOutputBundleLike,
        ) {
            processRollupBundle(bundle, (fileName, source) => {
                this.emitFile({ type: 'asset', fileName, source });
            });
        },

        /**
         * Report what mangling cost, after the bundler has printed its assets.
         *
         * Vite's reporter prints the asset table from `writeBundle`, which runs
         * before this hook — so the size verdict lands where a reader is
         * already looking at sizes, instead of scrolling past mid-build among
         * the other diagnostics.
         */
        closeBundle() {
            reportBuildSummary();
        },
    }));

    return { prePlugin, postPlugin };
}

// Export a single instance for default use (compatibility)
const defaultInstance = createCsszyxPlugins();
export const unplugin: UnpluginInstance<PartialCsszyxConfig, boolean> = defaultInstance.prePlugin; // Fallback

/**
 * Creates a Vite plugin array with both pre-transform and post-mangle plugins.
 * @param options - csszyx configuration options
 * @returns array of Vite plugins for pre-transform and post-mangle phases
 */
export const vitePlugin = (options: PartialCsszyxConfig = {}): PluginOption[] => {
    const { prePlugin, postPlugin } = createCsszyxPlugins(options);
    // Vite can handle arrays directly in plugins config
    return [prePlugin.vite(options), postPlugin.vite(options)] as unknown as PluginOption[];
};

/**
 * Creates a combined Webpack plugin that applies both pre-transform and post-mangle phases.
 * @param options - csszyx configuration options
 * @returns a Webpack plugin instance combining both phases
 */
export const webpackPlugin = (options: PartialCsszyxConfig = {}): WebpackPluginInstance => {
    const { prePlugin, postPlugin } = createCsszyxPlugins(options);
    return {
        /**
         * Applies both pre and post plugins to the Webpack compiler.
         * @param compiler - the Webpack compiler instance to apply plugins to
         */
        apply(compiler: WebpackCompiler) {
            prePlugin.webpack(options).apply(compiler);
            postPlugin.webpack(options).apply(compiler);
        },
    };
};

/**
 * Creates a Rollup plugin array with both pre-transform and post-mangle plugins.
 * @param options - csszyx configuration options
 * @returns array of Rollup plugins for pre-transform and post-mangle phases
 */
export const rollupPlugin = (options: PartialCsszyxConfig = {}): InputPluginOption[] => {
    const { prePlugin, postPlugin } = createCsszyxPlugins(options);
    return [
        prePlugin.rollup(options),
        postPlugin.rollup(options),
    ] as unknown as InputPluginOption[];
};

/**
 * Creates an esbuild plugin that delegates setup to both pre-transform and post-mangle plugins.
 * @param options - csszyx configuration options
 * @returns an esbuild plugin combining both pre-transform and post-mangle phases
 */
export const esbuildPlugin = (options: PartialCsszyxConfig = {}): EsbuildPlugin => {
    if (options.production?.mangle === true) {
        console.warn(
            '[csszyx] production.mangle is not supported by the esbuild adapter; ' +
                'class mangling is disabled so emitted JS and CSS keep matching names.',
        );
    }
    const safeOptions: PartialCsszyxConfig = {
        ...options,
        production: { ...options.production, mangle: false },
    };
    const { prePlugin, postPlugin } = createCsszyxPlugins(safeOptions);
    return {
        name: 'csszyx',
        /**
         * Registers both pre and post plugin setup hooks with the esbuild build.
         * @param build - the esbuild plugin build context
         */
        setup(build: PluginBuild) {
            // `unplugin` resolves esbuild via vite's hoisted esbuild@0.21.x while our
            // local peer is esbuild@0.27.x — type-incompatible but identical at runtime.
            const b = build as unknown as Parameters<
                ReturnType<typeof prePlugin.esbuild>['setup']
            >[0];
            prePlugin.esbuild(safeOptions).setup(b);
            postPlugin.esbuild(safeOptions).setup(b);
        },
    };
};
