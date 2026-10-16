/**
 * @csszyx/vue-adapter - Vue SFC preprocessor for csszyx.
 *
 * Transforms `sz` props in Vue SFC templates into Tailwind CSS class strings.
 * A template has no csszyx runtime, so a value lowers only when the engine
 * resolves all of it at build time; any other value is an error placed in the
 * `.vue` file, and its attribute is left as written.
 *
 * @module @csszyx/vue-adapter
 */

import { rewriteStartTags } from '@csszyx/compiler';
import {
    rewriteTemplateSz,
    type TemplateSzAttribute,
    type TemplateSzDiagnostic,
    type TemplateSzOptions,
    transformTemplateFile,
} from '@csszyx/compiler/internal';
import type { Plugin } from 'vite';

import { decodeCharacterReferences } from './character-references.js';
import { findRootTemplate } from './sfc-template.js';

/**
 * Preprocessor options.
 */
export interface VueAdapterOptions extends TemplateSzOptions {
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
    /**
     * Errors for values that got no class, and the engine's warnings, placed
     * in the source. An error's attribute is left as written.
     */
    diagnostics: TemplateSzDiagnostic[];
}

/**
 * Extract the root template section from a Vue SFC: up to the `</template>`
 * that closes it, past any nested `<template>` and any `</template>` written
 * in a comment, an attribute value, an interpolation or a `<script>` block.
 *
 * @param {string} source - Vue SFC source code
 * @returns {{ content: string; start: number; end: number } | null} Template info or null
 */
export function extractTemplate(source: string): {
    content: string;
    start: number;
    end: number;
} | null {
    const bounds = findRootTemplate(source);
    return bounds && { content: source.slice(bounds.start, bounds.end), ...bounds };
}

/**
 * Transform sz props in a template string.
 *
 * Supports:
 * - Quoted: sz="{ p: 4 }" or sz='{ p: 4 }' (an object or an array)
 * - Bound: :sz="{ p: 4 }" or v-bind:sz="{ p: 4 }"
 *
 * Either way the value must be static: a template has no csszyx runtime, so a
 * value only known at runtime (`:sz="{ p: size }"`) is an error and the
 * attribute is left as written.
 *
 * Diagnostics are placed in `template` itself.
 *
 * @param {string} template - Template string
 * @param {VueAdapterOptions} options - Options
 * @returns {PreprocessResult} Transformation result
 */
export function transformTemplate(
    template: string,
    options: VueAdapterOptions = {},
): PreprocessResult {
    return transformRegion(template, 0, template.length, options);
}

/**
 * Lower the sz attributes between two offsets of a file, in one engine batch.
 *
 * @param file - The whole file; diagnostics are placed in it.
 * @param from - Offset where the region starts.
 * @param to - Offset where the region ends.
 * @param options - Options.
 * @returns The region's rewritten text, and the diagnostics.
 */
function transformRegion(
    file: string,
    from: number,
    to: number,
    options: VueAdapterOptions,
): PreprocessResult {
    const found = findSzAttributes(file, from, to);
    const { code, count, classNames, diagnostics } = rewriteTemplateSz(
        file,
        { from, to },
        found,
        options,
    );
    if (options.debug) {
        found.forEach((attribute, index) => {
            console.log(
                `[csszyx/vue] ${attribute.value.source} -> ${JSON.stringify(classNames[index])}`,
            );
        });
    }
    return { code, transformed: count > 0, count, diagnostics };
}

/**
 * Collect the sz attributes between two offsets, in order.
 *
 * @param file - The whole file.
 * @param from - Offset where scanning starts.
 * @param to - Offset where scanning stops.
 * @returns The attributes with a quoted value.
 */
function findSzAttributes(file: string, from: number, to: number): TemplateSzAttribute[] {
    const found: TemplateSzAttribute[] = [];
    let cursor = from;
    for (;;) {
        const attribute = findVueSzAttribute(file, cursor);
        if (!attribute || attribute.start >= to) return found;
        const match = readQuotedSzAttribute(file, attribute, to);
        if (match) found.push(match);
        cursor = match ? match.end : attribute.valueStart;
    }
}

/**
 * Bounds for a supported Vue `sz` attribute.
 */
interface VueSzAttribute {
    start: number;
    valueStart: number;
    /** Whether the attribute is bound (`:sz` or `v-bind:sz`). */
    bound: boolean;
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
                return { start, valueStart: szStart + 3, bound: prefix !== '' };
            }
        }
        szStart = template.indexOf('sz=', szStart + 3);
    }
    return null;
}

