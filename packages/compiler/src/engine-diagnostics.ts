/**
 * The engine's diagnostics as messages, for both artifacts' result mapping.
 *
 * The engine reports codes, offsets and args; the messages a build log prints
 * are rendered here from the registry's templates, once, so the native and the
 * wasm lane cannot word one diagnostic differently (ADR 0031).
 *
 * @module engine-diagnostics
 */

import { SZ_DIAGNOSTIC_REGISTRY } from './diagnostic-registry.generated.js';
import { renderSzDiagnostic } from './diagnostic-render.js';
import { SZ_DIAGNOSTIC_COMPUTED_VALUES } from './diagnostic-render-helpers.js';
import type { SzDiagnosticIssue } from './engine-spans.js';
import { suggestSzKey } from './sz-key-suggestion.js';

/** Each id's arg names, in registry order. */
const ARG_ORDER: ReadonlyMap<string, readonly string[]> = new Map(
    SZ_DIAGNOSTIC_REGISTRY.map(spec => [spec.id, Object.keys(spec.args)]),
);

/**
 * A file's path as a diagnostic names it: relative to the project root when it
 * sits under it, as given otherwise.
 *
 * @param filename - The path the bundler passed.
 * @param rootDir - The project root, when known.
 * @returns The path to print.
 */
export function diagnosticPath(filename: string, rootDir?: string): string {
    if (rootDir === undefined || rootDir === '') return filename;
    let end = rootDir.length;
    while (end > 0 && (rootDir[end - 1] === '/' || rootDir[end - 1] === '\\')) end--;
    const root = rootDir.slice(0, end);
    const rest = filename.startsWith(root) ? filename.slice(root.length) : undefined;
    if (rest === undefined || (rest[0] !== '/' && rest[0] !== '\\')) return filename;
    return rest.slice(1);
}

/**
 * What tells two diagnostics of one code apart beside their position: each arg
 * in registry order, so the key does not depend on how the args were written
 * or on the wording that renders them.
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
 * One message per issue, index-parallel to the issues; each issue's args are
 * completed first, so a reader of the record sees what the message says.
 *
 * @param issues - The located issues of one file.
 * @param file - The file's path as a diagnostic names it.
 * @returns The messages.
 */
export function renderEngineDiagnostics(
    issues: readonly SzDiagnosticIssue[],
    file: string,
): string[] {
    return issues.map(issue => {
        completeArgs(issue);
        return renderSzDiagnostic({
            diagnostic: issue,
            file,
            computed: SZ_DIAGNOSTIC_COMPUTED_VALUES,
        });
    });
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
