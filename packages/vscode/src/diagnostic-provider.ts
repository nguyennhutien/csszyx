/**
 * Diagnostic provider — reports the sz keys the build would report.
 *
 * Runs on document open and after a 300ms debounce on content changes.
 * Only activates when `csszyx.enableDiagnostics` is true (default: true).
 *
 * Valid keys:
 *   - PROPERTY_MAP keys (p, bg, text, ...)
 *   - BOOLEAN_SHORTHANDS (truncate, grow, ring, container, ...)
 *   - KNOWN_SPECIAL_PROPERTIES lowered by dedicated compiler branches
 *   - KNOWN_VARIANTS used as top-level keys (hover, sm, dark, ...)
 *   - Arbitrary variant keys ([&:hover], ...)
 *   - `css` (arbitrary CSS escape hatch)
 *
 * Removed boolean sugar set to `true` (`flex: true`, `tabularNums: true`) is
 * reported even when the key is also a property, as the build reports it.
 * Any other key gets the code the engine gives it — `removed-key`,
 * `canonical-key`, `numeric-key` or `unknown-key` — with the args the
 * engine would carry, and its message is filled from the registry's
 * templates, so the editor and the build say the same words and link the
 * same `/e/<code>` page.
 */

import { SZ_DIAGNOSTIC_COMPUTED_VALUES, suggestSzKey } from '@csszyx/compiler';
import { REMOVED_BOOLEAN_SUGAR, REPLACED_KEYS } from '@csszyx/compiler/browser';
import {
    fillSzDiagnosticTemplate,
    SZ_EDITOR_DIAGNOSTIC_TEMPLATES,
} from '@csszyx/compiler/internal';
import * as vscode from 'vscode';

import {
    BOOLEAN_SHORTHANDS,
    KNOWN_SPECIAL_PROPERTIES,
    KNOWN_VARIANTS,
    MIGRATION_NOTES,
    PROPERTY_MAP,
    SPECIAL_VARIANTS,
    SUGGESTION_MAP,
} from './data.js';
import { findSzExpressions } from './parser.js';
import { parseObjectLiteralSafe } from './safe-eval.js';

const DIAGNOSTIC_SOURCE = 'csszyx';
const BACKSLASH = String.fromCodePoint(92);
const REGEX_SPECIAL_CHARACTERS = new Set([
    '.',
    '*',
    '+',
    '?',
    '^',
    '$',
    '{',
    '}',
    '(',
    ')',
    '|',
    '[',
    ']',
    BACKSLASH,
]);

/** Set of all valid top-level sz prop keys (built once).
 *
 * Every vocabulary the compiler accepts has to be listed, including
 * `SPECIAL_VARIANTS` — the parametric ones (`group`, `peer`, `data`, `aria`,
 * `has`, `not`, `supports`) live in their own set because they take a nested
 * key rather than a value, and leaving that set out flagged all seven as
 * unknown props. `group: { hover: … }` is documented on the front page.
 */
const VALID_KEYS = new Set<string>([
    ...Object.keys(PROPERTY_MAP),
    ...BOOLEAN_SHORTHANDS,
    ...KNOWN_SPECIAL_PROPERTIES,
    ...KNOWN_VARIANTS,
    ...SPECIAL_VARIANTS,
]);

/**
 * Returns true for keys that are always valid regardless of content.
 * @param key - The sz prop key to validate
 * @returns True if the key is a known sz prop, boolean shorthand, variant, or arbitrary variant
 */
function isValidKey(key: string): boolean {
    return VALID_KEYS.has(key) || key.startsWith('['); // [&:hover] arbitrary variants
}

/** A key the build reports, as the engine names it. */
export interface KeyIssue {
    code: keyof typeof SZ_EDITOR_DIAGNOSTIC_TEMPLATES;
    args: Readonly<Record<string, string>>;
}

/**
 * A number, the mark of an array or spread passed as an sz object: digits,
 * with an optional fraction of digits (`is_numeric_key` in the engine).
 */
const NUMERIC_KEY = /^\d+(?:\.\d+)?$/;

/**
 * The engine's verdict on removed boolean sugar: a sugar key set to literally
 * `true` emits no class whether or not a table knows the key (`flex` is also a
 * property), so it is asked before any other check.
 *
 * @param key - The key.
 * @param value - Its parsed value.
 * @returns Its code and args, or `undefined` when the key is not sugar set to `true`.
 */
function removedSugarIssue(key: string, value: unknown): KeyIssue | undefined {
    const removed = value === true ? REMOVED_BOOLEAN_SUGAR[key] : undefined;
    if (removed === undefined) return undefined;
    return {
        code: 'removed-key',
        args: {
            form: REPLACED_KEYS.has(key) ? 'sugar-replaced' : 'sugar',
            key,
            replacement: `${removed.key}: '${removed.value}'`,
        },
    };
}

/**
 * The engine's verdict on a key, in the engine's order: removed boolean sugar,
 * a removed key, a flag that was replaced, an alias, a number, or a key that
 * may still be a project's own utility.
 *
 * @param key - The key.
 * @param value - Its parsed value; only `true` can make it removed sugar.
 * @returns Its code and args.
 */
