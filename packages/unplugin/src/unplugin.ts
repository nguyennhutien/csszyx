import * as fs from 'node:fs';
import * as path from 'node:path';

import { transform, transformSourceCode } from '@csszyx/compiler';
import { compute_mangle_checksum, encode } from '@csszyx/core';
import { preprocess as sveltePreprocess, type SvelteAdapterOptions } from '@csszyx/svelte-adapter';
import type { PartialCsszyxConfig } from '@csszyx/types';
import { preprocess as vuePreprocess, type VueAdapterOptions } from '@csszyx/vue-adapter';
import type { Plugin as EsbuildPlugin, PluginBuild } from 'esbuild';
import type { InputPluginOption } from 'rollup';
import { createUnplugin, type UnpluginInstance, type WebpackPluginInstance } from 'unplugin';
import type { PluginOption } from 'vite';
import type { Compiler as WebpackCompiler } from 'webpack';

import { mangleCSSSync } from './css-mangler.js';
import { transformIndexHtml as injectHydrationData } from './html-transformer.js';
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
  checksum: string;
  finalized: boolean;
}

/**
 * Placeholders injected during transform, replaced in processAssets/generateBundle
 * with actual values once the complete mangle map is available.
 */
const CHECKSUM_PLACEHOLDER = '___CSSZYX_CHECKSUM___';
const MANGLE_MAP_PLACEHOLDER = '___CSSZYX_MANGLE_MAP___';

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

    const state: PluginState = {
        classes: new Set<string>(),
        mangleMap: {},
        checksum: '',
        finalized: false,
    };

    const SAFELIST_FILENAME = 'csszyx-classes.js';
    const SOURCE_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.js']);
    const IGNORE_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.turbo']);

    /**
     * Pre-scans source files to discover class names before Tailwind CSS runs.
     * Tailwind v4 reads source files from disk and can't detect classes generated
     * by the csszyx transform (e.g. `sz={{ hover: { bg: 'gray-700' } }}` → `hover:bg-gray-700`).
     * This writes a manifest file with all discovered class names so Tailwind can scan it.
     * @param rootDir - the project root directory to scan for source files
     */
    function prescanAndWriteClasses(rootDir: string): void {
        const discoveredClasses = new Set<string>();

        /**
         * Recursively walks directories to discover source files containing sz prop usage.
         * @param dir - the directory path to scan recursively
         */
        function scanDir(dir: string): void {
            let entries;
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                        scanDir(path.join(dir, entry.name));
                    }
                } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
                    const filePath = path.join(dir, entry.name);
                    try {
                        const content = fs.readFileSync(filePath, 'utf-8');
                        if (!content.includes('sz=') && !content.includes('sz:')) {continue;}
                        const result = transformSourceCode(content);
                        if (!result.transformed) {continue;}
                        // Extract class names from transformed output
                        const classPattern = /class(?:Name)?=["']([^"']*)["']/g;
                        let match;
                        while ((match = classPattern.exec(result.code)) !== null) {
                            for (const cls of match[1].split(/\s+/).filter(Boolean)) {
                                discoveredClasses.add(cls);
                            }
                        }
                        // Also extract from className={...} expression containers (ternaries)
                        const exprPattern = /className=\{/g;
                        while ((match = exprPattern.exec(result.code)) !== null) {
                            let depth = 1;
                            let i = match.index + match[0].length;
                            while (i < result.code.length && depth > 0) {
                                if (result.code[i] === '{') {depth++;} else if (result.code[i] === '}') {depth--;}
                                i++;
                            }
                            const expr = result.code.slice(match.index + match[0].length, i - 1);
                            const strPattern = /"([^"]+)"|'([^']+)'/g;
                            let strMatch;
                            while ((strMatch = strPattern.exec(expr)) !== null) {
                                const str = strMatch[1] || strMatch[2];
                                for (const cls of str.split(/\s+/).filter(Boolean)) {
                                    discoveredClasses.add(cls);
                                }
                            }
                        }
                        // Extract static classes from _sz() runtime calls.
                        // When an sz prop has any dynamic value, the compiler wraps the
                        // entire object in _sz({...}). Static values inside are invisible
                        // to Tailwind's content scanner. Extract them here.
                        if (result.usesRuntime) {
                            const szCallRe = /_sz\(\s*\{/g;
                            let szMatch;
                            while ((szMatch = szCallRe.exec(result.code)) !== null) {
                                let depth = 1;
                                let idx = szMatch.index + szMatch[0].length;
                                while (idx < result.code.length && depth > 0) {
                                    if (result.code[idx] === '{') {depth++;} else if (result.code[idx] === '}') {depth--;}
                                    idx++;
                                }
                                const objStr = result.code.slice(szMatch.index + szMatch[0].length, idx - 1);
                                // Extract key: 'string' or "string" pairs
                                const strKv = /(\w+)\s*:\s*(?:"([^"]*)"|'([^']*)')/g;
                                let kv;
                                while ((kv = strKv.exec(objStr)) !== null) {
                                    try {
                                        const val = kv[2] ?? kv[3];
                                        const r = transform({ [kv[1]]: val });
                                        for (const c of r.className.split(/\s+/).filter(Boolean)) { discoveredClasses.add(c); }
                                    } catch { /* skip invalid */ }
                                }
                                // Extract key: number pairs
                                const numKv = /(\w+)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?=[,}\n])/g;
                                while ((kv = numKv.exec(objStr)) !== null) {
                                    try {
                                        const r = transform({ [kv[1]]: parseFloat(kv[2]) });
                                        for (const c of r.className.split(/\s+/).filter(Boolean)) { discoveredClasses.add(c); }
                                    } catch { /* skip invalid */ }
                                }
                                // Extract key: true/false pairs
                                const boolKv = /(\w+)\s*:\s*(true|false)\s*(?=[,}\n])/g;
                                while ((kv = boolKv.exec(objStr)) !== null) {
                                    try {
                                        const r = transform({ [kv[1]]: kv[2] === 'true' });
                                        for (const c of r.className.split(/\s+/).filter(Boolean)) { discoveredClasses.add(c); }
                                    } catch { /* skip invalid */ }
                                }
                            }
                        }
                    } catch {
                        // Skip files that fail to transform
                    }
                }
            }
        }

        scanDir(rootDir);

        // Also add to plugin state for mangle map building
        for (const cls of discoveredClasses) {
            state.classes.add(cls);
        }

        // Write manifest file for Tailwind to scan
        if (discoveredClasses.size > 0) {
            const safelistPath = path.join(rootDir, SAFELIST_FILENAME);
            const content =
                '// Auto-generated by csszyx — DO NOT EDIT\n' +
                '// Tailwind CSS scans this file for class name detection\n' +
                'export default "' + Array.from(discoveredClasses).join(' ') + '";\n';
            try {
                const existing = fs.existsSync(safelistPath) ? fs.readFileSync(safelistPath, 'utf-8') : '';
                if (existing !== content) {
                    fs.writeFileSync(safelistPath, content);
                }
            } catch {
                // Non-fatal: Tailwind just won't see prescanned classes
            }
        }
    }

    /**
     * Extracts classes from source code.
     * Handles both static patterns (className="...") and expression patterns
     * (className={cond ? "..." : "..."}) which arise from pre-compiled ternary expressions.
     * @param code source code
     */
    function extractClasses(code: string): void {
        // Pass 1: Direct className="..." / class="..." patterns
        const classPattern = /(?:class(?:Name)?|sz)[:=]\s*["']([^"']*)["']/g;
        let match;
        while ((match = classPattern.exec(code)) !== null) {
            const classes = match[1].split(/\s+/).filter(Boolean);
            for (const cls of classes) {
                state.classes.add(cls);
            }
        }

        // Pass 2: Extract from className={...} JSX expression containers
        // This handles pre-compiled ternary expressions like:
        // className={cond ? "text-6xl font-bold" : "text-6xl text-sm"}
        const exprStart = /className=\{/g;
        while ((match = exprStart.exec(code)) !== null) {
            let depth = 1;
            let i = match.index + match[0].length;
            while (i < code.length && depth > 0) {
                if (code[i] === '{') {depth++;} else if (code[i] === '}') {depth--;}
                i++;
            }
            const expr = code.slice(match.index + match[0].length, i - 1);
            // Extract all quoted strings within the expression
            const strPattern = /"([^"]+)"|'([^']+)'/g;
            let strMatch;
            while ((strMatch = strPattern.exec(expr)) !== null) {
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
     * Mangles a single class string using the mangle map.
     * @param classString space-separated class names
     * @returns mangled class string
     */
    function mangleClassString(classString: string): string {
        return classString.split(/\s+/)
            .map((cls: string) => state.mangleMap[cls] || cls)
            .join(' ');
    }

    /**
     * Mangles class strings in bundled code (JS/HTML assets).
     * Uses two passes:
     * 1. Direct className="..." and className:"..." patterns
     * 2. className:EXPR patterns with ternary expressions containing quoted strings
     * @param code bundled source code
     * @returns code with mangled class names
     */
    function mangleCodeClasses(code: string): string {
        // Pass 1: Direct className="..." / class="..." / className:"..."
        let result = code.replace(/(?:class(?:Name)?|sz)[:=]\s*["']([^"']*)["']/g, (match, classes) => {
            const mangled = mangleClassString(classes);
            if (mangled === classes) {return match;}
            return match.replace(classes, mangled);
        });

        // Pass 2: className:EXPR with ternary operators containing quoted strings
        // Handles patterns like: className:cond?"class-a":other?"class-b":"class-c"
        result = result.replace(/className:([^,;}\])\n]+)/g, (fullMatch, expr: string) => {
            let changed = false;
            const mangled = expr.replace(/"([^"]*)"/g, (qm: string, inner: string) => {
                const parts = inner.split(/\s+/).filter(Boolean);
                if (parts.length === 0) {return qm;}
                const mangledStr = parts.map((p: string) => state.mangleMap[p] || p).join(' ');
                if (mangledStr !== inner) {
                    changed = true;
                    return '"' + mangledStr + '"';
                }
                return qm;
            });
            if (changed) {return 'className:' + mangled;}
            return fullMatch;
        });

        return result;
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
            result = result.split(MANGLE_MAP_PLACEHOLDER).join(JSON.stringify(state.mangleMap));
        }
        return result;
    }

    const prePlugin = createUnplugin<PartialCsszyxConfig, boolean>((_pluginOptions: PartialCsszyxConfig) => ({
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
         * Filters files for the pre-transform phase — only source files outside node_modules.
         * @param id - the file path to check for inclusion
         * @returns true if the file should be transformed, false otherwise
         */
        transformInclude(id) {
            if (id.includes('node_modules') || id.includes('/packages/') || (id.includes('.next') && !id.includes('static'))) {
                return false;
            }
            // Only handle source files in PRE phase
            return /\.[tj]sx?$/.test(id) || id.endsWith('.vue') || id.endsWith('.svelte');
        },

        /**
         * Core transform: detects sz prop, compiles to className, injects runtime, collects classes.
         * @param code - the source code to transform
         * @param id - the file path of the module being transformed
         * @returns transformed code with source map, or null if no changes were made
         */
        transform(code, id) {
            let transformedCode = code;
            let usesRuntime = false;
            let usesColorVar = false;
            let transformed = false;

            // Detect sz prop in both JSX (sz="...", sz={{...}}) and JS/JSX-transformed (sz: "...", sz: {...}) formats
            const hasSzProp = code.includes('sz=') || /\bsz\s*:\s*["'{]/.test(code) || code.includes('sz: "');

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
                    const result = transformSourceCode(code);
                    transformedCode = result.code;
                    usesRuntime = result.usesRuntime;
                    usesColorVar = result.usesColorVar;
                    transformed = result.transformed;
                }
            }

            // Layout injection (SSR frameworks like Next.js)
            // Uses placeholders that are replaced in processAssets after all classes are collected
            if (transformedCode.includes('<html') && /layout|Root|Document|app\\.tsx?$/i.test(id)) {
                const attrName = options.production?.minify ? 'data-sz-cs' : 'data-sz-checksum';
                transformedCode = transformedCode.replace(/<html([^>]*)>/i, `<html$1 ${attrName}="${CHECKSUM_PLACEHOLDER}">`);

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
                if (usesRuntime) {imports.push('_sz');}
                if (usesColorVar) {imports.push('__szColorVar');}
                if (imports.length > 0 && !transformedCode.includes("from 'csszyx/lite'")) {
                    const importStmt = `import { ${imports.join(', ')} } from 'csszyx/lite';\n`;
                    const directiveMatch = transformedCode.match(/^['"]use (client|server)['"];?\s*/);
                    if (directiveMatch) {
                        const directive = directiveMatch[0];
                        transformedCode = transformedCode.replace(directive, `${directive}${importStmt}`);
                    } else {
                        transformedCode = `${importStmt}${transformedCode}`;
                    }
                    transformed = true;
                }
            }

            // Extract classes for the mangle map but DON'T mangle yet.
            // Mangling is deferred to processAssets/generateBundle where we have the complete map.
            if (transformed || transformedCode.includes('class=') || transformedCode.includes('className=')) {
                extractClasses(transformedCode);
                return { code: transformedCode, map: null };
            }
            return null;
        },

        /** Finalizes the mangle map after all source modules have been processed. */
        buildEnd() {
            finalizeMangleMap();
        },

        /**
         * Webpack hook: pre-scans source files before compilation for Tailwind class discovery.
         * @param compiler - the Webpack compiler instance
         */
        webpack(compiler: WebpackCompiler) {
            compiler.hooks.beforeCompile.tap('csszyx:prescan', () => {
                if (state.classes.size === 0) {
                    prescanAndWriteClasses(compiler.context || process.cwd());
                }
            });
        },

        vite: {
            /**
             * Vite hook: pre-scans source files when config is resolved.
             * @param config - the resolved Vite configuration object
             */
            configResolved(config) {
                // Pre-scan source files so Tailwind can discover classes
                prescanAndWriteClasses(config.root || process.cwd());
            },
            transformIndexHtml: {
                order: 'pre',
                /**
                 * Injects hydration data (mangle map + checksum) into the HTML document.
                 * @param html - the raw HTML string to transform
                 * @returns transformed HTML with injected hydration data
                 */
                handler(html) {
                    finalizeMangleMap();
                    return injectHydrationData(html, state.mangleMap, state.checksum, {
                        mode: options.production?.injectChecksum === false ? 'script' : 'script',
                        minify: process.env.NODE_ENV === 'production',
                    });
                },
            },
        },
    }));

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
            compiler.hooks.compilation.tap('csszyx:post', (compilation) => {
                // Determine stage - default to optimize size to encompass most transformations
                const stage = compiler.webpack?.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE ||
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              (compilation.constructor as any).PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE;

                compilation.hooks.processAssets.tap(
                    {
                        name: 'csszyx:post',
                        stage: stage || 400, // Fallback integer
                    },
                    (assets) => {
                        finalizeMangleMap();

                        for (const file in assets) {
                            const asset = assets[file];
                            const source = asset.source().toString();

                            if (manglingEnabled && Object.keys(state.mangleMap).length > 0) {
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
                                        if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'CssSyntaxError') {
                                            // Ignore CSS syntax errors
                                        } else {
                                            throw e;
                                        }
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
                            if (file.endsWith('.js') && (source.includes(CHECKSUM_PLACEHOLDER) || source.includes(MANGLE_MAP_PLACEHOLDER))) {
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
                                if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'CssSyntaxError') {
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
                    if (chunk.type === 'chunk' && (chunk.code.includes(CHECKSUM_PLACEHOLDER) || chunk.code.includes(MANGLE_MAP_PLACEHOLDER))) {
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
export const unplugin = defaultInstance.prePlugin; // Fallback

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
    return [prePlugin.rollup(options), postPlugin.rollup(options)] as unknown as InputPluginOption[];
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
            prePlugin.esbuild(options).setup(build);
            postPlugin.esbuild(options).setup(build);
        },
    };
};
