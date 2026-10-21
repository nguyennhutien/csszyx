/**
 * The engine's diagnostics as messages, for both artifacts' result mapping.
 *
 * The engine reports codes, offsets and args; the messages a build log prints
 * are rendered here from the registry's templates, once, so the native and the
 * wasm lane cannot word one diagnostic differently (ADR 0031).
 *
 * @module engine-diagnostics
 */

import { SZ_DIAGNOSTIC_RENDER_SPECS } from './diagnostic-registry.generated.js';
import { renderSzDiagnostic } from './diagnostic-render.js';
import { SZ_DIAGNOSTIC_COMPUTED_VALUES } from './diagnostic-render-helpers.js';
import { argNamesOf } from './diagnostic-template.js';
import type { SzDiagnosticIssue } from './engine-spans.js';
import { suggestSzKey } from './sz-key-suggestion.js';
import type { SourceTransformResult } from './transform-core.js';

/**
 * The arg the compiler derives from the others once the engine has reported,
 * by code: filled only when a diagnostic is rendered, so it never tells two
 * diagnostics apart.
 */
const DERIVED_ARGS: Readonly<Record<string, string>> = { 'unknown-key': 'suggestion' };

/** Each id's arg names that tell two diagnostics apart, in registry order. */
const ARG_ORDER: ReadonlyMap<string, readonly string[]> = new Map(
    SZ_DIAGNOSTIC_RENDER_SPECS.map(spec => [
        spec.id,
        argNamesOf(spec)
            .map(name => (name.endsWith('?') ? name.slice(0, -1) : name))
            .filter(name => name !== DERIVED_ARGS[spec.id]),
    ]),
);

/** A path that starts with a drive letter, which Windows matches in any case. */
const WINDOWS_DRIVE = /^[A-Z]:[\\/]/i;

/**
 * A path in the form two paths are compared in: separators as `/`, and in
 * lower case on Windows, since that filesystem ignores case.
 *
 * @param path - The path.
 * @param windows - Whether the paths are Windows paths.
 * @returns The comparable form.
 */
function comparablePath(path: string, windows: boolean): string {
    const slashed = path.replace(/\\/g, '/');
    return windows ? slashed.toLowerCase() : slashed;
}

/**
 * A file's path as a diagnostic names it: relative to the project root when it
 * sits under it, with `/` separators on Windows too, and as given otherwise. A
 * Windows root matches whatever its separators and the case of its letters,
 * because bundlers spell one file both ways there.
 *
 * @param filename - The path the bundler passed.
 * @param rootDir - The project root, when known.
 * @returns The path to print.
 */
export function diagnosticPath(filename: string, rootDir?: string): string {
    if (rootDir === undefined || rootDir === '') return filename;
    let end = rootDir.length;
    while (end > 0 && (rootDir[end - 1] === '/' || rootDir[end - 1] === '\\')) end--;
    const windows = WINDOWS_DRIVE.test(rootDir);
    // Compared over the same number of UTF-16 units on both sides, since lower
    // case can change a string's length.
    const head = filename.slice(0, end);
    if (comparablePath(head, windows) !== comparablePath(rootDir.slice(0, end), windows)) {
        return filename;
    }
    const rest = filename.slice(end);
    if (!rest.startsWith('/') && !rest.startsWith('\\')) return filename;
    // One file reads the same from every bundler: webpack and Jest pass a
    // Windows path backslashed, Vite with `/`. On POSIX `\` is a filename
    // character, so only a Windows path is respelled.
    const relative = rest.slice(1);
    return windows ? relative.replace(/\\/g, '/') : relative;
}

/**
 * What tells two diagnostics of one code apart beside their position: each arg
 * in registry order, so the key does not depend on how the args were written
 * or on the wording that renders them. An arg derived on rendering (the
 * suggestion for an unknown key) is left out, so a diagnostic has one key
 * whether it was rendered yet or not.
 *
 * @param issue - The diagnostic.
 * @returns The key.
 */
export function szDiagnosticKey(issue: Pick<SzDiagnosticIssue, 'code' | 'args'>): string {
    const args = issue.args as Readonly<Record<string, unknown>>;
    return (ARG_ORDER.get(issue.code) ?? [])
        .map(name => {
            const value = args[name];
            if (Array.isArray(value)) return value.join('\u0001');
            return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
        })
        .join('\u0000');
}

