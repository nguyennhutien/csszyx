/**
 * CompletionItemProvider for sz props.
 *
 * - Key position (depth 1): PROPERTY_MAP keys + BOOLEAN_SHORTHANDS + KNOWN_VARIANTS + `css`
 * - Value position (depth 1): curated VALUE_SUGGESTIONS for the current key
 * - Variant key position (depth 2): PROPERTY_MAP keys only (no nested variants)
 * - Variant value position (depth 2): same VALUE_SUGGESTIONS lookup
 *
 * All completions are built once at activation and returned synchronously.
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
                // Top-level: all props + boolean shorthands + variants
                return [...KEY_COMPLETIONS, ...TOP_LEVEL_VARIANT_COMPLETIONS];

            case 'variant-key':
                // Inside variant object: props only (no nested variants)
                return VARIANT_KEY_COMPLETIONS;

            case 'value':
            case 'variant-value':
                if (!ctx.currentKey) {return undefined;}
                return getValueCompletions(ctx.currentKey);

            default:
                return undefined;
        }
    }
}
