import * as fs from 'node:fs';
import * as path from 'node:path';

import { type TokenData, transform, transformOxc, transformSourceCode } from '@csszyx/compiler';
import { compute_mangle_checksum, encode } from '@csszyx/core';
import { type SvelteAdapterOptions, preprocess as sveltePreprocess } from '@csszyx/svelte-adapter';
import type { PartialCsszyxConfig } from '@csszyx/types';
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
    transformIndexHtml as injectHydrationData,
    injectRecoveryManifest,
} from './html-transformer.js';
import {
    assertNoRSCBoundaryViolation,
    assertNoRSCGraphViolation,
    createRSCModuleRecord,
    type RSCModuleRecord,
} from './rsc-boundary.js';
import { mergeThemes, parseThemeBlocks } from './theme-scanner.js';
import { writeThemeDts } from './theme-type-writer.js';
import {
    createChecksumModule,
    createMangleMapModule,
    isVirtualModule,
    RESOLVED_VIRTUAL_CHECKSUM_ID,
    RESOLVED_VIRTUAL_MODULE_ID,
    resolveVirtualModule,
} from './virtual-modules.js';

/** Compiler source-transform result shared by Babel and oxc paths. */
type SourceTransformResult = ReturnType<typeof transformSourceCode>;

/**
 * Plugin state for mangle map management.
 */
interface PluginState {
    classes: Set<string>;
    mangleMap: Record<string, string>;
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

/**
 * Placeholders injected during transform, replaced in processAssets/generateBundle
 * with actual values once the complete mangle map is available.
 */
const CHECKSUM_PLACEHOLDER = '___CSSZYX_CHECKSUM___';
const MANGLE_MAP_PLACEHOLDER = '___CSSZYX_MANGLE_MAP___';

let _hasWarnedTsConfig = false;

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
    const parserMode =
        process.env.CSSZYX_PARSER === 'oxc' ? 'oxc' : (options.build?.parser ?? 'babel');