/**
 * Fill the args the engine leaves to the compiler: the key an unknown key is
 * most likely a typo of, from the compiler's table of known keys.
 *
 * @param issue - The diagnostic, completed in place.
 */
function completeArgs(issue: SzDiagnosticIssue): void {
    if (issue.code !== 'unknown-key') return;
    const args = issue.args as SzDiagnosticIssue<'unknown-key'>['args'];
    if (args.suggestion !== undefined) return;
    const suggestion = suggestSzKey(args.key);
    if (suggestion !== null) issue.args = { ...args, suggestion };
}

/**
 * One diagnostic's whole message; its args are completed first, so a reader
 * of the record sees what the message says.
 *
 * @param issue - A located issue, completed in place.
 * @param file - The file's path as a diagnostic names it.
 * @returns The message.
 */
export function renderEngineDiagnostic(issue: SzDiagnosticIssue, file: string): string {
    completeArgs(issue);
    return renderSzDiagnostic({
        diagnostic: issue,
        file,
        computed: SZ_DIAGNOSTIC_COMPUTED_VALUES,
    });
}

/**
 * One message per issue, index-parallel to the issues.
 *
 * @param issues - The located issues of one file.
 * @param file - The file's path as a diagnostic names it.
 * @returns The messages.
 */
export function renderEngineDiagnostics(
    issues: readonly SzDiagnosticIssue[],
    file: string,
): string[] {
    return issues.map(issue => renderEngineDiagnostic(issue, file));
}

/**
 * A transform result whose engine diagnostics were left unrendered.
 *
 * `diagnostics` is empty and `issues` holds every finding, its derived args
 * not filled in; `diagnosticFile` is the path a rendered header names. A build
 * lane prints a handful of a build's findings and counts or drops the rest, so
 * it renders each one it prints with {@link renderEngineDiagnostic} and no
 * other. The public transforms render every diagnostic, as their callers
 * read `diagnostics` itself.
 *
 * @internal Read by the bundler plugin, the Next loader and jest; not a stable shape.
 */
export interface UnrenderedTransformResult extends SourceTransformResult {
    /** The file's path as a rendered diagnostic names it. */
    diagnosticFile: string;
}

/** The diagnostic fields of a converted engine result. */
export type EngineDiagnosticFields = Pick<UnrenderedTransformResult, 'diagnostics'> &
    Partial<UnrenderedTransformResult>;

/**
 * How an engine lane fills a result's diagnostic fields:
 * {@link renderedDiagnosticFields} or {@link unrenderedDiagnosticFields}.
 */
export type EngineDiagnosticFieldsOf = (
    issues: readonly SzDiagnosticIssue[],
    file: string,
) => EngineDiagnosticFields;

/**
 * Every message, rendered now.
 *
 * @param issues - The located issues.
 * @param file - The file's path as a diagnostic names it.
 * @returns The fields to spread into the result.
 */
export function renderedDiagnosticFields(
    issues: readonly SzDiagnosticIssue[],
    file: string,
): EngineDiagnosticFields {
    return { diagnostics: renderEngineDiagnostics(issues, file) };
}

/**
 * No message, and the path to render the issues against later.
 *
 * @param _issues - The located issues, left on the result.
 * @param file - The file's path as a diagnostic names it.
 * @returns The fields to spread into the result.
 */
export function unrenderedDiagnosticFields(
    _issues: readonly SzDiagnosticIssue[],
    file: string,
): EngineDiagnosticFields {
    return { diagnostics: [], diagnosticFile: file };
}

/**
 * Where a result's unrendered issues are rendered against, when it has any.
 *
 * @param result - Any transform result.
 * @returns The path, or `undefined` for a rendered result.
 */
export function diagnosticFileOf(result: SourceTransformResult): string | undefined {
    return (result as Partial<UnrenderedTransformResult>).diagnosticFile;
}

/**
 * A diagnostic's message without a place: for a caller that lowered a module
 * of its own making (`csszyx explain`, the MCP preview), whose file and
 * positions would mean nothing to its reader.
 *
 * @param issue - The diagnostic.
 * @returns The message: header with the code alone, the sentence, the page.
 */
export function renderUnplacedDiagnostic(issue: Pick<SzDiagnosticIssue, 'code' | 'args'>): string {
    return renderSzDiagnostic({
        diagnostic: { code: issue.code, args: issue.args },
        file: '',
        computed: SZ_DIAGNOSTIC_COMPUTED_VALUES,
    });
}
