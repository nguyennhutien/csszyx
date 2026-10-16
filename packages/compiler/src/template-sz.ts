/**
 * Lower the `sz` values of a Vue or Svelte template through the engine.
 *
 * A template has no csszyx runtime: nothing in it runs `_sz()`, sets a
 * `--_sz-*` style variable, or picks a conditional's branch at render time. So
 * a value lowers only when the engine resolves all of it to one class string
 * at build time. Anything else is an error at the value's position in the
 * template file, and the value gets no class.
 *
 * Each value becomes the one element of its own synthesized module, and every
 * value of a file crosses to the engine in one batch, so one bad value never
 * costs the others their classes. The engine artifact is chosen the way
 * `build.parser` chooses it.
 *
 * @module template-sz
 */

import { findEmittedClassName } from './emitted-class-name.js';
import { chooseEngine } from './engine-choice.js';
import type { SzDiagnosticIssue } from './engine-spans.js';
import type { ParserMode } from './parser-mode.js';
import type { SourceTransformResult } from './transform-core.js';
import { transformRustBatch } from './transform-rust.js';
import { transformWasmBatch } from './transform-wasm.js';

/** One `sz` value written in a template. */
export interface TemplateSzValue {
    /** The value as JavaScript source, e.g. `{ p: 4 }`. */
    source: string;
    /** Offset in the template file where `source` starts. */
    start: number;
    /**
     * Offset in the template file of each UTF-16 unit of `source`, for a value
     * that is not a verbatim slice of the file (a Vue attribute whose
     * character references were decoded). Omitted for a verbatim slice.
     */
    offsets?: readonly number[];
}

/** Options for {@link lowerTemplateSz}. */
export interface TemplateSzOptions {
    /** The template file's name, written at the head of each diagnostic. */
    filename?: string;
    /**
     * The engine artifact, as `build.parser` names it. `rust` is the default
     * and falls back to `wasm` when no native binary is installed; an explicit
     * `rust` fails instead. `CSSZYX_PARSER` overrides both.
     */
    parser?: ParserMode;
    /**
     * The Tailwind prefix the project's stylesheet sets (`prefix(tw)` gives
     * `tw`), written before every class the way a JSX `sz` gets it. Omitted
     * or `null` when the project sets none.
     */
    classPrefix?: string | null;
}

/** One diagnostic about a template `sz` value, placed in the template file. */
export interface TemplateSzDiagnostic {
    /** `error` when the value got no class; `warning` when it did. */
    severity: 'error' | 'warning';
    /** The full message, starting `[csszyx] <file>:<line>:<column>:`. */
    message: string;
    /** 1-based line in the template file. */
    line: number;
    /** 1-based column in UTF-16 code units. */
    column: number;
}

/** What {@link lowerTemplateSz} answers for a file's values. */
export interface TemplateSzLowering {
    /** The class string for each value, index-parallel; `null` for an error. */
    classNames: Array<string | null>;
    /** Every diagnostic, in value order. */
    diagnostics: TemplateSzDiagnostic[];
}

/** Name of the synthesized modules; never shown, every diagnostic is re-placed. */
const SYNTHESIZED = 'csszyx-template-sz.tsx';
const PREFIX = 'export const A = () => <div sz={';
const SUFFIX = '} />;\n';
/**
 * The engine's output when it resolved the whole value to one class string is
 * the element with a static `className` and nothing else: this before the
 * attribute and {@link EMITTED_TAIL} after it. A runtime call, a style
 * variable or a second element does not match.
 */
const EMITTED_HEAD = 'export const A = () => <div';
const EMITTED_TAIL = ' />;\n';
/** The synthesized module's location inside an engine message. */
const SYNTHESIZED_LOCATION = / (?:at|in) csszyx-template-sz\.tsx(?::\d+)*/g;

const RUNTIME_VALUE = [
    'this sz value is only known at runtime, and a template has no csszyx runtime to resolve it',
    'help: write the value as a literal, e.g. { p: 4 }, or bind class or style yourself for a value that changes at runtime',
];
const NOT_AN_EXPRESSION = ['this sz value could not be parsed as a JavaScript expression'];
const LEFT_AS_WRITTEN = 'note: the attribute is left as written; no class is generated for it';

/** One `sz` attribute an adapter found in a template file. */
export interface TemplateSzAttribute {
    /** Offset of the attribute name. */
    start: number;
    /** Offset just past the attribute's value. */
    end: number;
    /** Its value. */
    value: TemplateSzValue;
}

