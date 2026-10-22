/**
 * @csszyx/svelte-adapter - Svelte preprocessor for csszyx.
 *
 * Transforms `sz` props in Svelte templates into Tailwind CSS class strings.
 * A template has no csszyx runtime, so a value lowers only when the engine
 * resolves all of it at build time; any other value is an error placed in the
 * `.svelte` file, and its attribute is left as written.
 *
 * @module @csszyx/svelte-adapter
 */

import {
    mayHoldSzAttribute,
    reportTemplateSzDiagnostics,
    rewriteTemplateSz,
    type SourceMap,
    type TemplateSzDiagnostic,
    type TemplateSzOptions,
    type TemplateSzReporter,
    transformTemplateFile,
} from '@csszyx/compiler/internal';
import type { PreprocessorGroup } from 'svelte/compiler';
import type { Plugin } from 'vite';

import { readSzAttributes } from './markup-ast.js';

/**
 * Preprocessor options.
 */
export interface SvelteAdapterOptions extends TemplateSzOptions {
    /**
     * Enable verbose logging for debugging.
     */
    debug?: boolean;
}

/**
 * Svelte preprocessor markup result.
 */
export interface PreprocessorResult {
    /**
     * The transformed source code.
     */
    code: string;
    /**
     * The map from `code` back to the source; `null` when nothing changed.
     */
    map: SourceMap | null;
    /**
     * Errors for values that got no class, and the engine's warnings, placed
     * in the source. An error's attribute is left as written. A component
     * Svelte cannot parse is one error and nothing in it changes.
     */
    diagnostics: TemplateSzDiagnostic[];
}

/**
 * Transform sz props in a Svelte component's markup.
 *
 * Supports `sz={expression}` and `sz="{expression}"`, for an expression the
 * engine resolves at build time. The class joins a quoted `class` on the same
 * side of the element's spreads, or takes the attribute's place.
 *
 * Diagnostics are placed in `content` itself.
 *
 * @param {string} content - Component source
 * @param {SvelteAdapterOptions} options - Options
 * @returns The transformed source and its map, the number of sz props
 *   transformed, and the diagnostics
 */
export function transformMarkup(
    content: string,
    options: SvelteAdapterOptions = {},
): { code: string; map: SourceMap | null; count: number; diagnostics: TemplateSzDiagnostic[] } {
    if (!mayHoldSzAttribute(content))
        return { code: content, map: null, count: 0, diagnostics: [] };
    const reading = readSzAttributes(content, options.filename);
    if (reading.diagnostics.length > 0 || reading.attributes.length === 0) {
        return { code: content, map: null, count: 0, diagnostics: reading.diagnostics };
    }
    const { code, map, count, classNames, diagnostics } = rewriteTemplateSz(
        content,
        reading.attributes,
        options,
    );
    if (options.debug) {
        reading.attributes.forEach((attribute, index) => {
            console.log(
                `[csszyx/svelte] ${attribute.value.source} -> ${JSON.stringify(classNames[index])}`,
            );
        });
    }
    return { code, map, count, diagnostics };
}

/**
 * Where the preprocessor reports: warnings on the console, and every error at
 * once as the exception Svelte reports for the file.
 */
const PREPROCESSOR_REPORTER: TemplateSzReporter = {
    warn: (message: string): void => console.warn(message),
    error: (error): never => {
        throw error;
    },
};

/**
 * Create a Svelte preprocessor for csszyx.
 *
 * An `sz` value that needs the runtime makes the preprocessor throw, naming
 * the file and position; the engine's warnings are printed.
 *
 * @param {SvelteAdapterOptions} options - Preprocessor options
 * @returns {PreprocessorGroup} Svelte preprocessor group
 *
 * @example
 * ```typescript
 * // svelte.config.js
 * import { preprocessor } from '@csszyx/svelte-adapter';
 *
 * export default {
 *     preprocess: [
 *         preprocessor(),
 *     ],
 * };
 * ```
 */
export function preprocessor(options: SvelteAdapterOptions = {}): PreprocessorGroup {
    return {
        name: 'csszyx-svelte',

        markup({ content, filename }: { content: string; filename?: string }) {
            if (!mayHoldSzAttribute(content)) {
                return;
            }

            if (options.debug && filename) {
                console.log(`[csszyx/svelte] Processing: ${filename}`);
            }

            const result = preprocess(content, { ...options, filename });
            reportTemplateSzDiagnostics(PREPROCESSOR_REPORTER, result.diagnostics);
            if (result.code === content) {
                return;
            }

            // Changed code always comes with its map.
            return { code: result.code, map: result.map as SourceMap };
        },
    };
}

/**
 * Create a Vite plugin for Svelte preprocessing.
 *
 * Note: In most cases, you should use the preprocessor directly in svelte.config.js.
 * This Vite plugin is provided for cases where you need to integrate at the Vite level.
 * An `sz` value that needs the runtime fails the build with its file and
 * position; the engine's warnings reach the bundler as warnings.
 *
 * @param {SvelteAdapterOptions} options - Plugin options
 * @returns {Plugin} Vite plugin
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import { svelte } from '@sveltejs/vite-plugin-svelte';
 * import { vitePlugin as csszyx } from '@csszyx/svelte-adapter';
 *
 * export default defineConfig({
 *     plugins: [
 *         csszyx(),
 *         svelte(),
 *     ],
 * });
 * ```
 */
export function vitePlugin(options: SvelteAdapterOptions = {}): Plugin {
    return {
        name: 'csszyx-svelte-vite',
        enforce: 'pre' as const,

        transform(code: string, id: string) {
            return transformTemplateFile(this, code, id, '.svelte', (source, filename) =>
                preprocess(source, { ...options, filename }),
            );
        },
    };
}

/**
 * Preprocess a Svelte file, transforming sz props to class attributes.
 *
 * @param {string} source - Svelte source code
 * @param {SvelteAdapterOptions} options - Preprocessor options
 * @returns {PreprocessorResult} Preprocessing result
 */
export function preprocess(source: string, options: SvelteAdapterOptions = {}): PreprocessorResult {
    const { code, map, diagnostics } = transformMarkup(source, options);
    return { code, map, diagnostics };
}

/**
 * Default export - the preprocessor function.
 */
export default preprocessor;
