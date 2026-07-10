/**
 * Trigger-character companion for `@csszyx/ts-plugin` (auto mode, TS/JS only).
 *
 * VS Code only auto-opens completions on identifier keystrokes: `{`, `,`, `:`
 * and space never open TypeScript's list, and a digit can never open one at
 * all. The tsserver plugin therefore owns letter-typed and Invoke sessions,
 * while this provider fills exactly the trigger-character moments,
 * Tailwind-IntelliSense-style:
 *
 * - `{` / `,` (or space after them): key items that insert `key: $1` (variants
 *   insert `variant: { $1 }`) and chain straight into the next suggestion
 *   session via `editor.action.triggerSuggest` — that chained session is
 *   Invoke-kind, so the tsserver plugin serves it.
 * - `:` (standalone, no space required) or space after it: pure per-key value
 *   items — numbers bare, strings quoted — so `p:` finally gets a list.
 *
 * Sessions are partitioned by construction: VS Code queries only providers
 * registered for the typed trigger character, and this provider answers ONLY
 * `TriggerCharacter` invocations (Invoke/letter sessions return nothing). A
 * quote before the cursor also returns nothing — quoted values are the tsserver
 * plugin's `'`/`"` trigger moment.
 */

import * as vscode from 'vscode';

import {
    getValueCompletions,
    KEY_COMPLETIONS,
    KNOWN_VARIANTS,
    TOP_LEVEL_VARIANT_COMPLETIONS,
    VARIANT_KEY_COMPLETIONS,
} from './data.js';
import { getSzContext } from './sz-context.js';

/** Trigger characters this companion registers for. */
export const COMPANION_TRIGGERS = ['{', ',', ':', ' '] as const;

const VARIANT_SET: ReadonlySet<string> = new Set(KNOWN_VARIANTS);

const CHAIN_COMMAND: vscode.Command = {
    command: 'editor.action.triggerSuggest',
    title: 'Suggest',
};

/** Clone a key item into its snippet-chaining companion form.
 * @param item - Prebuilt plain key item.
 * @returns A new item inserting `key: $1` (or `variant: { $1 }`) that reopens suggestions.
 */
function toChainingItem(item: vscode.CompletionItem): vscode.CompletionItem {
    const name = typeof item.label === 'string' ? item.label : item.label.label;
    const clone = new vscode.CompletionItem(item.label, item.kind);
    clone.detail = item.detail;
    clone.documentation = item.documentation;
    clone.filterText = name;
    clone.insertText = new vscode.SnippetString(
        VARIANT_SET.has(name) ? `${name}: { $1 }` : `${name}: $1`,
    );
    clone.command = CHAIN_COMMAND;
    return clone;
}

const CHAINING_KEY_ITEMS = [...KEY_COMPLETIONS, ...TOP_LEVEL_VARIANT_COMPLETIONS].map(
    toChainingItem,
);
const CHAINING_VARIANT_KEY_ITEMS = VARIANT_KEY_COMPLETIONS.map(toChainingItem);

/** Companion provider serving only trigger-character sessions in sz contexts. */
export class SzCompanionProvider implements vscode.CompletionItemProvider {
    /**
     * Serve key/value items for a `{`/`,`/`:`/space trigger inside an sz prop.
     * @param document - The document being edited.
     * @param position - The current cursor position.
     * @param _token - Cancellation token (unused; work is synchronous).
     * @param context - Completion context carrying the trigger kind/character.
     * @returns Items for the triggered moment, or undefined outside it.
     */
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        context: vscode.CompletionContext,
    ): vscode.CompletionItem[] | undefined {
        // Invoke/letter sessions belong to the tsserver plugin.
        if (context.triggerKind !== vscode.CompletionTriggerKind.TriggerCharacter) {
            return undefined;
        }
        // Quoted moments belong to the tsserver plugin's `'`/`"` triggers.
        const line = document.lineAt(position.line).text;
        let scan = position.character - 1;
        while (scan >= 0 && line[scan] === ' ') scan -= 1;
        const before = line[scan];
        if (before === "'" || before === '"' || before === '`') {
            return undefined;
        }

        const ctx = getSzContext(document, position);
        switch (ctx.type) {
            case 'key':
                return [...CHAINING_KEY_ITEMS];
            case 'variant-key':
                return [...CHAINING_VARIANT_KEY_ITEMS];
            case 'value':
            case 'variant-value':
                // The parser resolves the key owning this value slot; a ternary
                // or annotation colon yields no key and stays silent.
                return ctx.currentKey ? getValueCompletions(ctx.currentKey) : undefined;
            default:
                return undefined;
        }
    }
}
