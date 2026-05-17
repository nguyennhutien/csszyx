/**
 * @csszyx/svelte-adapter - Svelte preprocessor for csszyx.
 *
 * Transforms `sz` props in Svelte templates into Tailwind CSS class strings.
 *
 * @module @csszyx/svelte-adapter
 */

import { type SzObject, transform } from '@csszyx/compiler';

/**
 * Preprocessor options.
 */
export interface SvelteAdapterOptions {
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
}

/**
 * Parse a JavaScript object literal string into an object.
 * Handles nested objects for variants like hover, focus, etc.
 *
 * @param {string} objStr - Object literal string (e.g., "{ p: 4, bg: 'red-500' }")
 * @returns {SzObject | null} Parsed object or null if invalid
 */
export function parseObjectLiteral(objStr: string): SzObject | null {
    try {
        // Remove outer braces and whitespace
        const content = objStr.trim();

        // Use Function constructor to safely evaluate the object
        // This is safer than eval and works for static objects
        const fn = new Function(`return (${content})`);
        const result = fn();

        if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
            return result as SzObject;
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Transform sz props in a Svelte template string.
 *
 * Supports:
 * - Static: sz="{{ p: 4 }}" or sz="{ p: 4 }"
 * - Shorthand bind: sz={expression} (only static objects supported)
 *
 * @param {string} content - Template content
 * @param {SvelteAdapterOptions} options - Options
 * @returns {{ code: string; count: number }} Transformation result
 */
export function transformMarkup(
    content: string,
    options: SvelteAdapterOptions = {},
): { code: string; count: number } {
    let result = content;
    let count = 0;

    // Pattern 1: sz="{{ ... }}" or sz="{ ... }" (double braces for escaped or single braces)
    // In Svelte, double braces {{ }} are escaped and render as literal { }
    const staticPattern = /sz="(\{\{?[\s\S]*?\}\}?)"/g;

    result = result.replace(staticPattern, (match, objStr) => {
        // Handle double braces (escaped) - convert to single
        let normalizedObjStr = objStr;
        if (objStr.startsWith('{{') && objStr.endsWith('}}')) {
            normalizedObjStr = objStr.slice(1, -1);
        }

        const szObj = parseObjectLiteral(normalizedObjStr);

        if (!szObj) {
            if (options.debug) {
                console.warn(`[csszyx/svelte] Failed to parse sz object: ${objStr}`);
            }
            return match; // Return unchanged if parsing fails
        }

        const className = transform(szObj);
        count++;

        if (options.debug) {
            console.log(`[csszyx/svelte] Transformed: ${objStr} -> "${className}"`);
        }

        return `class="${className}"`;
    });

    // Pattern 2: sz={...} (Svelte expression binding with static object)
    const bindPattern = /sz=\{(\{[\s\S]*?\})\}/g;

    result = result.replace(bindPattern, (match, objStr) => {
        const szObj = parseObjectLiteral(objStr);

        if (!szObj) {
            if (options.debug) {
                console.warn(`[csszyx/svelte] Failed to parse sz binding: ${objStr}`);
            }
            return match; // Return unchanged if parsing fails
        }

        const className = transform(szObj);
        count++;

        if (options.debug) {
            console.log(`[csszyx/svelte] Transformed binding: ${objStr} -> "${className}"`);
        }

        return `class="${className}"`;
    });

    return { code: result, count };
}

/**
 * Merge transformed classes with existing class attribute.
 *
 * @param {string} content - Content with sz props transformed to class
 * @returns {string} Content with merged class attributes
 */
export function mergeClassAttributes(content: string): string {
    // Pattern to find elements with multiple class attributes
    // This handles cases where both class:directive and class (from sz) exist
    const multiClassPattern =
        /(<[a-zA-Z][a-zA-Z0-9-]*\s[^>]*?)class="([^"]*)"([^>]*?)class="([^"]*)"([^>]*?>)/g;

    let result = content;

    // Merge duplicate class="..." attributes
    result = result.replace(multiClassPattern, (match, before, class1, middle, class2, after) => {
        // Combine classes with space
        return `${before}class="${class1} ${class2}"${middle}${after}`;
    });

    // Handle class:name={condition} combined with class=""
    // Pattern: class="..." followed by class:name or vice versa
    const classDirectivePattern =
        /(<[a-zA-Z][a-zA-Z0-9-]*\s[^>]*?)class="([^"]*)"([^>]*?)(class:[a-zA-Z-]+(?:=\{[^}]*\})?)/g;

    result = result.replace(
        classDirectivePattern,
        (match, before, staticClass, middle, directive) => {
            // Keep both - static class and conditional directive
            return `${before}class="${staticClass}"${middle}${directive}`;
        },
    );

    return result;
}

/**
 * Create a Svelte preprocessor for csszyx.
 *
 * @param {SvelteAdapterOptions} options - Preprocessor options
 * @returns {object} Svelte preprocessor
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
import type { PreprocessorGroup } from 'svelte/compiler';
import type { Plugin } from 'vite';

/**
 * Create a Svelte preprocessor for csszyx.
 *
 * @param {SvelteAdapterOptions} options - Preprocessor options
 * @returns {PreprocessorGroup} Svelte preprocessor group
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

            // Transform sz props
            const transformResult = transformMarkup(content, options);

            if (transformResult.count === 0) {
                return;
            }

            // Merge any duplicate class attributes
            const mergedContent = mergeClassAttributes(transformResult.code);

            if (options.debug) {
                console.log(`[csszyx/svelte] Transformed ${transformResult.count} sz props`);
            }

            return {
                code: mergedContent,
                map: undefined, // TODO: Generate source map
            };
        },
    };
}

/**
 * Create a Vite plugin for Svelte preprocessing.
 *
 * Note: In most cases, you should use the preprocessor directly in svelte.config.js.
 * This Vite plugin is provided for cases where you need to integrate at the Vite level.
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
            // Only process Svelte files
            if (!id.endsWith('.svelte')) {
                return null;
            }

            // Skip if no sz props
            if (!code.includes('sz=')) {
                return null;
            }

            // Transform sz props
            const transformResult = transformMarkup(code, options);

            if (transformResult.count === 0) {
                return null;
            }

            // Merge any duplicate class attributes
            const mergedContent = mergeClassAttributes(transformResult.code);

            return {
                code: mergedContent,
                map: undefined, // TODO: Generate source map
            };
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
        return {
            code: source,
            map: undefined,
        };
    }

    const mergedContent = mergeClassAttributes(transformResult.code);

    return {
        code: mergedContent,
        map: undefined,
    };
}

/**
 * Default export - the preprocessor function.
 */
export default preprocessor;
