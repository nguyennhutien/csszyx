/**
 * CompletionItemProvider for sz props.
 *
 * - Key position (depth 1): PROPERTY_MAP keys + BOOLEAN_SHORTHANDS + KNOWN_VARIANTS + `css`
 * - Value position (depth 1): curated VALUE_SUGGESTIONS for the current key
 * - Variant key position (depth 2): PROPERTY_MAP keys only (no nested variants)
 * - Variant value position (depth 2): same VALUE_SUGGESTIONS lookup
 *
 * All completions are built once at activation and returned synchronously.
 * String value items re-target their replacement range at request time to
 * absorb any quote characters the user has already typed (and any matching
 * quote inserted by editor auto-pair), so selecting `'center'` never results
 * in `''center''`.
 */

import * as vscode from 'vscode';

import {
    getValueCompletions,
    KEY_COMPLETIONS,
    TOP_LEVEL_VARIANT_COMPLETIONS,
    VARIANT_KEY_COMPLETIONS,
} from './data.js';
import { getSzContext } from './sz-context.js';

/**
 * If the cursor sits at (or inside) a partially-typed quoted value, return the
 * range covering the opening quote, any typed word chars, and a matching
 * auto-paired closing quote (if present). Otherwise return null.
 *
 * Examples (cursor shown as `|`):
 *   `'|`      → covers the opening `'`
 *   `'|'`     → covers both quotes (auto-paired)
 *   `'ce|`    → covers `'ce`
 *   `'ce|'`   → covers `'ce'`
 *   `: |`     → null (no preceding quote)
 * @param document - The document being edited.
 * @param position - The cursor position at completion time.
 * @returns Range to replace, or null if no quote is present before the cursor.
 */
function getQuotedValueRange(
    document: vscode.TextDocument,
    position: vscode.Position,
): vscode.Range | null {
    const line = document.lineAt(position.line).text;

    // Walk backward across word-identifier chars to find the opening quote.
    let start = position.character - 1;
    while (start >= 0 && /[a-zA-Z0-9_-]/.test(line[start] ?? '')) { start--; }
    if (start < 0) { return null; }
    const opener = line[start];
    if (opener !== "'" && opener !== '"') { return null; }

    // Walk forward from the cursor across word chars to find a matching closer.
    let end = position.character;
    while (end < line.length && /[a-zA-Z0-9_-]/.test(line[end] ?? '')) { end++; }
    if (line[end] === opener) { end++; }

    return new vscode.Range(
        new vscode.Position(position.line, start),
        new vscode.Position(position.line, end),
    );
}

/**
 *
 */
export class SzCompletionProvider implements vscode.CompletionItemProvider {
    /**
     * Return completion items if the cursor is inside a sz prop expression.
     * @param document - The document being edited
     * @param position - The current cursor position
     * @returns Completion items array, or undefined if cursor is not in a sz context
     */
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.CompletionItem[] | undefined {
        const ctx = getSzContext(document, position);

        switch (ctx.type) {
            case 'key':
                return [...KEY_COMPLETIONS, ...TOP_LEVEL_VARIANT_COMPLETIONS];

            case 'variant-key':
                return VARIANT_KEY_COMPLETIONS;

            case 'value':
            case 'variant-value': {
                if (!ctx.currentKey) { return undefined; }
                const items = getValueCompletions(ctx.currentKey);
                const quoteRange = getQuotedValueRange(document, position);
                if (quoteRange) {
                    for (const item of items) {
                        if (item.kind === vscode.CompletionItemKind.EnumMember) {
                            item.range = quoteRange;
                        }
                    }
                }
                return items;
            }

            default:
                return undefined;
        }
    }
}
