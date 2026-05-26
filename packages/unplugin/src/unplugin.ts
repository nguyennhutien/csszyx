import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
    type CssVariableMangleValue,
    ensureRustTransformAvailable,
    type SourceTransformResult,
    type TokenData,
    type TransformSourceCodeOptions,
    transform,
    transformOxc,
    transformRust,
    transformRustBatch,
    transformSourceCode,
} from '@csszyx/compiler';
import { compute_mangle_checksum, encode } from '@csszyx/core';
import { type SvelteAdapterOptions, preprocess as sveltePreprocess } from '@csszyx/svelte-adapter';
import { DEFAULT_BUILD_CONFIG, type PartialCsszyxConfig } from '@csszyx/types';
import { type VueAdapterOptions, preprocess as vuePreprocess } from '@csszyx/vue-adapter';
import type { Plugin as EsbuildPlugin, PluginBuild } from 'esbuild';
import type { InputPluginOption } from 'rollup';
import { createUnplugin, type UnpluginInstance, type WebpackPluginInstance } from 'unplugin';
import type { PluginOption } from 'vite';
import type { Compiler as WebpackCompiler } from 'webpack';

import { mangleCSSSync } from './css-mangler.js';
import { expandFilePatterns, matchesAnyPattern } from './file-patterns.js';
import {
    buildRecoveryManifest,
    createHydrationMangleMap,
    transformIndexHtml as injectHydrationData,
    injectRecoveryManifest,
} from './html-transformer.js';
import {
    assertNoRSCBoundaryViolation,
    assertNoRSCGraphViolation,
    createRSCModuleRecord,
    deleteRSCModuleRecord,
    type RSCModuleRecord,
} from './rsc-boundary.js';
import { mergeThemes, parseThemeBlocks } from './theme-scanner.js';
import { writeThemeDts } from './theme-type-writer.js';
import {
    createTransformCacheKey,
    evictOldTransformCacheEntries,
    readTransformCache,
    resolveTransformCacheDir,
    type TransformCacheKey,
    type TransformCacheKeyInput,
    writeTransformCache,
} from './transform-cache.js';
import {
    createChecksumModule,
    createMangleMapModule,
    isVirtualModule,
    RESOLVED_VIRTUAL_CHECKSUM_ID,
    RESOLVED_VIRTUAL_MODULE_ID,
    resolveVirtualModule,
} from './virtual-modules.js';

/**
 * Plugin state for mangle map management.
 */
interface PluginState {
    classes: Set<string>;
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
}

/** CSS variable mangling and hoisting metrics emitted for debugging. */
interface CSSVariableMetrics {
    componentClassUses: number;
    componentStyleDeclarations: number;
    estimatedHoistedDeclarationsSaved: number;
    scopedClassUses: number;
    scopedStyleDeclarations: number;
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

/**
 * Placeholders injected during transform, replaced in processAssets/generateBundle
 * with actual values once the complete mangle map is available.
 */
const CHECKSUM_PLACEHOLDER = '___CSSZYX_CHECKSUM___';
const MANGLE_MAP_PLACEHOLDER = '___CSSZYX_MANGLE_MAP___';
const VAR_MANGLE_MAP_PLACEHOLDER = '___CSSZYX_VAR_MANGLE_MAP___';
const UNKNOWN_PACKAGE_VERSION = '0.0.0';
const TRANSFORM_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const TRANSFORM_CACHE_MAX_ENTRIES = 10_000;
const TRANSFORM_MEMORY_CACHE_MAX_ENTRIES = 1_000;
const DEFAULT_VAR_MANGLE_MAP_MAX_BYTES = 100 * 1024;
const DIRECTIVE_PROLOGUE_PREFIX_RE =
    /^((?:\s|\/\/[^\n]*\n|\/\*(?:[^*]|\*(?!\/))*\*\/)*)(['"]use (?:client|server)['"];?\s*)/;

// Precomputed regexes for the runtime-helper import-injection pass. The
// previous version called `new RegExp(...)` for every helper on every
// file, which compiles the same three patterns ~tens of thousands of
// times during a full project build. The helper set is closed (only
// these three names ever ship), so we cache the regexes here and reuse
// them on every transform. The matching string `@csszyx/runtime` only
// appears in modules that already import a helper, so callers can also
// skip the regex tests entirely when the runtime package is absent from
// the transformed source.
const RUNTIME_HELPER_IMPORT_RE: Record<string, RegExp> = {
    _sz: /\{[^}]*\b_sz\b[^}]*\}\s*from\s*['"]@csszyx\/runtime['"]/,
    _szMerge: /\{[^}]*\b_szMerge\b[^}]*\}\s*from\s*['"]@csszyx\/runtime['"]/,
    __szColorVar: /\{[^}]*\b__szColorVar\b[^}]*\}\s*from\s*['"]@csszyx\/runtime['"]/,
};

let _hasWarnedTsConfig = false;
let _hasWarnedTransformCacheVersion = false;
const requireFromHere: NodeJS.Require = createRequire(import.meta.url);
const PLUGIN_VERSION = findPackageVersionFromFile(
    fileURLToPath(import.meta.url),
    UNKNOWN_PACKAGE_VERSION,
);
const COMPILER_VERSION = findPackageVersionFromModule('@csszyx/compiler', UNKNOWN_PACKAGE_VERSION);
const BENCH_TRACE_ENABLED = process.env.CSSZYX_BENCH_TRACE === '1';
const BENCH_TRACE_FILE = process.env.CSSZYX_BENCH_TRACE_FILE;

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
 * Builds a stable one-to-many CSS variable mangle map from per-file ownership.
 *
 * @param entriesByFile Per-file CSS variable metadata.
 * @returns Public original-to-mangled map.
 */
