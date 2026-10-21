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

import MagicString, { type SourceMap } from 'magic-string';
// Imported directly, not through `./report.js`: Node loads this module, and
// the build makes `./report.js` the whole `@csszyx/compiler/report` subpath,
// where only these entries are needed.
import { TEMPLATE_RUNTIME_VALUE, TEMPLATE_SZ_INVALID } from './diagnostic-browser.generated.js';
import type { SzDiagnosticId } from './diagnostic-codes.generated.js';
import { renderSzDiagnostic } from './diagnostic-render.js';
import { SZ_DIAGNOSTIC_COMPUTED_VALUES } from './diagnostic-render-helpers.js';
import type { SzBrowserDiagnostic } from './diagnostic-template.js';
import { findEmittedClassName } from './emitted-class-name.js';
import { chooseEngine } from './engine-choice.js';
import type { SzDiagnosticIssue } from './engine-spans.js';
import { CsszyxError } from './errors.js';
import type { ParserMode } from './parser-mode.js';
import { renderThrown } from './thrown-words.js';
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
    /**
     * The full message: `[csszyx] <code>: <file>:<line>:<column>`, then its
     * sentence, `help:` and `note:` lines, and the link to the code's page.
     */
    message: string;
    /** The registry id. */
    code: SzDiagnosticId;
    /** The values its sentence names. */
    args: object;
    /** The template file's name, when known. */
    file?: string;
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

/** One `sz` attribute an adapter found in a template file. */
export interface TemplateSzAttribute {
    /** Offset of the attribute name. */
    start: number;
    /** Offset just past the attribute's value. */
    end: number;
    /** Its value. */
    value: TemplateSzValue;
    /**
     * Where the value of a static `class` attribute on the same element lies,
     * quotes excluded, when the class should join it: a second `class`
     * attribute is an error in Vue and in Svelte. Omitted, the attribute is
     * replaced by a `class` attribute of its own. `quoted` is false for
     * `class=a`, which takes quotes once a space joins it.
     */
    classValue?: { start: number; end: number; quoted: boolean };
}

/** What {@link rewriteTemplateSz} answers for a template file. */
export interface TemplateSzRewrite extends TemplateSzLowering {
    /** The file with each lowered attribute replaced by its class. */
    code: string;
    /** How many attributes were replaced. */
    count: number;
    /** The map from `code` back to the file; `null` when nothing changed. */
    map: SourceMap | null;
}

/**
 * Lower the `sz` attributes of a template file and write each one that
 * lowered as escaped class text: into the element's static `class` value when
 * the attribute names one, otherwise as a `class` attribute in its place. An
 * attribute whose value needs the runtime is left as written, with an error
 * in the diagnostics.
 *
 * @param file - The whole template file; diagnostics are placed in it.
 * @param attributes - The attributes, in file order.
 * @param options - File name, engine artifact and class prefix.
 * @returns The new text and its source map, the class per attribute, and the
 *   diagnostics.
 */
export function rewriteTemplateSz(
    file: string,
    attributes: readonly TemplateSzAttribute[],
    options: TemplateSzOptions = {},
): TemplateSzRewrite {
    const lowering = lowerTemplateSz(
        file,
        attributes.map(attribute => attribute.value),
        options,
    );
    const edited = new MagicString(file);
    let count = 0;
    attributes.forEach((attribute, index) => {
        const className = lowering.classNames[index];
        if (className === null) return;
        count += 1;
        const escaped = escapeTemplateAttribute(className);
        const { classValue } = attribute;
        if (classValue === undefined) {
            edited.overwrite(attribute.start, attribute.end, `class="${escaped}"`);
            return;
        }
        edited.remove(spaceBefore(file, attribute.start), attribute.end);
        if (escaped === '') return;
        const joined = classValue.end > classValue.start ? ` ${escaped}` : escaped;
        if (classValue.quoted) {
            edited.appendLeft(classValue.end, joined);
        } else {
            edited.prependRight(classValue.start, '"');
            edited.appendLeft(classValue.end, `${joined}"`);
        }
    });
    if (count === 0) return { ...lowering, code: file, count, map: null };
    const map = edited.generateMap({
        source: options.filename,
        includeContent: true,
        hires: 'boundary',
    });
    return { ...lowering, code: edited.toString(), count, map };
}

