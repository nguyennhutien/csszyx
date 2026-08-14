/**
 * Diagnostic provider — reports unknown sz prop keys as warnings.
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
 * When an unknown key matches SUGGESTION_MAP, the warning includes a hint.
 */

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

/**
 * Build one unknown-key diagnostic within an sz expression.
 *
 * @param document Document being validated.
 * @param expressionSource Original sz expression source.
 * @param startOffset Expression start offset.
 * @param key Unknown key.
 * @returns Diagnostic or null when the key location cannot be found.
 */
function createUnknownKeyDiagnostic(
    document: vscode.TextDocument,
    expressionSource: string,
    startOffset: number,
    key: string,
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
    const note = MIGRATION_NOTES[key];
    const suggestion = SUGGESTION_MAP[key];
    let message: string;
    if (note) {
        // A removed key with a SHAPE replacement reads wrong through the
        // did-you-mean template ("Did you mean 'maskLinear / maskRadial /
        // maskConic with { from }'?") — say what happened instead.
        message = `'${key}' was removed: ${note}.`;
    } else if (suggestion) {
        message = `Unknown sz prop '${key}'. Did you mean '${suggestion}'?`;
    } else {
        message = `Unknown sz prop '${key}'. See https://csszyx.com/docs/sz-props for valid props.`;
    }
    const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
    diagnostic.source = DIAGNOSTIC_SOURCE;
    if (note || suggestion) {
        diagnostic.code = {
            value: 'unknown-prop',
            target: vscode.Uri.parse('https://csszyx.com/docs/migrate'),
        };
    }
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

        for (const key of Object.keys(obj)) {
            if (isValidKey(key)) {
                continue;
            }
            const diagnostic = createUnknownKeyDiagnostic(
                document,
                text.slice(startOffset, startOffset + objText.length),
                startOffset,
                key,
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