function buildVarMangleMap(
    entriesByFile: ReadonlyMap<string, Array<[string, string]>>,
): Record<string, CssVariableMangleValue> {
    const next: Record<string, CssVariableMangleValue> = {};
    const files = [...entriesByFile.keys()].sort();
    for (const file of files) {
        for (const [original, mangled] of entriesByFile.get(file) ?? []) {
            addVarMangleMapping(next, original, mangled);
        }
    }
    return next;
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
    for (const file of [...metricsByFile.keys()].sort()) {
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
 */
function runThemeScan(rootDir: string, scanCss: string | string[] | undefined): void {
    if (!scanCss) {
        return;
    }
    const sourceFiles = expandFilePatterns(rootDir, scanCss).filter(file => file.endsWith('.css'));
    if (sourceFiles.length === 0) {
        return;
    }
    const themes = sourceFiles
        .map(f => {
            try {
                return parseThemeBlocks(fs.readFileSync(f, 'utf-8'));
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
                if (fs.existsSync(cfgPath)) {
                    const content = fs.readFileSync(cfgPath, 'utf-8');
                    if (!content.includes('.csszyx')) {
                        console.warn(
                            '\n\x1b[33m⚠️ CSSzyx: Theme Auto-Scan enabled, but TypeScript isn\'t configured. Run "npx @csszyx/cli init" to fix.\x1b[0m\n',
                        );
                    }
                    return true;
                }
                return false;
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
    return filename.replace(/\\/g, '/');
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
    const directiveMatch = code.match(DIRECTIVE_PROLOGUE_PREFIX_RE);
    if (!directiveMatch) {
        return `${importStmt}${code}`;
    }

    return code.replace(directiveMatch[0], `${directiveMatch[1]}${directiveMatch[2]}${importStmt}`);
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
 * Pass 3:   Quoted string arguments to csszyx runtime helpers (_szMerge, _szIf, etc.)
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
    //   sz={{ flex: true, flexDir: isRow ? 'row' : 'col' }}
    //   → className={`flex items-center ${isRow ? "flex-row" : "flex-col"}`}
    // In minified client bundles:    className:`flex items-center ${isRow?"flex-row":"flex-col"}`
    // In unminified SSR bundles:     className: `flex items-center ${isRow?"flex-row":"flex-col"}`
    // The \s* allows the optional space after the colon that appears in unminified SSR output.
    // Pass 1 skips template literals (only targets "..." strings).
    // Pass 2 mangles the quoted parts of the ternary but leaves the quasi text unmangled.
    result = result.replace(/className:\s*`([^`]+)`/g, (fullMatch, tplContent) => {
        let changed = false;
        let out = '';
        let i = 0;
        while (i < tplContent.length) {
            const interStart = tplContent.indexOf('${', i);
            if (interStart === -1) {
                // Trailing quasi — rest of the template literal is static text
                const quasi = tplContent.slice(i);
                const trimmed = quasi.trim();
                if (trimmed) {
                    const m = mangleClassString(trimmed);
                    if (m !== trimmed) {
                        changed = true;
                        out += quasi.replace(trimmed, m);
                    } else {
                        out += quasi;
                    }
                } else {
                    out += quasi;
                }
                break;
            }
            // Quasi text before the next ${...} interpolation
            const quasi = tplContent.slice(i, interStart);
            const trimmed = quasi.trim();
            if (trimmed) {
                const m = mangleClassString(trimmed);
                if (m !== trimmed) {
                    changed = true;
                    out += quasi.replace(trimmed, m);
                } else {
                    out += quasi;
                }
            } else {
                out += quasi;
            }
            // Mangle quoted strings inside the ${...} interpolation (ternary branch strings)
            // then copy the interpolation with its surrounding ${ and } delimiters.
            let j = interStart + 2;
            let depth = 0;
            while (j < tplContent.length) {
                if (tplContent[j] === '{') {
                    depth++;
                } else if (tplContent[j] === '}') {
                    if (depth === 0) {
                        j++;
                        break;
                    }
                    depth--;
                }
                j++;
            }
            const interInner = tplContent.slice(interStart + 2, j - 1);
            const mangledInner = interInner.replace(/"([^"]*)"/g, (qm: string, inner: string) => {
                const parts = inner.split(/\s+/).filter(Boolean);
                if (parts.length === 0) {
                    return qm;
                }
                const m = parts.map((p: string) => mangleMap[p] || p).join(' ');
                if (m === inner) {
                    return qm;
                }
                changed = true;
                return `"${m}"`;
            });
            out += `\${${mangledInner}}`;
            i = j;
        }
        return changed ? `className:\`${out}\`` : fullMatch;
    });

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
            // Extract the full expression using paren-depth tracking.
            // Stop at depth-0 terminators: , ; \n } ] )
            // The comma terminator prevents over-reaching into adjacent object properties
            // (e.g. {className:cond?"a":"b",title:"flex"} — must not mangle "flex" in title).
            // Commas INSIDE function calls are at depth > 0, so they are not terminators:
            //   className:r("static",cond?"a":"b") — the comma between args is depth-1, fine.
            let depth = 0;
            let j = afterColon;
            while (j < result.length) {
                const ch = result[j];
                if (ch === '(' || ch === '[') {
                    depth++;
                } else if (ch === ')' || ch === ']') {
                    if (depth === 0) {
                        break;
                    }
                    depth--;
                } else if (depth === 0 && (ch === ',' || ch === ';' || ch === '\n' || ch === '}')) {
                    break;
                }
                j++;
            }
            const expr = result.slice(afterColon, j);
            // Only process if there is a ternary operator — otherwise leave untouched
            // (e.g. className:someVar has no quoted strings to mangle anyway).
            const qIdx = expr.indexOf('?');
            if (qIdx === -1 || !expr.slice(qIdx).includes(':')) {
                out += expr;
                searchFrom = j;
                continue;
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
            out += changed ? mangled : expr;
            searchFrom = j;
        }
        result = out;
    }

    // Pass 3: Mangle quoted string arguments to csszyx runtime helpers (_szMerge, _szIf, etc.)
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
    result = result.replace(/(?<=(?:[,(]|&&)\s*)"([^"]+)"/g, (match, inner) => {
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
        return `"${mangled.join(' ')}"`;
    });

    return result;
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
    const manglingEnabled = options.production?.mangle !== false;
    // User can raise/lower the AST node budget per build via the existing
    // `BuildConfig.astBudgetLimit` field in @csszyx/types. Undefined here =
    // compiler falls back to the default 50 000 in @csszyx/compiler.
    const astBudgetOverride = options.build?.astBudgetLimit;
    const cacheRequested = (options.build?.cache ?? DEFAULT_BUILD_CONFIG.cache) !== false;
    const cacheVersionsKnown =
        PLUGIN_VERSION !== UNKNOWN_PACKAGE_VERSION && COMPILER_VERSION !== UNKNOWN_PACKAGE_VERSION;
    const cacheEnabled = cacheRequested && cacheVersionsKnown;
    const varMangleMapMaxBytes = resolveVarMangleMapMaxBytes();
    if (cacheRequested && !cacheVersionsKnown && !_hasWarnedTransformCacheVersion) {
        _hasWarnedTransformCacheVersion = true;
        console.warn(
            '[csszyx] Transform cache disabled because package versions could not be resolved.',
        );
    }
    const parserOverride = process.env.CSSZYX_PARSER;
    const defaultParser = DEFAULT_BUILD_CONFIG.parser ?? 'rust';
    const parserMode =
        parserOverride === 'babel' || parserOverride === 'oxc' || parserOverride === 'rust'
            ? parserOverride
            : (options.build?.parser ?? defaultParser);
    let evictedCacheRoot: string | null = null;
    const transformMemoryCache = new Map<string, SourceTransformResult>();

    const state: PluginState = {
        classes: new Set<string>(),
        mangleMap: {},
        varMangleEntriesByFile: new Map(),
        varMangleMap: {},
        cssVarMetricsByFile: new Map(),
        cssVarMetrics: emptyCSSVariableMetrics(),
        checksum: '',
        finalized: false,
        rootDir: process.cwd(),
        recoveryTokens: new Map<string, TokenData>(),
        rscModules: new Map<string, RSCModuleRecord>(),
    };

    const SAFELIST_FILENAME = 'csszyx-classes.html';
    const SOURCE_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.js']);
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
     * Checks built-in directories that csszyx never transforms.
     *
     * @param id - Bundler file id or filesystem path.
     * @returns True when the file should be skipped regardless of user filters.
     */
    function isHardIgnored(id: string): boolean {
        return (
            id.includes('node_modules') ||
            id.includes('/packages/') ||
            (id.includes('.next') && !id.includes('static'))
        );
    }

    /**
     * Checks whether a source module should enter the csszyx AST transform.
     *
     * @param id - Bundler file id or filesystem path.
     * @returns True when csszyx should parse and transform the source file.
     */
    function shouldProcessSource(id: string): boolean {
        return (
            !isHardIgnored(id) &&
            !isUserExcluded(id) &&
            isUserIncluded(id) &&
            (/\.[tj]sx?(\?.*)?$/.test(id) || id.endsWith('.vue') || id.endsWith('.svelte'))
        );
    }

    /**
     * Checks whether a CSS module should receive Tailwind safelist injection.
     *
     * @param id - Bundler file id or filesystem path.
     * @returns True when csszyx should process the CSS file.
     */
    function shouldProcessCss(id: string): boolean {
        return !isHardIgnored(id) && !isUserExcluded(id) && /\.css(\?.*)?$/.test(id);
    }

    /**
     * Runs the configured source transform. Rust is the default parser after
     * the Phase E max-speed pass and routes through the native engine. Oxc is
     * the documented JavaScript fallback for native-unavailable platforms, and
     * Babel remains the final compatibility safety net for unexpected
     * parser/compiler failures on either engine.
     *
     * @param source Source module contents.
     * @param filename Source filename for parser diagnostics.
     * @returns Compiler transform result.
     */
    function transformConfiguredSource(source: string, filename: string): SourceTransformResult {
        const compilerOptions = createCompilerOptions();
        const effectiveFilename = normalizeSourceFilename(filename);
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
            const memoryCached = transformMemoryCache.get(cacheKey.key);
            if (memoryCached) {
                transformMemoryCache.delete(cacheKey.key);
                transformMemoryCache.set(cacheKey.key, memoryCached);
                return memoryCached;
            }

            const cached = readTransformCache(cacheRoot, cacheInput, cacheKey);
            if (cached) {
                rememberTransformCacheEntry(cacheKey.key, cached);
                return cached;
            }
        }

        let result: SourceTransformResult;
        if (parserMode === 'babel') {
            result = transformSourceCode(source, effectiveFilename, compilerOptions);
        } else if (parserMode === 'rust') {
            // Honour the documented contract: `rust` is opt-in and never
            // silently falls back to oxc/Babel. Any failure here surfaces
            // to the caller with the same compatibility error the compiler
            // wrapper raises when the native addon is missing for the current
            // host, so misconfigured environments fail loudly instead of
            // producing oxc output users were not expecting.
            result = transformRust(source, effectiveFilename, compilerOptions);
        } else {
            try {
                result = transformOxc(source, effectiveFilename, compilerOptions);
            } catch (err) {
                result = transformSourceCode(source, effectiveFilename, compilerOptions);
                const reason = err instanceof Error ? err.message : String(err);
                result.diagnostics.push(
                    `[csszyx] oxc parser fell back to Babel for ${effectiveFilename}: ${reason}`,
                );
                return result;
            }
        }

        if (cacheEnabled && cacheKey) {
            writeTransformCache(cacheRoot, cacheInput, result, cacheKey);
            rememberTransformCacheEntry(cacheKey.key, result);
        }
        return result;
    }

    /**
     * Builds compiler options shared by single-file and prescan-batch transforms.
     *
     * @returns Compiler options.
     */
    function createCompilerOptions(): TransformSourceCodeOptions {
        return {
            astBudget: astBudgetOverride,
            mangleVars: options.production?.mangleVars === true,
            mangleVarHoistMaxDepth: options.production?.mangleVarHoistMaxDepth,
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
            parserMode,
            producer: parserMode,
            astBudget: astBudgetOverride,
            mangleVars: compilerOptions.mangleVars,
            mangleVarHoistMaxDepth: compilerOptions.mangleVarHoistMaxDepth,
            filename: effectiveFilename,
            source,
        };
    }

    /**
     * Transforms prescan files, batching Rust cache misses in one native call.
     *
     * @param files Source files discovered during prescan.
     * @returns Transform results for files that compiled successfully.
     */
    function transformPrescanSources(files: PrescanSourceFile[]): PrescanTransformResult[] {
        if (parserMode !== 'rust' || files.length <= 1) {
            return transformPrescanSourcesIndividually(files);
        }

        const compilerOptions = createCompilerOptions();
        const cacheRoot = resolveTransformCacheDir(state.rootDir, options.build?.cacheDir);
        const results = new Map<string, SourceTransformResult>();
        const misses: Array<{
            filePath: string;
            effectiveFilename: string;
            content: string;
            cacheInput: TransformCacheKeyInput;
            cacheKey: TransformCacheKey | null;
        }> = [];

        if (cacheEnabled) {
            evictTransformCacheOnce();
        }
        ensureRustTransformAvailable();

        for (const file of files) {
            const effectiveFilename = normalizeSourceFilename(file.filePath);
            const cacheInput = createConfiguredTransformCacheInput(
                file.content,
                effectiveFilename,
                compilerOptions,
            );
            const cacheKey = cacheEnabled ? createTransformCacheKey(cacheInput) : null;

            if (cacheEnabled && cacheKey) {
                const memoryCached = transformMemoryCache.get(cacheKey.key);
                if (memoryCached) {
                    transformMemoryCache.delete(cacheKey.key);
                    transformMemoryCache.set(cacheKey.key, memoryCached);
                    results.set(file.filePath, memoryCached);
                    continue;
                }

                const cached = readTransformCache(cacheRoot, cacheInput, cacheKey);
                if (cached) {
                    rememberTransformCacheEntry(cacheKey.key, cached);
                    results.set(file.filePath, cached);
                    continue;
                }
            }

            misses.push({
                filePath: file.filePath,
                effectiveFilename,
                content: file.content,
                cacheInput,
                cacheKey,
            });
        }

        if (misses.length === 0) {
            return files
                .map(file => {
                    const result = results.get(file.filePath);
                    return result ? { filePath: file.filePath, result } : null;
                })
                .filter((entry): entry is PrescanTransformResult => entry !== null);
        }

        try {
            const batchResults = transformRustBatch(
                misses.map(file => ({
                    filename: file.effectiveFilename,
                    source: file.content,
                })),
                compilerOptions,
            );
            for (let index = 0; index < misses.length; index++) {
                const miss = misses[index];
                const result = batchResults[index];
                if (!miss || !result) {
                    continue;
                }
                if (cacheEnabled && miss.cacheKey) {
                    writeTransformCache(cacheRoot, miss.cacheInput, result, miss.cacheKey);
                    rememberTransformCacheEntry(miss.cacheKey.key, result);
                }
                results.set(miss.filePath, result);
            }
        } catch {
            for (const miss of misses) {
                try {
                    results.set(
                        miss.filePath,
                        transformConfiguredSource(miss.content, miss.effectiveFilename),
                    );
                } catch {
                    // Preserve historical prescan behavior: a file that cannot
                    // transform during safelist discovery is skipped.
                }
            }
        }

        return files
            .map(file => {
                const result = results.get(file.filePath);
                return result ? { filePath: file.filePath, result } : null;
            })
            .filter((entry): entry is PrescanTransformResult => entry !== null);
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
                    result: transformConfiguredSource(file.content, file.filePath),
                });
            } catch {
                // Preserve historical prescan behavior: skip files that fail to transform.
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
        transformMemoryCache.delete(key);
        transformMemoryCache.set(key, result);
        if (transformMemoryCache.size <= TRANSFORM_MEMORY_CACHE_MAX_ENTRIES) {
            return;
        }
        const oldest = transformMemoryCache.keys().next().value;
        if (oldest) {
            transformMemoryCache.delete(oldest);
        }
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
        const classList = Array.from(classes).join(' ');
        const content =
            '<!-- Auto-generated by csszyx — DO NOT EDIT -->\n' +
            '<!-- Tailwind CSS scans this file for class name detection -->\n' +
            `<div class="${classList}">` +
            `<div class="${classList}">x</div>` +
            `<div class="${classList}">x</div>` +
            '</div>\n';
        try {
            const existing = fs.existsSync(safelistPath)
                ? fs.readFileSync(safelistPath, 'utf-8')
                : '';
            if (existing !== content) {
                fs.writeFileSync(safelistPath, content);
            }
        } catch {
            // Non-fatal: Tailwind just won't see prescanned classes
        }
    }

    /**
     * Pre-scans source files to discover class names before Tailwind CSS runs.
     * Tailwind v4 reads source files from disk and can't detect classes generated
     * by the csszyx transform (e.g. `sz={{ hover: { bg: 'gray-700' } }}` → `hover:bg-gray-700`).
     * This writes a manifest file with all discovered class names so Tailwind can scan it.
     */
    function prescanAndWriteClasses(): void {
        const prescanStarted = performance.now();
        const discoveredClasses = new Set<string>();
        // Raw className attribute values — used only for TW JIT safelist, never for the mangle map.
        const rawDiscoveredClasses = new Set<string>();
        const prescanSources: PrescanSourceFile[] = [];

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
                } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
                    const filePath = path.join(dir, entry.name);
                    if (!shouldProcessSource(filePath)) {
                        continue;
                    }
                    let content: string;
                    try {
                        content = fs.readFileSync(filePath, 'utf-8');
                    } catch {
                        continue;
                    }
                    if (!content.includes('sz=') && !content.includes('sz:')) {
                        continue;
                    }
                    prescanSources.push({ filePath, content });
                }
            }
        }

        scanDir(state.rootDir);

        for (const { filePath, result } of transformPrescanSources(prescanSources)) {
            if (!result.transformed) {
                continue;
            }
            collectPrescanResult(result, filePath, discoveredClasses, rawDiscoveredClasses);
        }

        // Add only sz-generated classes to state.classes (the mangle map source).
        // Raw className attribute values are intentionally excluded — they are custom CSS classes
        // that must not be mangled, since JS code references them by their original names.
        for (const cls of discoveredClasses) {
            state.classes.add(cls);
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
        const strKv = /(\w+)\s*:\s*(?:"([^"]*)"|'([^']*)')/g;
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
        const numKv = /(\w+)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?=[,}\n])/g;
        for (const kv of objStr.matchAll(numKv)) {
            try {
                collectTransformClasses(
                    transform({ [kv[1]]: parseFloat(kv[2]) }),
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
        const boolKv = /(\w+)\s*:\s*(true|false)\s*(?=[,}\n])/g;
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
     * Extracts classes from source code.
     * Handles both static patterns (className="...") and expression patterns
     * (className={cond ? "..." : "..."}) which arise from pre-compiled ternary expressions.
     * @param code source code
     */
    function extractClasses(code: string): void {
        // Pass 1: Direct className="..." / class="..." patterns.
        // Use separate patterns for double-quoted and single-quoted strings so that
        // class names containing single quotes (e.g. before:content-['']) are captured
        // fully from double-quoted strings, and vice versa.
        const dqPattern = /(?:class(?:Name)?|sz)[:=]\s*"([^"]*)"/g;
        const sqPattern = /(?:class(?:Name)?|sz)[:=]\s*'([^']*)'/g;
        for (const classPattern of [dqPattern, sqPattern]) {
            for (const match of code.matchAll(classPattern)) {
                const classes = match[1].split(/\s+/).filter(Boolean);
                for (const cls of classes) {
                    state.classes.add(cls);
                }
            }
        }

        // Pass 2: Extract from className={...} JSX expression containers
        // This handles pre-compiled ternary expressions like:
        // className={cond ? "text-6xl font-bold" : "text-6xl text-sm"}
        const exprStart = /className=\{/g;
        for (const match of code.matchAll(exprStart)) {
            let depth = 1;
            let i = (match.index ?? 0) + match[0].length;
            while (i < code.length && depth > 0) {
                if (code[i] === '{') {
                    depth++;
                } else if (code[i] === '}') {
                    depth--;
                }
                i++;
            }
            const expr = code.slice((match.index ?? 0) + match[0].length, i - 1);
            // Extract all quoted strings within the expression
            const strPattern = /"([^"]+)"|'([^']+)'/g;
            for (const strMatch of expr.matchAll(strPattern)) {
                const str = strMatch[1] || strMatch[2];
                const classes = str.split(/\s+/).filter(Boolean);
                for (const cls of classes) {
                    state.classes.add(cls);
                }
            }
        }
    }

    /**
     * Finalizes the mangle map from all collected classes.
     * Always rebuilds to ensure completeness (called after all files processed).
     */
    function finalizeMangleMap(): void {
        const sortedClasses = Array.from(state.classes); // Keep insertion order for stability
        const newMap: Record<string, string> = {};
        for (let i = 0; i < sortedClasses.length; i++) {
            newMap[sortedClasses[i]] = encode(i);
        }
        state.mangleMap = newMap;
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
     * Replaces checksum and mangle map placeholders with actual values.
     * @param code code containing placeholders
     * @returns code with placeholders replaced
     */
    function replacePlaceholders(code: string): string {
        let result = code;
        if (result.includes(CHECKSUM_PLACEHOLDER)) {
            result = result.split(CHECKSUM_PLACEHOLDER).join(state.checksum);
        }
        if (result.includes(MANGLE_MAP_PLACEHOLDER)) {
            const jsonMap = JSON.stringify(state.mangleMap);
            // Webpack dev mode wraps each module in eval("..."). Inside that eval string,
            // double-quotes must be escaped as \" or they will terminate the string literal early.
            // Detect eval-wrapped output by checking if the file uses eval().
            const escapedMap = result.includes('eval(') ? jsonMap.replace(/"/g, '\\"') : jsonMap;
            result = result.split(MANGLE_MAP_PLACEHOLDER).join(escapedMap);
        }
        if (result.includes(VAR_MANGLE_MAP_PLACEHOLDER)) {
            const jsonMap = JSON.stringify(state.varMangleMap);
            const escapedMap = result.includes('eval(') ? jsonMap.replace(/"/g, '\\"') : jsonMap;
            result = result.split(VAR_MANGLE_MAP_PLACEHOLDER).join(escapedMap);
        }
        return result;
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
                return null;
            },

            /**
             * Filters files for the pre-transform phase — source files plus CSS files.
             * CSS files need special handling to inject @source inline() for Tailwind class discovery.
             * @param id - the file path to check for inclusion
             * @returns true if the file should be transformed, false otherwise
             */
            transformInclude(id) {
                // Handle CSS files to inject discovered classes as @source inline()
                if (shouldProcessCss(id)) {
                    return true;
                }
                // Only handle source files in PRE phase
                return shouldProcessSource(id);
            },

            /**
             * Core transform: detects sz prop, compiles to className, injects runtime, collects classes.
             * For CSS files: injects @source inline() so Tailwind generates CSS for sz-derived classes.
             * @param code - the source code to transform
             * @param id - the file path of the module being transformed
             * @returns transformed code with source map, or null if no changes were made
             */
            transform(code, id) {
                if (!shouldProcessCss(id) && !shouldProcessSource(id)) {
                    return null;
                }

                if (/\.[tj]sx?(\?.*)?$/.test(id)) {
                    assertNoRSCBoundaryViolation(code, id);
                }

                // CSS transform: inject @source so Tailwind sees csszyx-generated class names.
                // @tailwindcss/vite scans files through the Vite module graph; csszyx-classes.html
                // is not imported anywhere, so it's invisible to Tailwind. Injecting @source
                // directly into the CSS that imports tailwindcss is the only reliable way to ensure
                // Tailwind generates CSS for the classes that csszyx transforms sz props into.
                if (/\.css(\?.*)?$/.test(id)) {
                    const hasTailwindImport =
                        code.includes('@import "tailwindcss') ||
                        code.includes("@import 'tailwindcss");
                    if (hasTailwindImport && state.classes.size > 0) {
                        // Only include classes that look like real Tailwind candidates:
                        // at least 2 chars, starts with a letter, not pure mangled symbols.
                        const candidates = Array.from(state.classes)
                            .filter(c => c.length >= 2 && /^[a-z]/.test(c))
                            .join(' ');
                        if (candidates) {
                            const safelistPath = path
                                .join(state.rootDir, SAFELIST_FILENAME)
                                .replace(/\\/g, '/');
                            const cssDir = path.dirname(id).replace(/\\/g, '/');
                            let relPath = path.posix.relative(cssDir, safelistPath);
                            if (!relPath.startsWith('.')) {
                                relPath = `./${relPath}`;
                            }
                            const sourceDirective = `@source "${relPath}";\n`;
                            const transformed = code.replace(
                                /(@import\s+["']tailwindcss[^"']*["'];)/,
                                `$1\n${sourceDirective}`,
                            );
                            if (transformed !== code) {
                                return { code: transformed, map: null };
                            }
                        }
                    }
                    return null;
                }

                let transformedCode = code;
                let usesRuntime = false;
                let usesMerge = false;
                let usesColorVar = false;
                let transformed = false;
                let szClasses: Set<string> | undefined;

                // Detect sz prop in both JSX (sz="...", sz={{...}}) and JS/JSX-transformed (sz: "...", sz: {...}) formats
                const hasSzProp =
                    code.includes('sz=') || /\bsz\s*:\s*["'{]/.test(code) || code.includes('sz: "');

                if (hasSzProp) {
                    if (id.endsWith('.vue')) {
                        const result = vuePreprocess(code, options as VueAdapterOptions);
                        if (result.transformed) {
                            transformedCode = result.code;
                            transformed = true;
                        }
                    } else if (id.endsWith('.svelte')) {
                        const result = sveltePreprocess(code, options as SvelteAdapterOptions);
                        if (result) {
                            transformedCode = result.code;
                            transformed = true;
                        }
                    } else {
                        const transformStarted = performance.now();
                        const result = transformConfiguredSource(code, id);
                        traceBenchTiming(
                            'transform-hook',
                            id,
                            performance.now() - transformStarted,
                        );
                        transformedCode = result.code;
                        usesRuntime = result.usesRuntime;
                        usesMerge = result.usesMerge;
                        usesColorVar = result.usesColorVar;
                        transformed = result.transformed;
                        szClasses = result.classes;
                        recordFileVarMangleEntries(state, id, cssVariableEntries(result));
                        recordFileCSSVariableMetrics(state, id, result.code);
                        // Emit dev-mode warnings when the compiler had to fall back to _sz() runtime.
                        // Suppressed in production to avoid leaking source paths into build output.
                        if (
                            result.diagnostics.length > 0 &&
                            process.env.NODE_ENV !== 'production'
                        ) {
                            for (const msg of result.diagnostics) {
                                this.warn(`[csszyx] ${id}\n  ${msg}`);
                            }
                        }
                        for (const [token, data] of result.recoveryTokens) {
                            state.recoveryTokens.set(token, data);
                        }
                    }
                } else if (shouldProcessSource(id)) {
                    recordFileVarMangleEntries(state, id, []);
                    recordFileCSSVariableMetrics(state, id, null);
                }

                // Layout injection (SSR frameworks like Next.js)
                // Uses placeholders that are replaced in processAssets after all classes are collected
                if (
                    transformedCode.includes('<html') &&
                    /layout|Root|Document|app\\.tsx?$/i.test(id)
                ) {
                    const attrName = options.production?.minify ? 'data-sz-cs' : 'data-sz-checksum';
                    transformedCode = transformedCode.replace(
                        /<html([^>]*)>/i,
                        `<html$1 ${attrName}="${CHECKSUM_PLACEHOLDER}">`,
                    );

                    // Inject mangle map debug script with placeholders
                    const debugScript = `<script dangerouslySetInnerHTML={{__html: \`(function(){var m=${MANGLE_MAP_PLACEHOLDER};var vm=${VAR_MANGLE_MAP_PLACEHOLDER};var r={};var vr={};for(var k in m)r[m[k]]=k;for(var vk in vm){var vv=vm[vk];var vs=Array.isArray(vv)?vv:[vv];for(var vi=0;vi<vs.length;vi++)(vr[vs[vi]]||(vr[vs[vi]]=[])).push(vk)}window.__csszyx={mangleMap:m,varMangleMap:vm,checksum:"${CHECKSUM_PLACEHOLDER}",decode:function(c){return r[c]},encode:function(c){return m[c]},decodeVar:function(v){return vr[v]||[]},encodeVar:function(v){return vm[v]},decodeAll:function(el){return(el.className||"").split(" ").map(function(c){return r[c]||c})}}})()\`}} />`;
                    if (transformedCode.includes('<body')) {
                        transformedCode = transformedCode.replace(
                            /(<body[^>]*>)/i,
                            `$1${debugScript}`,
                        );
                    }
                    transformed = true;
                }

                // Runtime + color var import injection
                {
                    const imports: string[] = [];
                    if (usesRuntime) {
                        imports.push('_sz');
                    }
                    if (usesMerge) {
                        imports.push('_szMerge');
                    }
                    if (usesColorVar) {
                        imports.push('__szColorVar');
                    }
                    // Filter out helpers already imported from @csszyx/runtime.
                    // The literal package name only appears in modules that
                    // already import a helper, so a single `.includes()`
                    // short-circuit skips the regex tests entirely for the
                    // common case where no `@csszyx/runtime` import exists.
                    // The regexes themselves are cached at module scope so we
                    // don't recompile them per file.
                    const hasRuntimeImport =
                        imports.length > 0 && transformedCode.includes('@csszyx/runtime');
                    const needed = hasRuntimeImport
                        ? imports.filter(
                              name => !RUNTIME_HELPER_IMPORT_RE[name]?.test(transformedCode),
                          )
                        : imports;
                    if (needed.length > 0) {
                        const existingImport = transformedCode.match(
                            /^(import\s*\{[^}]*)\}\s*from\s*'@csszyx\/runtime'/m,
                        );
                        if (existingImport) {
                            // Append to the existing @csszyx/runtime import
                            transformedCode = transformedCode.replace(
                                existingImport[0],
                                `${existingImport[1]}, ${needed.join(', ')} } from '@csszyx/runtime'`,
                            );
                        } else {
                            const importStmt = `import { ${needed.join(', ')} } from '@csszyx/runtime';\n`;
                            transformedCode = insertRuntimeImport(transformedCode, importStmt);
                        }
                        transformed = true;
                    }
                }

                if (/\.[tj]sx?(\?.*)?$/.test(id)) {
                    assertNoRSCBoundaryViolation(transformedCode, id);
                    const record = createRSCModuleRecord(transformedCode, id);
                    state.rscModules.set(record.id, record);
                }

                // Extract classes for the mangle map but DON'T mangle yet.
                // Mangling is deferred to processAssets/generateBundle where we have the complete map.
                if (
                    transformed ||
                    transformedCode.includes('class=') ||
                    transformedCode.includes('className=')
                ) {
                    if (szClasses !== undefined) {
                        // TSX/JSX sz file: use piggyback classes from Babel JSXAttribute visitor.
                        // No regex needed — classes were collected during the existing Babel traverse
                        // at zero extra cost, with no false positives from text content or JSDoc.
                        // Only sz-generated classes go into state.classes (the mangle map).
                        // Raw className attribute values (szRawClassNames) are intentionally excluded:
                        // they are custom CSS classes (e.g. reveal-item, glow-card) defined in raw CSS
                        // files, not TW utilities. Mangling them would break JS that references them by
                        // name (querySelectorAll, classList.add) without updating those call sites.
                        for (const cls of szClasses) {
                            state.classes.add(cls);
                        }
                    } else {
                        // Non-sz file (fast-path, no Babel ran) or Vue/Svelte adapter:
                        // fall back to regex for existing className attributes.
                        extractClasses(transformedCode);
                    }
                    return { code: transformedCode, map: null };
                }
                return null;
            },

            /** Finalizes the mangle map after all source modules have been processed. */
            buildEnd() {
                finalizeMangleMap();
                assertNoRSCGraphViolation(state.rscModules);
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
                    recordFileVarMangleEntries(state, id, []);
                    recordFileCSSVariableMetrics(state, id, null);
                }
            },

            /**
             * Webpack hook: pre-scans source files before compilation for Tailwind class discovery.
             * @param compiler - the Webpack compiler instance
             */
            webpack(compiler: WebpackCompiler) {
                compiler.hooks.beforeCompile.tap('csszyx:prescan', () => {
                    const root = compiler.context || process.cwd();
                    state.rootDir = root;
                    evictTransformCacheOnce();
                    if (state.classes.size === 0) {
                        prescanAndWriteClasses();
                    }
                    // Generate theme type augmentation from @theme CSS blocks
                    runThemeScan(root, options.build?.scanCss);
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

            vite: {
                /**
                 * Vite hook: pre-scans source files when config is resolved.
                 * Also runs theme scan to generate .csszyx/theme.d.ts if scanCss is configured.
                 * @param config - the resolved Vite configuration object
                 */
                configResolved(config) {
                    const root = config.root || process.cwd();
                    state.rootDir = root;
                    evictTransformCacheOnce();
                    // Pre-scan source files so Tailwind can discover classes
                    prescanAndWriteClasses();
                    // Generate theme type augmentation from @theme CSS blocks
                    runThemeScan(root, options.build?.scanCss);
                },

                /**
                 * Vite HMR hook: re-runs theme scan when a watched CSS file changes,
                 * and incrementally updates csszyx-classes.html when a source file gains new sz classes.
                 * @param ctx - HMR context containing the changed file
                 */
                handleHotUpdate(ctx) {
                    // Theme scan for @theme CSS blocks
                    const scanCss = options.build?.scanCss;
                    if (scanCss) {
                        const root = ctx.server.config.root || process.cwd();
                        if (matchesAnyPattern(ctx.file, scanCss, root)) {
                            runThemeScan(root, scanCss);
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
                        return;
                    }

                    if (!fileContent.includes('sz=') && !/\bsz\s*:\s*["'{]/.test(fileContent)) {
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
                        recordFileVarMangleEntries(state, ctx.file, []);
                        recordFileCSSVariableMetrics(state, ctx.file, null);
                        return;
                    }

                    if (!result.transformed) {
                        recordFileVarMangleEntries(state, ctx.file, []);
                        recordFileCSSVariableMetrics(state, ctx.file, null);
                        return;
                    }

                    const sizeBefore = state.classes.size;
                    for (const cls of result.classes) {
                        state.classes.add(cls);
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
                        let result = injectHydrationData(html, state.mangleMap, state.checksum, {
                            mode:
                                options.production?.injectChecksum === false ? 'script' : 'script',
                            minify: process.env.NODE_ENV === 'production',
                            varMangleMap: state.varMangleMap,
                        });
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
            compiler.hooks.compilation.tap('csszyx:post', compilation => {
                // Determine stage - default to optimize size to encompass most transformations
                const stage =
                    compiler.webpack?.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE ||
                    (compilation.constructor as { PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE?: number })
                        .PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE;

                compilation.hooks.processAssets.tap(
                    {
                        name: 'csszyx:post',
                        stage: stage || 400, // Fallback integer
                    },
                    assets => {
                        finalizeMangleMap();

                        // Webpack dev mode wraps every module in eval("..."), which means
                        // className:"..." strings become className:\"...\" inside the eval.
                        // The mangleCodeClasses regex matches plain "..." delimiters only,
                        // so it cannot mangle classes inside eval-wrapped bundles.
                        // Disabling class mangling in dev mode keeps CSS and HTML consistent:
                        // both use the original Tailwind class names (e.g. "text-white"),
                        // so styles render correctly during development.
                        const isWebpackDevMode = compiler.options.mode === 'development';

                        // Emit CSS manifest for @csszyx/dynamic delta check.
                        const manifestData: {
                            version: string;
                            buildId: string;
                            classes: string[];
                            mangleMap?: Record<string, string>;
                            varMangleMap?: Record<string, CssVariableMangleValue>;
                            cssVarMetrics?: CSSVariableMetrics;
                        } = {
                            version: '0.4.0',
                            buildId: state.checksum,
                            classes: Object.keys(state.mangleMap),
                        };
                        if (
                            manglingEnabled &&
                            !isWebpackDevMode &&
                            Object.keys(state.mangleMap).length > 0
                        ) {
                            manifestData.mangleMap = state.mangleMap;
                        }
                        if (Object.keys(state.varMangleMap).length > 0) {
                            manifestData.varMangleMap = state.varMangleMap;
                        }
                        if (hasCSSVariableMetrics(state.cssVarMetrics)) {
                            manifestData.cssVarMetrics = state.cssVarMetrics;
                        }
                        compilation.emitAsset(
                            'csszyx-manifest.json',
                            new compiler.webpack.sources.RawSource(JSON.stringify(manifestData)),
                        );

                        for (const file in assets) {
                            const asset = assets[file];
                            const source = asset.source().toString();

                            if (
                                manglingEnabled &&
                                !isWebpackDevMode &&
                                Object.keys(state.mangleMap).length > 0
                            ) {
                                if (file.endsWith('.css')) {
                                    try {
                                        const result = mangleCSSSync(source, state.mangleMap, {
                                            debug: options.development?.debug,
                                            from: file,
                                        });
                                        if (result.transformedCount > 0) {
                                            compilation.updateAsset(
                                                file,
                                                new compiler.webpack.sources.RawSource(result.css),
                                            );
                                            continue;
                                        }
                                    } catch (e: unknown) {
                                        if (
                                            e &&
                                            typeof e === 'object' &&
                                            'name' in e &&
                                            (e as { name: string }).name === 'CssSyntaxError'
                                        ) {
                                            // Ignore CSS syntax errors
                                        } else {
                                            throw e;
                                        }
                                    }
                                } else if (file.endsWith('.html')) {
                                    // Mangle class attributes in HTML assets (SSR-generated pages)
                                    const mangledHtml = source
                                        .replace(
                                            /\bclass="([^"]*)"/g,
                                            (_m: string, cls: string) => {
                                                const out = cls
                                                    .split(/\s+/)
                                                    .filter(Boolean)
                                                    .map((c: string) => state.mangleMap[c] || c)
                                                    .join(' ');
                                                return out !== cls ? `class="${out}"` : _m;
                                            },
                                        )
                                        .replace(
                                            /\bclass='([^']*)'/g,
                                            (_m: string, cls: string) => {
                                                const out = cls
                                                    .split(/\s+/)
                                                    .filter(Boolean)
                                                    .map((c: string) => state.mangleMap[c] || c)
                                                    .join(' ');
                                                return out !== cls ? `class='${out}'` : _m;
                                            },
                                        );
                                    if (mangledHtml !== source) {
                                        compilation.updateAsset(
                                            file,
                                            new compiler.webpack.sources.RawSource(mangledHtml),
                                        );
                                        continue;
                                    }
                                } else if (file.endsWith('.js')) {
                                    // Mangle class name strings in JS bundles
                                    let mangled = mangleCodeClasses(source);
                                    mangled = replacePlaceholders(mangled);
                                    if (mangled !== source) {
                                        compilation.updateAsset(
                                            file,
                                            new compiler.webpack.sources.RawSource(mangled),
                                        );
                                        continue;
                                    }
                                }
                            }

                            // Even when mangling is disabled, still replace placeholders
                            // (checksum + mangle map) in JS files
                            if (
                                file.endsWith('.js') &&
                                (source.includes(CHECKSUM_PLACEHOLDER) ||
                                    source.includes(MANGLE_MAP_PLACEHOLDER))
                            ) {
                                const replaced = replacePlaceholders(source);
                                if (replaced !== source) {
                                    compilation.updateAsset(
                                        file,
                                        new compiler.webpack.sources.RawSource(replaced),
                                    );
                                }
                            }
                        }
                    },
                );
            });
        },

        vite: {
            /**
             * Vite hook: mangles CSS selectors and JS class strings in the final bundle.
             * @param _options - the output options (unused)
             * @param bundle - the output bundle containing chunks and assets to process
             */
            generateBundle(_options, bundle) {
                finalizeMangleMap();

                // Emit CSS manifest for @csszyx/dynamic delta check.
                // Lists all original class names (and mangle map if mangling enabled)
                // so runtime dynamic() can skip injection for pre-built classes.
                const manifestData: {
                    version: string;
                    buildId: string;
                    classes: string[];
                    mangleMap?: Record<string, string>;
                    varMangleMap?: Record<string, CssVariableMangleValue>;
                    cssVarMetrics?: CSSVariableMetrics;
                } = {
                    version: '0.4.0',
                    buildId: state.checksum,
                    classes: Object.keys(state.mangleMap),
                };
                if (manglingEnabled && Object.keys(state.mangleMap).length > 0) {
                    manifestData.mangleMap = state.mangleMap;
                }
                if (Object.keys(state.varMangleMap).length > 0) {
                    manifestData.varMangleMap = state.varMangleMap;
                }
                if (hasCSSVariableMetrics(state.cssVarMetrics)) {
                    manifestData.cssVarMetrics = state.cssVarMetrics;
                }
                this.emitFile({
                    type: 'asset',
                    fileName: 'csszyx-manifest.json',
                    source: JSON.stringify(manifestData),
                });

                for (const file in bundle) {
                    const chunk = bundle[file];

                    if (manglingEnabled && Object.keys(state.mangleMap).length > 0) {
                        if (chunk.type === 'asset' && chunk.fileName.endsWith('.css')) {
                            const css = chunk.source.toString();
                            try {
                                const result = mangleCSSSync(css, state.mangleMap, {
                                    debug: options.development?.debug,
                                    from: file,
                                });
                                if (result.transformedCount > 0) {
                                    chunk.source = result.css;
                                }
                            } catch (e: unknown) {
                                if (
                                    e &&
                                    typeof e === 'object' &&
                                    'name' in e &&
                                    (e as { name: string }).name === 'CssSyntaxError'
                                ) {
                                    // Ignore CSS syntax errors
                                } else {
                                    throw e;
                                }
                            }
                            continue;
                        } else if (chunk.type === 'chunk') {
                            let mangledCode = mangleCodeClasses(chunk.code);
                            mangledCode = replacePlaceholders(mangledCode);
                            if (mangledCode !== chunk.code) {
                                chunk.code = mangledCode;
                            }
                            continue;
                        }
                    }

                    // Even when mangling is disabled, still replace placeholders in JS chunks
                    if (
                        chunk.type === 'chunk' &&
                        (chunk.code.includes(CHECKSUM_PLACEHOLDER) ||
                            chunk.code.includes(MANGLE_MAP_PLACEHOLDER))
                    ) {
                        const replaced = replacePlaceholders(chunk.code);
                        if (replaced !== chunk.code) {
                            chunk.code = replaced;
                        }
                    }
                }
            },
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
    const { prePlugin, postPlugin } = createCsszyxPlugins(options);
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
            prePlugin.esbuild(options).setup(b);
            postPlugin.esbuild(options).setup(b);
        },
    };
};
