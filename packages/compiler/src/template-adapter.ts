/**
 * The steps every template adapter shares around its own reader: lowering the
 * `sz` attributes the reader found, and the Vite plugin that runs the
 * adapter's preprocess. An adapter writes only how it reads its framework's
 * file; everything after the read is here, once.
 *
 * @module template-adapter
 */

import type { SourceMap } from 'magic-string';

import {
    rewriteTemplateSz,
    type TemplateSzAttribute,
    type TemplateSzDiagnostic,
    type TemplateSzOptions,
    type TemplateSzReporter,
    transformTemplateFile,
} from './template-sz.js';

/** What an adapter's reader found in one file. */
export interface TemplateSzReading {
    /** The `sz` attributes, in file order. */
    attributes: readonly TemplateSzAttribute[];
    /** Why the file could not be read; the file is left as written when any. */
    diagnostics: readonly TemplateSzDiagnostic[];
}

/** The rewrite options, plus the adapter's debug log. */
export interface LowerSzAttributesOptions extends TemplateSzOptions {
    /** Log each value and the class it lowered to. */
    debug?: boolean;
}

/** One file, lowered. */
export interface LoweredTemplate {
    code: string;
    map: SourceMap | null;
    /** Attributes that got a class. */
    count: number;
    diagnostics: TemplateSzDiagnostic[];
}

/** The file {@link lowerSzAttributes} lowers, and whose reader read it. */
export interface LowerSzAttributesInput {
    /** The template file. */
    file: string;
    /** What the adapter's reader found. */
    reading: TemplateSzReading;
    /** The adapter's name in debug lines, e.g. `svelte`. */
    label: string;
}

/**
 * Lower the `sz` attributes an adapter read from one file. A read that failed
 * or found none leaves the file as written.
 *
 * @param input - The file, what was read from it, and the adapter's name.
 * @param options - Rewrite options and the debug switch.
 * @returns The file, lowered, with every diagnostic.
 */
export function lowerSzAttributes(
    input: LowerSzAttributesInput,
    options: LowerSzAttributesOptions,
): LoweredTemplate {
    const { file, reading, label } = input;
    if (reading.diagnostics.length > 0 || reading.attributes.length === 0) {
        return { code: file, map: null, count: 0, diagnostics: [...reading.diagnostics] };
    }
    const { code, map, count, classNames, diagnostics } = rewriteTemplateSz(
        file,
        reading.attributes,
        options,
    );
    if (options.debug) {
        reading.attributes.forEach((attribute, index) => {
            console.log(
                `[csszyx/${label}] ${attribute.value.source} -> ${JSON.stringify(classNames[index])}`,
            );
        });
    }
    return { code, map, count, diagnostics };
}

/** What an adapter's `preprocess` returns. */
export interface TemplatePreprocessResult {
    code: string;
    map?: SourceMap | null;
    diagnostics: TemplateSzDiagnostic[];
}

/**
 * The `preprocess` every template adapter exports. The plugin calls it with
 * these options and nothing else, so an adapter whose `preprocess` fits this
 * type plugs into the plugin's adapter table without the plugin knowing it.
 */
export type TemplatePreprocess = (
    source: string,
    options: TemplateSzOptions,
) => TemplatePreprocessResult;

/** What {@link templateVitePlugin} builds a plugin from. */
export interface TemplateVitePluginInput {
    /** The plugin's name. */
    name: string;
    /** The extension of the files the adapter lowers, e.g. `.svelte`. */
    extension: string;
    /** The adapter's preprocess, given the source and the module id. */
    preprocess: (source: string, filename: string) => TemplatePreprocessResult;
}

/** The Vite plugin an adapter exports, in the shape Vite reads. */
export interface TemplateVitePlugin {
    name: string;
    enforce: 'pre';
    transform: (
        this: TemplateSzReporter,
        code: string,
        id: string,
    ) => { code: string; map: SourceMap | null } | null;
}

/**
 * The Vite plugin of a template adapter: before the framework's own plugin, it
 * runs the adapter's preprocess on each file of its extension that holds an
 * `sz` and hands the diagnostics to Vite.
 *
 * @param input - The name, the extension and the preprocess.
 * @returns The plugin.
 */
export function templateVitePlugin(input: TemplateVitePluginInput): TemplateVitePlugin {
    return {
        name: input.name,
        enforce: 'pre',
        transform(code, id) {
            return transformTemplateFile(this, code, id, input.extension, input.preprocess);
        },
    };
}