/**
 * Reads a quoted attribute value without regular-expression backtracking.
 *
 * A bound value is any expression. A static `sz="..."` is a string to Vue, so
 * it is read only when it is written as an object or an array; a plain string
 * such as `sz="lg"` is some component's own prop and is left alone.
 *
 * @param template Vue template source.
 * @param attribute The attribute's bounds.
 * @param to Offset the value must close before.
 * @returns The attribute, or null when unsupported or malformed.
 */
function readQuotedSzAttribute(
    template: string,
    attribute: VueSzAttribute,
    to: number,
): TemplateSzAttribute | null {
    const { valueStart } = attribute;
    const quote = template.charAt(valueStart);
    if (quote !== '"' && quote !== "'") {
        return null;
    }
    const endQuote = template.indexOf(quote, valueStart + 1);
    if (endQuote === -1 || endQuote >= to) {
        return null;
    }
    const written = template.slice(valueStart + 1, endQuote);
    if (!attribute.bound && !/^\s*[{[]/.test(written)) {
        return null;
    }
    const decoded = decodeCharacterReferences(written, valueStart + 1);
    return {
        start: attribute.start,
        end: endQuote + 1,
        value: { ...decoded, start: valueStart + 1 },
    };
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
 * A class string as a JavaScript string literal inside a double-quoted Vue
 * attribute.
 *
 * @param text - The class attribute's text, as written.
 * @returns The literal, escaped for the attribute.
 */
function classLiteral(text: string): string {
    const value = decodeCharacterReferences(text, 0).source;
    const escaped = value.replace(/[\\']/g, String.raw`\$&`);
    const literal = `'${escaped}'`;
    return literal.replace(/[&"<]/g, char => `&#${char.charCodeAt(0)};`);
}

/**
 * Merge transformed classes with existing class attribute.
 *
 * @param {string} template - Template with sz props transformed to class
 * @returns {string} Template with merged class attributes
 */
export function mergeClassAttributes(template: string): string {
    return rewriteStartTags(template, tag => {
        // Attribute names must be anchored on whitespace: `\b` can never sit
        // before `:` (both sides non-word), so `\b:class` matched nothing and
        // the shorthand form silently skipped merging — while `\bclass` DID
        // match inside `:class`, stealing the dynamic attribute as static.
        const staticMatch = /(?:^|\s)class="([^"]*)"/.exec(tag);
        const dynamicMatch = /(?:^|\s)(?::class|v-bind:class)="([^"]*)"/.exec(tag);
        if (!staticMatch || !dynamicMatch) return tag;
        const cleaned = tag
            .replace(/(^|\s)class="[^"]*"/, '$1')
            .replace(/(^|\s)(?::class|v-bind:class)="[^"]*"/, '$1');
        const insertIdx = cleaned.indexOf(' ') + 1;
        return `${cleaned.slice(0, insertIdx)}:class="[${classLiteral(staticMatch[1])}, ${dynamicMatch[1]}]" ${cleaned.slice(insertIdx)}`;
    });
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
    const templateInfo = extractTemplate(source);

    if (!templateInfo) {
        return { code: source, transformed: false, count: 0, diagnostics: [] };
    }

    const transformResult = transformRegion(source, templateInfo.start, templateInfo.end, options);

    if (!transformResult.transformed) {
        return { ...transformResult, code: source };
    }

    // Merge any duplicate class attributes
    const mergedContent = mergeClassAttributes(transformResult.code);

    return {
        ...transformResult,
        code: source.slice(0, templateInfo.start) + mergedContent + source.slice(templateInfo.end),
    };
}

/**
 * Create a Vite plugin for Vue SFC preprocessing.
 *
 * An `sz` value that needs the runtime fails the build with its file and
 * position; the engine's warnings reach the bundler as warnings.
 *
 * @param {VueAdapterOptions} options - Plugin options
 * @returns {Plugin} Vite plugin
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
export function vitePlugin(options: VueAdapterOptions = {}): Plugin {
    return {
        name: 'csszyx-vue',
        enforce: 'pre' as const,

        transform(code: string, id: string) {
            return transformTemplateFile(this, code, id, '.vue', (source, filename) =>
                preprocess(source, { ...options, filename }),
            );
        },
    };
}

/**
 * Default export for convenient importing.
 */
export default vitePlugin;
