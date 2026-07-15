/**
 * @csszyx/vue-adapter - Vue SFC preprocessor for csszyx.
 *
 * Transforms `sz` props in Vue SFC templates into Tailwind CSS class strings.
 *
 * @module @csszyx/vue-adapter
 */

import { parseStaticObjectLiteral, type SzObject, transform } from '@csszyx/compiler';

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
 * Parse a recursively static JavaScript object literal.
 * @param source - Object literal source.
 * @returns Parsed sz object, or null for dynamic/invalid syntax.
 */
export function parseObjectLiteral(source: string): SzObject | null {
    return parseStaticObjectLiteral(source);
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
    // indexOf-based scan avoids the polynomial backtracking that a
    // <template(\s[^>]*)?>...</template> regex would suffer on inputs
    // with repeated "<template " prefixes.
    const lowered = source.toLowerCase();
    let openStart = -1;
    let openEnd = -1;
    let i = 0;
    while (i < lowered.length) {
        const candidate = lowered.indexOf('<template', i);
        if (candidate === -1) return null;
        const after = lowered.charAt(candidate + '<template'.length);
        if (after === '>' || after === ' ' || after === '\t' || after === '\n' || after === '\r') {
            const tagClose = lowered.indexOf('>', candidate);
            if (tagClose === -1) return null;
            openStart = candidate;
            openEnd = tagClose + 1;
            break;
        }
        i = candidate + 1;
    }
    if (openStart === -1) return null;

    const closeStart = lowered.indexOf('</template>', openEnd);
    if (closeStart === -1) return null;

    return {
        content: source.slice(openEnd, closeStart),
        start: openEnd,
        end: closeStart,
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
    let result = '';
    let count = 0;
    let cursor = 0;

    while (cursor < template.length) {
        const attribute = findVueSzAttribute(template, cursor);
        if (!attribute) {
            result += template.slice(cursor);
            break;
        }
        result += template.slice(cursor, attribute.start);
        const match = readQuotedSzAttribute(template, attribute.start, attribute.valueStart);
        if (!match) {
            result += template.slice(attribute.start, attribute.valueStart);
            cursor = attribute.valueStart;
            continue;
        }

        const szObj = parseObjectLiteral(match.objectSource);
        if (!szObj) {
            if (options.debug) {
                console.warn(`[csszyx/vue] Failed to parse sz object: ${match.objectSource}`);
            }
            result += template.slice(attribute.start, match.end);
        } else {
            const className = transform(szObj).className;
            count += 1;
            if (options.debug) {
                console.log(`[csszyx/vue] Transformed: ${match.objectSource} -> "${className}"`);
            }
            result += `class="${className}"`;
        }
        cursor = match.end;
    }

    return {
        code: result,
        transformed: count > 0,
        count,
    };
}

/**
 * Bounds for a supported Vue `sz` attribute.
 */
interface VueSzAttribute {
    start: number;
    valueStart: number;
}

/**
 * Parsed bounds and object source for a quoted Vue `sz` attribute.
 */
interface QuotedSzAttribute {
    end: number;
    objectSource: string;
}

/**
 * Finds static Vue `sz`, `:sz`, and `v-bind:sz` attributes in linear time.
 *
 * @param template Vue template source.
 * @param from Offset at which scanning begins.
 * @returns Attribute bounds, or null when absent.
 */
function findVueSzAttribute(template: string, from: number): VueSzAttribute | null {
    let szStart = template.indexOf('sz=', from);
    while (szStart !== -1) {
        for (const prefix of ['v-bind:', ':', '']) {
            const start = szStart - prefix.length;
            if (start < 0 || template.slice(start, szStart) !== prefix) {
                continue;
            }
            const before = start === 0 ? '<' : template.charAt(start - 1);
            if (isAttributeBoundary(before)) {
                return { start, valueStart: szStart + 3 };
            }
        }
        szStart = template.indexOf('sz=', szStart + 3);
    }
    return null;
}

/**
 * Reads a quoted static object attribute without regular-expression backtracking.
 *
 * @param template Vue template source.
 * @param start Start offset including the optional binding prefix.
 * @param valueStart Offset immediately after `sz=`.
 * @returns Parsed attribute, or null when unsupported or malformed.
 */
function readQuotedSzAttribute(
    template: string,
    start: number,
    valueStart: number,
): QuotedSzAttribute | null {
    const quote = template.charAt(valueStart);
    if (quote !== '"' && quote !== "'") {
        return null;
    }
    const endQuote = template.indexOf(quote, valueStart + 1);
    if (endQuote === -1) {
        return null;
    }
    const objectSource = template.slice(valueStart + 1, endQuote);
    if (!objectSource.startsWith('{') || !objectSource.endsWith('}')) {
        return null;
    }
    return { end: endQuote + 1, objectSource };
}

/**
 * Returns whether a character can precede an HTML attribute.
 *
 * @param char Character before an attribute.
 * @returns Whether the character is an attribute boundary.
 */
function isAttributeBoundary(char: string): boolean {
    return char === '<' || char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

/**
 * Merge transformed classes with existing class attribute.
 *
 * @param {string} template - Template with sz props transformed to class
 * @returns {string} Template with merged class attributes
 */
export function mergeClassAttributes(template: string): string {
    let result = template;
    let i = 0;
    while (i < result.length) {
        const start = result.indexOf('<', i);
        if (start === -1) break;
        const end = result.indexOf('>', start);
        if (end === -1) break;
        const tag = result.slice(start, end + 1);
        i = end + 1;
        if (!/^<[a-z]/i.test(tag)) continue;
        // Attribute names must be anchored on whitespace: `\b` can never sit
        // before `:` (both sides non-word), so `\b:class` matched nothing and
        // the shorthand form silently skipped merging — while `\bclass` DID
        // match inside `:class`, stealing the dynamic attribute as static.
        const staticMatch = /(?:^|\s)class="([^"]*)"/.exec(tag);
        const dynamicMatch = /(?:^|\s)(?::class|v-bind:class)="([^"]*)"/.exec(tag);
        if (!staticMatch || !dynamicMatch) continue;
        const cleaned = tag
            .replace(/(^|\s)class="[^"]*"/, '$1')
            .replace(/(^|\s)(?::class|v-bind:class)="[^"]*"/, '$1');
        const insertIdx = cleaned.indexOf(' ') + 1;
        const newTag = `${cleaned.slice(0, insertIdx)}:class="['${staticMatch[1]}', ${dynamicMatch[1]}]" ${cleaned.slice(insertIdx)}`;
        result = result.slice(0, start) + newTag + result.slice(end + 1);
        i = start + newTag.length;
    }
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
                map: null, // Source-map generation is not implemented yet.
            };
        },
    };
}

/**
 * Default export for convenient importing.
 */
export default vitePlugin;
