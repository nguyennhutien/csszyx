/**
 * @csszyx/svelte-adapter - Svelte preprocessor for csszyx.
 *
 * Transforms `sz` props in Svelte templates into Tailwind CSS class strings.
 *
 * @module @csszyx/svelte-adapter
 */

import { parseStaticObjectLiteral, type SzObject, transform } from '@csszyx/compiler';

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
 * Parse a recursively static JavaScript object literal.
 * @param source - Object literal source.
 * @returns Parsed sz object, or null for dynamic/invalid syntax.
 */
export function parseObjectLiteral(source: string): SzObject | null {
    return parseStaticObjectLiteral(source);
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
    let result = '';
    let count = 0;
    let cursor = 0;

    while (cursor < content.length) {
        const attributeStart = findSzAttribute(content, cursor);
        if (attributeStart === -1) {
            result += content.slice(cursor);
            break;
        }

        result += content.slice(cursor, attributeStart);
        const match = readSzAttribute(content, attributeStart);
        if (!match) {
            result += content.slice(attributeStart, attributeStart + 3);
            cursor = attributeStart + 3;
            continue;
        }

        const szObj = parseObjectLiteral(match.objectSource);
        if (!szObj) {
            if (options.debug) {
                console.warn(`[csszyx/svelte] Failed to parse sz object: ${match.objectSource}`);
            }
            result += content.slice(attributeStart, match.end);
        } else {
            const className = transform(szObj).className;
            count += 1;
            if (options.debug) {
                console.log(`[csszyx/svelte] Transformed: ${match.objectSource} -> "${className}"`);
            }
            result += `class="${className}"`;
        }
        cursor = match.end;
    }

    return { code: result, count };
}

/**
 * Parsed bounds and object source for a static `sz` attribute.
 */
interface SzAttributeMatch {
    end: number;
    objectSource: string;
}

/**
 * Finds the next standalone `sz=` attribute without regex backtracking.
 *
 * @param content Svelte markup source.
 * @param from Offset at which scanning begins.
 * @returns Attribute start offset, or -1 when absent.
 */
function findSzAttribute(content: string, from: number): number {
    let index = content.indexOf('sz=', from);
    while (index !== -1) {
        const before = index === 0 ? '<' : content.charAt(index - 1);
        if (
            before === '<' ||
            before === ' ' ||
            before === '\t' ||
            before === '\n' ||
            before === '\r'
        ) {
            return index;
        }
        index = content.indexOf('sz=', index + 3);
    }
    return -1;
}

/**
 * Reads a quoted or bound static object from an `sz=` attribute.
 *
 * @param content Svelte markup source.
 * @param start Offset of the `sz=` token.
 * @returns Parsed attribute bounds, or null when unsupported or malformed.
 */
function readSzAttribute(content: string, start: number): SzAttributeMatch | null {
    const valueStart = start + 3;
    const opener = content.charAt(valueStart);
    if (opener === '"' || opener === "'") {
        const endQuote = content.indexOf(opener, valueStart + 1);
        if (endQuote === -1) {
            return null;
        }
        let objectSource = content.slice(valueStart + 1, endQuote);
        if (objectSource.startsWith('{{') && objectSource.endsWith('}}')) {
            objectSource = objectSource.slice(1, -1);
        }
        if (!objectSource.startsWith('{') || !objectSource.endsWith('}')) {
            return null;
        }
        return { end: endQuote + 1, objectSource };
    }

    if (opener !== '{' || content.charAt(valueStart + 1) !== '{') {
        return null;
    }
    const end = findBalancedBraceEnd(content, valueStart);
    if (end === -1) {
        return null;
    }
    return {
        end: end + 1,
        objectSource: content.slice(valueStart + 1, end),
    };
}

/**
 * Finds the closing brace for a JavaScript expression in linear time.
 *
 * @param content Svelte markup source.
 * @param start Offset of the opening expression brace.
 * @returns Closing brace offset, or -1 when unbalanced.
 */
function findBalancedBraceEnd(content: string, start: number): number {
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = start; index < content.length; index += 1) {
        const char = content.charAt(index);
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                quote = '';
            }
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            quote = char;
        } else if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return -1;
}

/**
 * Merge transformed classes with existing class attribute.
 *
 * @param {string} content - Content with sz props transformed to class
 * @returns {string} Content with merged class attributes
 */
export function mergeClassAttributes(content: string): string {
    let result = content;
    let i = 0;
    while (i < result.length) {
        const start = result.indexOf('<', i);
        if (start === -1) break;
        const end = result.indexOf('>', start);
        if (end === -1) break;
        const tag = result.slice(start, end + 1);
        i = end + 1;
        if (!/^<[a-z]/i.test(tag)) continue;
        const matches = [...tag.matchAll(/\bclass="([^"]*)"/g)].map(m => m[1]);
        if (matches.length < 2) continue;
        const merged = matches.join(' ');
        const firstIdx = tag.indexOf('class="');
        const cleaned = tag.replace(/\bclass="[^"]*"/g, '');
        const newTag = `${cleaned.slice(0, firstIdx)}class="${merged}"${cleaned.slice(firstIdx)}`;
        result = result.slice(0, start) + newTag + result.slice(end + 1);
        i = start + newTag.length;
    }
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
