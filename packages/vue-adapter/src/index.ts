/**
 * @csszyx/vue-adapter - Vue SFC preprocessor for csszyx.
 *
 * Transforms `sz` props in Vue SFC templates into Tailwind CSS class strings.
 *
 * @module @csszyx/vue-adapter
 */

import { type SzObject, transform } from '@csszyx/compiler';

/**
 * Preprocessor options.
 */
export interface VueAdapterOptions {
    /**
     * Enable verbose logging for debugging.
     */
    debug?: boolean;
}

/**
 * Result of preprocessing a Vue SFC.
 */
export interface PreprocessResult {
    /**
     * The transformed source code.
     */
    code: string;
    /**
     * Whether any transformations were made.
     */
    transformed: boolean;
    /**
     * Number of sz props transformed.
     */
    count: number;
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
 * Extract the template section from a Vue SFC.
 *
 * @param {string} source - Vue SFC source code
 * @returns {{ content: string; start: number; end: number } | null} Template info or null
 */
export function extractTemplate(source: string): {
    content: string;
    start: number;
    end: number;
} | null {
    // Match <template> tags (with or without attributes)
    const templateRegex = /<template(\s[^>]*)?>[\s\S]*?<\/template>/gi;
    const match = templateRegex.exec(source);

    if (!match) {
        return null;
    }

    // Find the actual content between template tags
    const fullMatch = match[0];
    const startTag = fullMatch.match(/<template(\s[^>]*)?>/i)?.[0] || '<template>';
    const endTag = '</template>';

    const contentStart = fullMatch.indexOf(startTag) + startTag.length;
    const contentEnd = fullMatch.lastIndexOf(endTag);

    return {
        content: fullMatch.slice(contentStart, contentEnd),
        start: match.index + contentStart,
        end: match.index + contentEnd,
    };
}

/**
 * Transform sz props in a template string.
 *
 * Supports:
 * - Static: sz="{ p: 4 }" or sz='{ p: 4 }'
 * - Bound (Vue): :sz="{ p: 4 }" or v-bind:sz="{ p: 4 }"
 *
 * @param {string} template - Template string
 * @param {VueAdapterOptions} options - Options
 * @returns {PreprocessResult} Transformation result
 */
export function transformTemplate(
    template: string,
    options: VueAdapterOptions = {},
): PreprocessResult {
    let result = template;
    let count = 0;

    // Pattern to match sz attributes
    // Matches: sz="{ ... }", sz='{ ... }', :sz="{ ... }", v-bind:sz="{ ... }"
    const szPattern = /(?:v-bind:|:)?sz=["'](\{[\s\S]*?\})["']/g;

    result = result.replace(szPattern, (match, objStr) => {
        const szObj = parseObjectLiteral(objStr);

        if (!szObj) {
            if (options.debug) {
                console.warn(`[csszyx/vue] Failed to parse sz object: ${objStr}`);
            }
            return match; // Return unchanged if parsing fails
        }

        const className = transform(szObj);
        count++;

        if (options.debug) {
            console.log(`[csszyx/vue] Transformed: ${objStr} -> "${className}"`);
        }

        return `class="${className}"`;
    });

    return {
        code: result,
        transformed: count > 0,
        count,
    };
}

/**
 * Merge transformed classes with existing class attribute.
 *
 * @param {string} template - Template with sz props transformed to class
 * @returns {string} Template with merged class attributes
 */
export function mergeClassAttributes(template: string): string {
    // Pattern to find elements with multiple class attributes
    // This handles cases where both :class and class (from sz) exist
    const multiClassPattern =
        /(<[a-zA-Z][a-zA-Z0-9-]*\s[^>]*?)class="([^"]*)"([^>]*?)(?::class|v-bind:class)="([^"]*)"([^>]*?>)/g;

    let result = template;

    // Merge class="..." with :class="..."
    result = result.replace(
        multiClassPattern,
        (match, before, staticClass, middle, dynamicClass, after) => {
            // Combine static class with dynamic class using array syntax
            return `${before}:class="['${staticClass}', ${dynamicClass}]"${middle}${after}`;
        },
    );

    // Also handle reverse order: :class before class
    const reversePattern =
        /(<[a-zA-Z][a-zA-Z0-9-]*\s[^>]*?)(?::class|v-bind:class)="([^"]*)"([^>]*?)class="([^"]*)"([^>]*?>)/g;

    result = result.replace(
        reversePattern,
        (match, before, dynamicClass, middle, staticClass, after) => {
            return `${before}:class="['${staticClass}', ${dynamicClass}]"${middle}${after}`;
        },
    );

    return result;
}

/**
 * Preprocess a Vue SFC file, transforming sz props to class attributes.
 *
 * @param {string} source - Vue SFC source code
 * @param {VueAdapterOptions} options - Preprocessor options
 * @returns {PreprocessResult} Preprocessing result
 *
 * @example
 * ```typescript
 * import { preprocess } from '@csszyx/vue-adapter';
 *
 * const result = preprocess(`
 *   <template>
 *     <div sz="{ p: 4, bg: 'red-500' }">Hello</div>
 *   </template>
 * `);
 *
 * // result.code contains:
 * // <template>
 * //   <div class="p-4 bg-red-500">Hello</div>
 * // </template>
 * ```
 */
export function preprocess(source: string, options: VueAdapterOptions = {}): PreprocessResult {
    // Extract template section
    const templateInfo = extractTemplate(source);

    if (!templateInfo) {
        return {
            code: source,
            transformed: false,
            count: 0,
        };
    }

    // Transform sz props in template
    const transformResult = transformTemplate(templateInfo.content, options);

    if (!transformResult.transformed) {
        return {
            code: source,
            transformed: false,
            count: 0,
        };
    }

    // Merge any duplicate class attributes
    const mergedContent = mergeClassAttributes(transformResult.code);

    // Reconstruct the source with transformed template
    const code =
        source.slice(0, templateInfo.start) + mergedContent + source.slice(templateInfo.end);

    return {
        code,
        transformed: true,
        count: transformResult.count,
    };
}

/**
 * Create a Vite plugin for Vue SFC preprocessing.
 *
 * @param {VueAdapterOptions} options - Plugin options
 * @returns {object} Vite plugin
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import vue from '@vitejs/plugin-vue';
 * import { vitePlugin as csszyx } from '@csszyx/vue-adapter';
 *
 * export default defineConfig({
 *     plugins: [
 *         csszyx(),
 *         vue(),
 *     ],
 * });
 * ```
 */
import type { Plugin } from 'vite';

/**
 * Create a Vite plugin for Vue SFC preprocessing.
 *
 * @param {VueAdapterOptions} options - Plugin options
 * @returns {Plugin} Vite plugin
 */
export function vitePlugin(options: VueAdapterOptions = {}): Plugin {
    return {
        name: 'csszyx-vue',
        enforce: 'pre' as const,

        transform(code: string, id: string) {
            // Only process Vue SFC files
            if (!id.endsWith('.vue')) {
                return null;
            }

            // Skip if no sz props
            if (!code.includes('sz=')) {
                return null;
            }

            const result = preprocess(code, options);

            if (!result.transformed) {
                return null;
            }

            return {
                code: result.code,
                map: null, // TODO: Generate source map
            };
        },
    };
}

/**
 * Default export for convenient importing.
 */
export default vitePlugin;