/**
 * Where the whitespace before an attribute starts.
 *
 * @param file - The template file.
 * @param start - Offset of the attribute name.
 * @returns The offset of the first whitespace character before it.
 */
function spaceBefore(file: string, start: number): number {
    let from = start;
    while (from > 0 && /\s/.test(file.charAt(from - 1))) from -= 1;
    return from;
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
    const locate = locator(file);
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
            lowering.diagnostics.push(
                parseError === -1
                    ? place('error', at(0), TEMPLATE_RUNTIME_VALUE, {})
                    : engineDiagnostic('error', locate(at(parseError)), options.filename, {
                          code: 'parse-error',
                          args: { form: 'expression' },
                      }),
            );
            return;
        }
        // Rendered again for the template file: the lane's message names the
        // synthesized module and its positions.
        issues.forEach((issue, index) => {
            lowering.diagnostics.push(
                engineDiagnostic('warning', locate(at(index)), options.filename, issue),
            );
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
 * Build the function that finds the line and column of an offset in a
 * template file. The file's line starts are found on the first call, not
 * before.
 *
 * @param file - The whole template file.
 * @returns A function from offset to its 1-based line and column.
 */
function locator(file: string): (offset: number) => TemplatePlace {
    let lineStarts: number[] | undefined;
    return offset => {
        lineStarts ??= lineStartsOf(file);
        const line = lineIndexOf(lineStarts, offset);
        return { line: line + 1, column: offset - lineStarts[line] + 1 };
    };
}

/** A place in a template file, 1-based. */
interface TemplatePlace {
    line: number;
    column: number;
}

/**
 * Build the function that places one of the template's own diagnostics in
 * the template file, in the registry's words.
 *
 * @param file - The whole template file.
 * @param filename - Its name, when known.
 * @returns A function from severity, offset, registry entry and args to a diagnostic.
 */
function placer(
    file: string,
    filename: string | undefined,
): <Args extends object>(
    severity: TemplateSzDiagnostic['severity'],
    offset: number,
    diagnostic: SzBrowserDiagnostic<Args>,
    args: NoInfer<Args>,
) => TemplateSzDiagnostic {
    const locate = locator(file);
    return (severity, offset, diagnostic, args) => {
        const { line, column } = locate(offset);
        return {
            severity,
            message: renderThrown(diagnostic, args, { file: filename ?? '', line, column }),
            code: diagnostic.id,
            args,
            line,
            column,
            ...(filename === undefined ? {} : { file: filename }),
        };
    };
}

/**
 * An engine diagnostic placed in the template file, in the engine's words.
 *
 * @param severity - `error` when the value got no class.
 * @param place - Where it is in the template file.
 * @param filename - The file's name, when known.
 * @param issue - The engine's code and args.
 * @param issue.code - The code.
 * @param issue.args - Its args.
 * @returns The diagnostic.
 */
function engineDiagnostic(
    severity: TemplateSzDiagnostic['severity'],
    place: TemplatePlace,
    filename: string | undefined,
    issue: { code: SzDiagnosticId; args: object },
): TemplateSzDiagnostic {
    const { line, column } = place;
    const message = renderSzDiagnostic({
        diagnostic: { code: issue.code, args: issue.args, line, column },
        file: filename ?? '',
        computed: SZ_DIAGNOSTIC_COMPUTED_VALUES,
    });
    return {
        severity,
        message,
        code: issue.code,
        args: issue.args,
        line,
        column,
        ...(filename === undefined ? {} : { file: filename }),
    };
}

/**
 * The line an offset falls on, by binary search: a file can carry thousands
 * of diagnostics, and walking from the first line for each was quadratic.
 *
 * @param lineStarts - Where each line starts, ascending.
 * @param offset - A UTF-16 offset.
 * @returns The 0-based line.
 */
function lineIndexOf(lineStarts: readonly number[], offset: number): number {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (lineStarts[middle] <= offset) low = middle;
        else high = middle - 1;
    }
    return low;
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

/** Input to {@link placeTemplateDiagnostic}. */
export interface PlaceTemplateDiagnosticInput<Args extends object> {
    /** The whole template file. */
    file: string;
    /** Its name, when known. */
    filename?: string;
    /** `error` when the file gets no class from it. */
    severity: TemplateSzDiagnostic['severity'];
    /** UTF-16 offset in the file. */
    offset: number;
    /** The registry entry, as `@csszyx/compiler/report` exports it. */
    diagnostic: SzBrowserDiagnostic<Args>;
    /** Its args. */
    args: NoInfer<Args>;
}

/**
 * A diagnostic placed in a template file, for what an adapter reports itself:
 * a file its framework's parser rejects, say.
 *
 * @param input - The file, the place, the registry entry and its args.
 * @returns The diagnostic.
 */
export function placeTemplateDiagnostic<Args extends object>(
    input: PlaceTemplateDiagnosticInput<Args>,
): TemplateSzDiagnostic {
    return placer(input.file, input.filename)(
        input.severity,
        input.offset,
        input.diagnostic,
        input.args,
    );
}

/** Where an adapter hands its diagnostics: a bundler plugin context, say. */
export interface TemplateSzReporter {
    /** Reports a warning. */
    warn: (message: string) => void;
    /**
     * Fails the build with the file's `template-sz-invalid` error, which
     * carries its code and args; does not return.
     */
    error: (error: CsszyxError) => never;
}

/**
 * Hand a file's diagnostics on: each warning as a warning, then every error
 * at once as the one error that fails the build, headed by
 * `template-sz-invalid` with their count.
 *
 * @param reporter - Where they go.
 * @param diagnostics - The file's diagnostics.
 */
export function reportTemplateSzDiagnostics(
    reporter: TemplateSzReporter,
    diagnostics: readonly TemplateSzDiagnostic[],
): void {
    const errors: TemplateSzDiagnostic[] = [];
    for (const diagnostic of diagnostics) {
        if (diagnostic.severity === 'error') errors.push(diagnostic);
        else reporter.warn(diagnostic.message);
    }
    if (errors.length === 0) return;
    // Headed by the file's count, each error after it as it was placed.
    const args = { count: errors.length };
    const head = renderThrown(TEMPLATE_SZ_INVALID, args, { file: errors[0].file ?? '' });
    reporter.error(
        new CsszyxError({
            code: 'template-sz-invalid',
            args,
            message: [head, ...errors.map(error => error.message)].join('\n\n'),
        }),
    );
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
    ) => { code: string; map?: SourceMap | null; diagnostics: TemplateSzDiagnostic[] },
): { code: string; map: SourceMap | null } | null {
    if (!id.endsWith(extension) || !mayHoldSzAttribute(code)) return null;
    const result = preprocess(code, id);
    reportTemplateSzDiagnostics(reporter, result.diagnostics);
    return result.code === code ? null : { code: result.code, map: result.map ?? null };
}

/**
 * Whether a template file may hold an `sz` attribute: the cheap test that
 * spares a file without one its parse. `sz = "…"` with spaces is an attribute
 * too.
 *
 * @param source - The file.
 * @returns Whether `sz` followed by optional whitespace and `=` occurs.
 */
export function mayHoldSzAttribute(source: string): boolean {
    return /sz\s*=/.test(source);
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
    return value.replace(/[&"'<>{}]/g, char => `&#${char.codePointAt(0)};`);
}