    const state: PluginState = {
        classes: new Set<string>(),
        mangleMap: {},
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
     * Runs the configured source transform. Babel remains the stable default;
     * the oxc path is opt-in and falls back to Babel for not-yet-ported syntax
     * so enabling it cannot change build correctness during Phase D.
     *
     * @param source Source module contents.
     * @param filename Source filename for parser diagnostics.
     * @returns Compiler transform result.
     */
    function transformConfiguredSource(source: string, filename: string): SourceTransformResult {
        const compilerOptions = { astBudget: astBudgetOverride };
        if (parserMode !== 'oxc') {
            return transformSourceCode(source, filename, compilerOptions);
        }

        try {
            return transformOxc(source, filename, compilerOptions);
        } catch (err) {
            const result = transformSourceCode(source, filename, compilerOptions);
            const reason = err instanceof Error ? err.message : String(err);
            result.diagnostics.push(
                `[csszyx] CSSZYX_PARSER=oxc fell back to Babel for ${filename}: ${reason}`,
            );
            return result;
        }
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
        const discoveredClasses = new Set<string>();
        // Raw className attribute values — used only for TW JIT safelist, never for the mangle map.
        const rawDiscoveredClasses = new Set<string>();

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
                    try {
                        const content = fs.readFileSync(filePath, 'utf-8');
                        if (!content.includes('sz=') && !content.includes('sz:')) {
                            continue;
                        }
                        const result = transformConfiguredSource(content, filePath);
                        if (!result.transformed) {
                            continue;
                        }
                        // Piggyback: use classes collected inside the Babel JSXAttribute visitor.
                        // Risk-free: only JSXAttribute nodes are visited, so text content, JSDoc,
                        // comments, and string literals in other positions never produce false
                        // positives (they are different AST node types and never reach the visitor).
                        // result.classes = sz-generated → safelist + mangle map
                        // result.rawClassNames = raw className attrs → safelist only (never mangled)
                        for (const cls of result.classes) {
                            discoveredClasses.add(cls);
                        }
                        for (const cls of result.rawClassNames) {
                            rawDiscoveredClasses.add(cls);
                        }
                        for (const [token, data] of result.recoveryTokens) {
                            state.recoveryTokens.set(token, data);
                        }
                        // Extract static classes from _sz() runtime calls.
                        // When an sz prop has any dynamic value, the compiler wraps the
                        // entire object in _sz({...}). Static values inside are invisible
                        // to Tailwind's content scanner. Extract them here.
                        if (result.usesRuntime) {
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
                                const objStr = result.code.slice(
                                    (szMatch.index ?? 0) + szMatch[0].length,
                                    idx - 1,
                                );
                                // Extract key: 'string' or "string" pairs
                                const strKv = /(\w+)\s*:\s*(?:"([^"]*)"|'([^']*)')/g;
                                for (const kv of objStr.matchAll(strKv)) {
                                    try {
                                        const val = kv[2] ?? kv[3];
                                        const r = transform({ [kv[1]]: val });
                                        for (const c of r.className.split(/\s+/).filter(Boolean)) {
                                            discoveredClasses.add(c);
                                        }
                                    } catch {
                                        /* skip invalid */
                                    }
                                }
                                // Extract key: number pairs
                                const numKv = /(\w+)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?=[,}\n])/g;
                                for (const kv of objStr.matchAll(numKv)) {
                                    try {
                                        const r = transform({ [kv[1]]: parseFloat(kv[2]) });
                                        for (const c of r.className.split(/\s+/).filter(Boolean)) {
                                            discoveredClasses.add(c);
                                        }
                                    } catch {
                                        /* skip invalid */
                                    }
                                }
                                // Extract key: true/false pairs
                                const boolKv = /(\w+)\s*:\s*(true|false)\s*(?=[,}\n])/g;
                                for (const kv of objStr.matchAll(boolKv)) {
                                    try {
                                        const r = transform({ [kv[1]]: kv[2] === 'true' });
                                        for (const c of r.className.split(/\s+/).filter(Boolean)) {
                                            discoveredClasses.add(c);
                                        }
                                    } catch {
                                        /* skip invalid */
                                    }
                                }
                            }
                        }
                    } catch {
                        // Skip files that fail to transform
                    }
                }
            }
        }

        scanDir(state.rootDir);

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
        state.checksum = compute_mangle_checksum(state.mangleMap);
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
                    return createMangleMapModule(state.mangleMap, state.checksum);
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
                        const result = transformConfiguredSource(code, id);
                        transformedCode = result.code;
                        usesRuntime = result.usesRuntime;
                        usesMerge = result.usesMerge;
                        usesColorVar = result.usesColorVar;
                        transformed = result.transformed;
                        szClasses = result.classes;
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
                    const debugScript = `<script dangerouslySetInnerHTML={{__html: \`(function(){var m=${MANGLE_MAP_PLACEHOLDER};var r={};for(var k in m)r[m[k]]=k;window.__csszyx={mangleMap:m,checksum:"${CHECKSUM_PLACEHOLDER}",decode:function(c){return r[c]},encode:function(c){return m[c]},decodeAll:function(el){return(el.className||"").split(" ").map(function(c){return r[c]||c})}}})()\`}} />`;
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
                    // Filter out helpers already imported from @csszyx/runtime
                    const needed = imports.filter(
                        name =>
                            !new RegExp(
                                `\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]@csszyx/runtime['"]`,
                            ).test(transformedCode),
                    );
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
                            const directiveMatch = transformedCode.match(
                                /^['"]use (client|server)['"];?\s*/,
                            );
                            if (directiveMatch) {
                                const directive = directiveMatch[0];
                                transformedCode = transformedCode.replace(
                                    directive,
                                    `${directive}${importStmt}`,
                                );
                            } else {
                                transformedCode = `${importStmt}${transformedCode}`;
                            }
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

            /**
             * Webpack hook: pre-scans source files before compilation for Tailwind class discovery.
             * @param compiler - the Webpack compiler instance
             */
            webpack(compiler: WebpackCompiler) {
                compiler.hooks.beforeCompile.tap('csszyx:prescan', () => {
                    const root = compiler.context || process.cwd();
                    state.rootDir = root;
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
                        return;
                    }

                    try {
                        result = transformConfiguredSource(fileContent, ctx.file);
                    } catch {
                        return;
                    }

                    if (!result.transformed) {
                        return;
                    }

                    const sizeBefore = state.classes.size;
                    for (const cls of result.classes) {
                        state.classes.add(cls);
                    }
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
                } = {
                    version: '0.4.0',
                    buildId: state.checksum,
                    classes: Object.keys(state.mangleMap),
                };
                if (manglingEnabled && Object.keys(state.mangleMap).length > 0) {
                    manifestData.mangleMap = state.mangleMap;
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