/** What {@link rewriteTemplateSz} answers for a region of a file. */
export interface TemplateSzRewrite extends TemplateSzLowering {
    /** The region with each lowered attribute replaced by its `class`. */
    code: string;
    /** How many attributes were replaced. */
    count: number;
}

/**
 * Lower the `sz` attributes in a region of a template file and write each one
 * that lowered as an escaped `class` attribute. An attribute whose value
 * needs the runtime is left as written, with an error in the diagnostics.
 *
 * @param file - The whole template file; diagnostics are placed in it.
 * @param region - The offsets the attributes lie between.
 * @param region.from - Where the region starts.
 * @param region.to - Where the region ends.
 * @param attributes - The attributes, in file order, inside the region.
 * @param options - File name, engine artifact and class prefix.
 * @returns The region's new text, the class per attribute, and the diagnostics.
 */
export function rewriteTemplateSz(
    file: string,
    region: { from: number; to: number },
    attributes: readonly TemplateSzAttribute[],
    options: TemplateSzOptions = {},
): TemplateSzRewrite {
    const lowering = lowerTemplateSz(
        file,
        attributes.map(attribute => attribute.value),
        options,
    );
    let code = '';
    let last = region.from;
    let count = 0;
    attributes.forEach((attribute, index) => {
        const className = lowering.classNames[index];
        if (className === null) return;
        code += `${file.slice(last, attribute.start)}class="${escapeTemplateAttribute(className)}"`;
        last = attribute.end;
        count += 1;
    });
    code += file.slice(last, region.to);
    return { ...lowering, code, count };
}

/**
 * Lower every `sz` value of one template file.
 *
 * @param file - The whole template file the values' offsets refer to.
 * @param values - The values, in file order.
 * @param options - File name, engine artifact and class prefix.
 * @returns A class string or `null` per value, and the placed diagnostics.
 */
function lowerTemplateSz(
    file: string,
    values: readonly TemplateSzValue[],
    options: TemplateSzOptions = {},
): TemplateSzLowering {
    const lowering: TemplateSzLowering = { classNames: [], diagnostics: [] };
    if (values.length === 0) return lowering;
    const modules = values.map(value => `${PREFIX}${value.source}${SUFFIX}`);
    const results = engineBatch(options.parser)(
        modules.map(source => ({ filename: SYNTHESIZED, source })),
        { classPrefix: options.classPrefix },
    );
    const place = placer(file, options.filename);
    values.forEach((value, index) => {
        const result = results[index];
        // Both artifacts always report the issue list.
        const issues = result.issues as SzDiagnosticIssue[];
        const at = (issue: number): number =>
            fileOffset(value, synthesizedIndex(issues[issue], modules[index]) - PREFIX.length);
        const parseError = issues.findIndex(issue => issue.code === 'parse-error');
        const className = parseError === -1 ? emittedClassName(result.code) : null;
        lowering.classNames.push(className);
        if (className === null) {
            const reason = parseError === -1 ? RUNTIME_VALUE : NOT_AN_EXPRESSION;
            const text = [...reason, LEFT_AS_WRITTEN].join('\n');
            lowering.diagnostics.push(place('error', at(Math.max(parseError, 0)), text));
            return;
        }
        result.diagnostics.forEach((message, issue) => {
            const text = message.replace(/^\[csszyx\] /, '').replace(SYNTHESIZED_LOCATION, '');
            lowering.diagnostics.push(place('warning', at(issue), text));
        });
    });
    return lowering;
}

/**
 * The batch transform of the artifact `build.parser` would pick.
 *
 * @param parser - The artifact asked for, if any.
 * @returns The native or the wasm batch transform.
 */
function engineBatch(parser: ParserMode | undefined): typeof transformRustBatch {
    return chooseEngine(parser) === 'rust' ? transformRustBatch : transformWasmBatch;
}

/**
 * The class string the engine wrote for the synthesized element, when that
 * element is all it wrote.
 *
 * @param code - The engine's output for one synthesized module.
 * @returns The class string, `''` for an object with no class, or `null`.
 */
function emittedClassName(code: SourceTransformResult['code']): string | null {
    const found = findEmittedClassName(code);
    if (found === null) return null;
    const alone =
        code.slice(0, found.start) === EMITTED_HEAD && code.slice(found.end) === EMITTED_TAIL;
    return alone ? found.className : null;
}