export function keyIssue(key: string, value?: unknown): KeyIssue {
    const sugar = removedSugarIssue(key, value);
    if (sugar !== undefined) return sugar;
    if (MIGRATION_NOTES[key] !== undefined) {
        return { code: 'removed-key', args: { form: 'removed', key } };
    }
    const canonical = SUGGESTION_MAP[key];
    if (canonical !== undefined && REPLACED_KEYS.has(key)) {
        return {
            code: 'removed-key',
            args: { form: 'replaced', key, replacement: `${canonical}: true` },
        };
    }
    if (canonical !== undefined) return { code: 'canonical-key', args: { key } };
    if (NUMERIC_KEY.test(key)) return { code: 'numeric-key', args: { key } };
    const suggestion = suggestSzKey(key);
    return { code: 'unknown-key', args: suggestion === null ? { key } : { key, suggestion } };
}

/**
 * A key's message as the editor shows it: the sentence, then the `help:` and
 * `note:` lines a terminal prints under it.
 *
 * @param issue - The key's code and args.
 * @returns The message and the code's page.
 */
export function keyIssueMessage(issue: KeyIssue): { message: string; docs: string } {
    const { text, help, note, docs } = fillSzDiagnosticTemplate(
        SZ_EDITOR_DIAGNOSTIC_TEMPLATES[issue.code],
        issue,
        SZ_DIAGNOSTIC_COMPUTED_VALUES,
    );
    const labelled = [
        ['help', help],
        ['note', note],
    ].filter((part): part is [string, string] => part[1] !== undefined);
    const lines = [text, ...labelled.map(([label, part]) => `${label}: ${part}`)];
    return { message: lines.join('\n'), docs };
}

/**
 * Build the diagnostic for one key the build reports, within an sz expression.
 *
 * @param document Document being validated.
 * @param expressionSource Original sz expression source.
 * @param startOffset Expression start offset.
 * @param key The sz key.
 * @param value The key's parsed value.
 * @returns Diagnostic or null when the key location cannot be found.
 */
function createKeyDiagnostic(
    document: vscode.TextDocument,
    expressionSource: string,
    startOffset: number,
    key: string,
    value: unknown,
): vscode.Diagnostic | null {
    const keyPattern = new RegExp(String.raw`\b${escapeRegex(key)}\s*:`);
    const localMatch = keyPattern.exec(expressionSource);
    if (!localMatch) {
        return null;
    }
    const absOffset = startOffset + localMatch.index;
    const range = new vscode.Range(
        document.positionAt(absOffset),
        document.positionAt(absOffset + key.length),
    );
    const issue = keyIssue(key, value);
    const { message, docs } = keyIssueMessage(issue);
    const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
    diagnostic.source = DIAGNOSTIC_SOURCE;
    diagnostic.code = { value: issue.code, target: vscode.Uri.parse(docs) };
    return diagnostic;
}

/**
 * Validate all sz props in the document and populate the diagnostic collection.
 * @param document - The document to validate
 * @param collection - The diagnostic collection to write results into
 */
export function validateDocument(
    document: vscode.TextDocument,
    collection: vscode.DiagnosticCollection,
): void {
    const config = vscode.workspace.getConfiguration('csszyx');
    if (!config.get<boolean>('enableDiagnostics', true)) {
        collection.set(document.uri, []);
        return;
    }

    const text = document.getText();
    const diagnostics: vscode.Diagnostic[] = [];

    for (const { objText, startOffset, needsWrap } of findSzExpressions(text)) {
        const evalSrc = needsWrap ? `{ ${objText} }` : objText;
        const obj = parseObjectLiteralSafe(evalSrc);
        if (!obj) continue;

        for (const [key, value] of Object.entries(obj)) {
            if (isValidKey(key) && removedSugarIssue(key, value) === undefined) {
                continue;
            }
            const diagnostic = createKeyDiagnostic(
                document,
                text.slice(startOffset, startOffset + objText.length),
                startOffset,
                key,
                value,
            );
            if (diagnostic) {
                diagnostics.push(diagnostic);
            }
        }
    }

    collection.set(document.uri, diagnostics);
}

/**
 * Escape special regex characters in a string for use in RegExp constructor.
 * @param s - The string to escape
 * @returns Escaped string safe for use as a regex literal
 */
function escapeRegex(s: string): string {
    let escaped = '';
    for (const char of s) {
        escaped += REGEX_SPECIAL_CHARACTERS.has(char) ? `${BACKSLASH}${char}` : char;
    }
    return escaped;
}

/**
 * Create a debounced version of validateDocument (300ms delay).
 * @param collection - The diagnostic collection to pass to validateDocument
 * @returns A function that debounces validation calls per document URI
 */
export function createDebouncedValidator(
    collection: vscode.DiagnosticCollection,
): (doc: vscode.TextDocument) => void {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    return (doc: vscode.TextDocument) => {
        const key = doc.uri.toString();
        const existing = timers.get(key);
        if (existing) {
            clearTimeout(existing);
        }

        timers.set(
            key,
            setTimeout(() => {
                timers.delete(key);
                // The document can close inside the debounce window. Validating
                // it anyway would re-add diagnostics AFTER the close handler
                // deleted them, leaving ghost entries in the collection for a
                // file that is no longer open.
                if (doc.isClosed) {
                    return;
                }
                validateDocument(doc, collection);
            }, 300),
        );
    };
}
