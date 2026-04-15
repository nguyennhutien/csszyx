/**
 * Diagnostic provider — reports unknown sz prop keys as warnings.
 *
 * Runs on document open and after a 300ms debounce on content changes.
 * Only activates when `csszyx.enableDiagnostics` is true (default: true).
 *
 * Valid keys:
 *   - PROPERTY_MAP keys (p, bg, text, ...)
 *   - BOOLEAN_SHORTHANDS (flex, hidden, truncate, ...)
 *   - KNOWN_VARIANTS used as top-level keys (hover, sm, dark, ...)
 *   - Arbitrary variant keys ([&:hover], ...)
 *   - `css` (arbitrary CSS escape hatch)
 *
 * When an unknown key matches SUGGESTION_MAP, the warning includes a hint.
 */

import * as vscode from 'vscode';

import { BOOLEAN_SHORTHANDS, KNOWN_VARIANTS, PROPERTY_MAP, SUGGESTION_MAP } from './data.js';

const DIAGNOSTIC_SOURCE = 'csszyx';

/** Set of all valid top-level sz prop keys (built once). */
const VALID_KEYS = new Set<string>([
    ...Object.keys(PROPERTY_MAP),
    ...BOOLEAN_SHORTHANDS,
    ...KNOWN_VARIANTS,
    'css',
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
 * Find all sz={{ ... }} expressions in the document using brace-counting.
 * Returns the object text and the document offset of the opening `{`.
 * @param text - Full document text to scan
 * @returns Array of found expressions with their text and source offset
 */
function findSzExpressions(text: string): Array<{ objText: string; startOffset: number }> {
    const results: Array<{ objText: string; startOffset: number }> = [];
    let searchFrom = 0;

    while (searchFrom < text.length) {
        const szIdx = text.indexOf('sz={{', searchFrom);
        if (szIdx === -1) {break;}

        const objStart = szIdx + 4; // outer `{`
        let depth = 0;
        let objEnd = -1;

        for (let i = objStart; i < text.length; i++) {
            if (text[i] === '{') {depth++;} else if (text[i] === '}') {
                depth--;
                if (depth === 0) { objEnd = i + 1; break; }
            }
        }

        if (objEnd !== -1) {
            results.push({ objText: text.slice(objStart, objEnd), startOffset: objStart });
        }

        searchFrom = szIdx + 5;
    }

    return results;
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

    for (const { objText, startOffset } of findSzExpressions(text)) {
        let obj: Record<string, unknown>;
        try {

            obj = new Function(`"use strict"; return (${objText})`)() as Record<string, unknown>;
        } catch {
            continue; // dynamic values prevent static eval — skip silently
        }

        for (const key of Object.keys(obj)) {
            if (isValidKey(key)) {continue;}

            // Find the key's position in the original source text
            // Search within the sz expression only to avoid false matches
            const keyPattern = new RegExp(`\\b${escapeRegex(key)}\\s*:`);
            const localMatch = keyPattern.exec(text.slice(startOffset, startOffset + objText.length));
            if (!localMatch) {continue;}

            const absOffset = startOffset + localMatch.index;
            const startPos = document.positionAt(absOffset);
            const endPos = document.positionAt(absOffset + key.length);
            const range = new vscode.Range(startPos, endPos);

            const suggestion = SUGGESTION_MAP[key];
            const message = suggestion
                ? `Unknown sz prop '${key}'. Did you mean '${suggestion}'?`
                : `Unknown sz prop '${key}'. See https://csszyx.com/docs/sz-props for valid props.`;

            const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
            diag.source = DIAGNOSTIC_SOURCE;
            if (suggestion) {
                // Attach a code + data so a future CodeAction can auto-fix it
                diag.code = { value: 'unknown-prop', target: vscode.Uri.parse('https://csszyx.com/docs/migrate') };
            }
            diagnostics.push(diag);
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
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        if (existing) {clearTimeout(existing);}

        timers.set(key, setTimeout(() => {
            timers.delete(key);
            validateDocument(doc, collection);
        }, 300));
    };
}