/**
 * Where an engine issue sits in its synthesized module, as a UTF-16 index; the
 * value's start when there is no issue to place.
 *
 * @param issue - The issue, if the engine reported one.
 * @param source - The synthesized module.
 * @returns The index into the synthesized module.
 */
function synthesizedIndex(issue: SzDiagnosticIssue | undefined, source: string): number {
    if (issue === undefined) return PREFIX.length;
    return lineStartsOf(source)[issue.line - 1] + issue.column - 1;
}

/**
 * Map an index into a value back to the template file.
 *
 * @param value - The value.
 * @param index - UTF-16 index into `value.source`; clamped into the value.
 * @returns The offset in the template file.
 */
function fileOffset(value: TemplateSzValue, index: number): number {
    const inside = Math.max(0, Math.min(index, value.source.length - 1));
    return value.offsets?.[inside] ?? value.start + inside;
}

/**
 * Build the function that places a diagnostic in the template file. The
 * file's line starts are found on the first diagnostic, not before.
 *
 * @param file - The whole template file.
 * @param filename - Its name, when known.
 * @returns A function from severity, offset and text to a diagnostic.
 */
function placer(
    file: string,
    filename: string | undefined,
): (
    severity: TemplateSzDiagnostic['severity'],
    offset: number,
    text: string,
) => TemplateSzDiagnostic {
    let lineStarts: number[] | undefined;
    return (severity, offset, text) => {
        lineStarts ??= lineStartsOf(file);
        let line = 0;
        while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line += 1;
        const column = offset - lineStarts[line] + 1;
        const where = [filename, line + 1, column].filter(part => part !== undefined).join(':');
        return { severity, message: `[csszyx] ${where}: ${text}`, line: line + 1, column };
    };
}

/**
 * @param text - Any text.
 * @returns The UTF-16 index where each of its lines starts.
 */
function lineStartsOf(text: string): number[] {
    const starts = [0];
    for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
        starts.push(index + 1);
    }
    return starts;
}

/** Where an adapter hands its diagnostics: a bundler plugin context, say. */
export interface TemplateSzReporter {
    /** Reports a warning. */
    warn: (message: string) => void;
    /** Fails the build; does not return. */
    error: (message: string) => never;
}

/**
 * Hand a file's diagnostics on: each warning as a warning, then every error
 * at once as the one error that fails the build.
 *
 * @param reporter - Where they go.
 * @param diagnostics - The file's diagnostics.
 */
export function reportTemplateSzDiagnostics(
    reporter: TemplateSzReporter,
    diagnostics: readonly TemplateSzDiagnostic[],
): void {
    const errors: string[] = [];
    for (const diagnostic of diagnostics) {
        if (diagnostic.severity === 'error') errors.push(diagnostic.message);
        else reporter.warn(diagnostic.message);
    }
    if (errors.length > 0) reporter.error(errors.join('\n\n'));
}

/**
 * The transform hook body both adapters' Vite plugins share: run the
 * adapter's preprocess on a file of its kind that mentions `sz=`, hand the
 * diagnostics to the bundler, and return the code when it changed.
 *
 * @param reporter - The bundler's plugin context.
 * @param code - The module source.
 * @param id - The module id.
 * @param extension - The file extension the adapter reads, e.g. `.vue`.
 * @param preprocess - The adapter's preprocess, given the source and the id.
 * @returns The new code, or null when the file is not the adapter's or did not change.
 */
export function transformTemplateFile(
    reporter: TemplateSzReporter,
    code: string,
    id: string,
    extension: string,
    preprocess: (
        source: string,
        filename: string,
    ) => { code: string; diagnostics: TemplateSzDiagnostic[] },
): { code: string; map: null } | null {
    if (!id.endsWith(extension) || !code.includes('sz=')) return null;
    const result = preprocess(code, id);
    reportTemplateSzDiagnostics(reporter, result.diagnostics);
    // Source-map generation is not implemented yet.
    return result.code === code ? null : { code: result.code, map: null };
}

/**
 * Escape a class string for a double-quoted HTML attribute in a Vue or Svelte
 * template. Braces are escaped too: Svelte reads `{` in an attribute value as
 * the start of an expression.
 *
 * @param value - The class string.
 * @returns The text to write between the quotes.
 */
function escapeTemplateAttribute(value: string): string {
    return value.replace(/[&"'<>{}]/g, char => `&#${char.charCodeAt(0)};`);
}
