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

import { rewriteStartTags } from '@csszyx/compiler';
import {
    reportTemplateSzDiagnostics,
    rewriteTemplateSz,
    type TemplateSzDiagnostic,
    type TemplateSzOptions,
    transformTemplateFile,
} from '@csszyx/compiler/internal';
import type { PreprocessorGroup } from 'svelte/compiler';
import type { Plugin } from 'vite';

import { findSzAttributes } from './attributes.js';

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
     * Optional source map.
     */
    map?: object | null;
    /**
     * Errors for values that got no class, and the engine's warnings, placed
     * in the source. An error's attribute is left as written.
     */
    diagnostics: TemplateSzDiagnostic[];
}

/**
 * Transform sz props in a Svelte component's markup.
 *
 * Supports:
 * - Bound: sz={expression} (any expression the engine resolves at build time)
 * - Quoted: sz="{{ p: 4 }}" or sz="{ p: 4 }"
 *
 * `<script>` and `<style>` blocks are not read. Diagnostics are placed in
 * `content` itself.
 *
 * @param {string} content - Component source
 * @param {SvelteAdapterOptions} options - Options
 * @returns The transformed source, the number of sz props transformed, and the diagnostics
 */
export function transformMarkup(
    content: string,
    options: SvelteAdapterOptions = {},
): { code: string; count: number; diagnostics: TemplateSzDiagnostic[] } {
    const found = findSzAttributes(content);
    const { code, count, classNames, diagnostics } = rewriteTemplateSz(
        content,
        { from: 0, to: content.length },
        found,
        options,
    );
    if (options.debug) {
        found.forEach((attribute, index) => {
            console.log(
                `[csszyx/svelte] ${attribute.value.source} -> ${JSON.stringify(classNames[index])}`,
            );
        });
    }
    return { code, count, diagnostics };
}

/**
 * Where a quoted string or a brace group that starts at `open` ends: the
 * index of its closing quote or brace, or the tag's end when it never closes.
 * Quotes inside a brace group are JavaScript strings, so their braces do not
 * count.
 *
 * @param tag - One element's start tag.
 * @param open - Index of the opening quote or `{`.
 * @returns The index of its closing character.
 */
function closeOf(tag: string, open: number): number {
    const opener = tag.charAt(open);
    if (opener !== '{') {
        const close = tag.indexOf(opener, open + 1);
        return close === -1 ? tag.length : close;
    }
    let depth = 0;
    let index = open;
    while (index < tag.length) {
        const char = tag.charAt(index);
        if (char === '"' || char === "'" || char === '`') {
            index = closeOf(tag, index);
        } else if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
        index += 1;
    }
    return tag.length;
}

/**
 * A tag cut at its spreads: the parts between them, each spread its own part.
 *
 * One pass over the tag. Quoted values and brace groups are stepped over
 * whole, so only a `{...` that stands where an attribute does is a spread,
 * not one inside an action's argument or an expression, however it is
 * spaced.
 *
 * @param tag - One element's start tag.
 * @returns The parts, in order; joined they are the tag.
 */
function splitAtSpreads(tag: string): string[] {
    const parts: string[] = [];
    let from = 0;
    let index = 0;
    while (index < tag.length) {
        const char = tag.charAt(index);
        if (char !== '{' && char !== '"' && char !== "'") {
            index += 1;
            continue;
        }
        const close = closeOf(tag, index);
        if (char === '{' && tag.startsWith('{...', index)) {
            parts.push(tag.slice(from, index), tag.slice(index, close + 1));
            from = close + 1;
        }
        index = close + 1;
    }
    parts.push(tag.slice(from));
    return parts;
}

/**
 * Merge the class attributes of one side of a tag's spreads into the first.
 *
 * @param side - Part of a tag between spreads, or a spread itself.
 * @returns The part with one class attribute.
 */
function mergeSideClasses(side: string): string {
    const matches = [...side.matchAll(/\bclass="([^"]*)"/g)].map(m => m[1]);
    if (matches.length < 2) return side;
    const firstIdx = side.indexOf('class="');
    const cleaned = side.replace(/\bclass="[^"]*"/g, '');
    return `${cleaned.slice(0, firstIdx)}class="${matches.join(' ')}"${cleaned.slice(firstIdx)}`;
}

/**
 * Merge transformed classes with existing class attribute.
 *
 * @param {string} content - Content with sz props transformed to class
 * @returns {string} Content with merged class attributes
 */
export function mergeClassAttributes(content: string): string {
    // A spread is a wall: only the class attributes on one side of it merge.
    // Two left on either side of one make Svelte stop the build, which says
    // where; a spread's class sits between them, and which one wins is
    // Svelte's rule to state, not a merge to guess.
    return rewriteStartTags(content, tag =>
        tag.includes('{...')
            ? splitAtSpreads(tag).map(mergeSideClasses).join('')
            : mergeSideClasses(tag),
    );
}

/**
 * Where the preprocessor reports: warnings on the console, and every error at
 * once as the exception Svelte reports for the file.
 */
const PREPROCESSOR_REPORTER = {
    warn: (message: string): void => console.warn(message),
    error: (message: string): never => {
        throw new Error(message);
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
            // Skip if no sz props
            if (!content.includes('sz=')) {
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

            return {
                code: result.code,
                map: undefined, // Source-map generation is not implemented yet.
            };
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
    const transformResult = transformMarkup(source, options);

    if (transformResult.count === 0) {
        return { code: source, map: undefined, diagnostics: transformResult.diagnostics };
    }

    return {
        code: mergeClassAttributes(transformResult.code),
        map: undefined,
        diagnostics: transformResult.diagnostics,
    };
}

/**
 * Default export - the preprocessor function.
 */
export default preprocessor;
