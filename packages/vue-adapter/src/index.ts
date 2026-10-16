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

import {
    mayHoldSzAttribute,
    placeTemplateDiagnostic,
    rewriteTemplateSz,
    type SourceMap,
    type TemplateSzAttribute,
    type TemplateSzDiagnostic,
    type TemplateSzOptions,
    transformTemplateFile,
} from '@csszyx/compiler/internal';
import type { Plugin } from 'vite';

import { type ReadFailure, readSzAttributes } from './template-ast.js';

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
     * The map from `code` back to the source; `null` when nothing changed.
     */
    map: SourceMap | null;
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
     * in the source. An error's attribute is left as written. A file Vue
     * cannot parse, or a template in another language, is one error and
     * nothing in it changes.
     */
    diagnostics: TemplateSzDiagnostic[];
}

/**
 * Extract the root template section from a Vue SFC, as Vue's parser finds it.
 *
 * @param {string} source - Vue SFC source code
 * @returns {{ content: string; start: number; end: number } | null} Template info or null
 */
export function extractTemplate(source: string): {
    content: string;
    start: number;
    end: number;
} | null {
    const bounds = readSzAttributes(source).template;
    return bounds && { content: source.slice(bounds.start, bounds.end), ...bounds };
}

/** What wraps a bare template so it parses as an SFC. */
const OPEN = '<template>';
const CLOSE = '</template>';

/**
 * Transform sz props in a template string: the content of a `<template>`,
 * without the tags.
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
    if (!mayHoldSzAttribute(template)) return unchanged(template, []);
    const reading = readSzAttributes(`${OPEN}${template}${CLOSE}`, options.filename);
    const shift = (offset: number): number => Math.max(0, offset - OPEN.length);
    return lowerFile(template, options, {
        attributes: reading.attributes.map(attribute => ({
            ...attribute,
            start: shift(attribute.start),
            end: shift(attribute.end),
            value: {
                ...attribute.value,
                start: shift(attribute.value.start),
                offsets: attribute.value.offsets?.map(shift),
            },
            classValue: attribute.classValue && {
                ...attribute.classValue,
                start: shift(attribute.classValue.start),
                end: shift(attribute.classValue.end),
            },
        })),
        failure: reading.failure && { ...reading.failure, offset: shift(reading.failure.offset) },
    });
}

/**
 * Lower a file's `sz` attributes, or report why they could not be read.
 *
 * @param file - The text the attributes' offsets refer to.
 * @param options - Options.
 * @param reading - The attributes, or the failure.
 * @param reading.attributes - The `sz` attributes, in file order.
 * @param reading.failure - Why the file was not read, if it was not.
 * @returns The result.
 */
function lowerFile(
    file: string,
    options: VueAdapterOptions,
    reading: { attributes: TemplateSzAttribute[]; failure: ReadFailure | null },
): PreprocessResult {
    if (reading.failure) {
        const { offset, text } = reading.failure;
        const placed = placeTemplateDiagnostic({
            file,
            filename: options.filename,
            severity: 'error',
            offset,
            text,
        });
        return unchanged(file, [placed]);
    }
    if (reading.attributes.length === 0) return unchanged(file, []);
    const { code, map, count, classNames, diagnostics } = rewriteTemplateSz(
        file,
        reading.attributes,
        options,
    );
    if (options.debug) {
        reading.attributes.forEach((attribute, index) => {
            console.log(
                `[csszyx/vue] ${attribute.value.source} -> ${JSON.stringify(classNames[index])}`,
            );
        });
    }
    return { code, map, transformed: count > 0, count, diagnostics };
}

/**
 * A result that changes nothing.
 *
 * @param code - The source.
 * @param diagnostics - Why, when something stopped the read.
 * @returns The result.
 */
function unchanged(code: string, diagnostics: TemplateSzDiagnostic[]): PreprocessResult {
    return { code, map: null, transformed: false, count: 0, diagnostics };
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
    if (!mayHoldSzAttribute(source)) return unchanged(source, []);
    return lowerFile(source, options, readSzAttributes(source, options.filename));
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
