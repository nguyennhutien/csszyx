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

import {
    classifyStyleChain,
    type ObjectFormMember,
    type ObjectValueForm,
    objectValueForm,
    szvStyleChain,
} from '@csszyx/tooling-metadata';
import * as vscode from 'vscode';

import {
    getValueCompletions,
    KEY_COMPLETIONS,
    KNOWN_VARIANTS,
    TOP_LEVEL_VARIANT_COMPLETIONS,
} from './data.js';
import type { SzContext } from './parser.js';
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

/** How many leading characters to scan for a csszyx import (imports sit at the top). */
const IMPORT_SCAN_CHARS = 4_000;
const CSSZYX_IMPORT = /from\s+['"](?:csszyx|@csszyx\/runtime)['"]/;

/** Read a completion item's plain label.
 * @param item - Completion item.
 * @returns The label text.
 */
function labelOf(item: vscode.CompletionItem): string {
    return typeof item.label === 'string' ? item.label : item.label.label;
}

/** Drop keys already assigned in the cursor's object.
 * @param items - Candidate key items.
 * @param siblings - Keys the parser saw assigned at the cursor's depth.
 * @returns The filtered list (a new array when anything was dropped).
 */
function withoutSiblings(
    items: vscode.CompletionItem[],
    siblings: readonly string[],
): vscode.CompletionItem[] {
    if (siblings.length === 0) return items;
    const taken = new Set(siblings);
    return items.filter(item => !taken.has(labelOf(item)));
}

/** Build the chaining key items for a structured object-value form.
 * @param form - The form whose members are the only valid keys.
 * @returns Member key items inserting `name: $1` and reopening suggestions.
 */
function formKeyItems(form: ObjectValueForm): vscode.CompletionItem[] {
    return form.members.map(member => {
        const item = new vscode.CompletionItem(member.name, vscode.CompletionItemKind.Property);
        item.detail = member.detail;
        item.filterText = member.name;
        item.insertText = new vscode.SnippetString(`${member.name}: $1`);
        item.command = CHAIN_COMMAND;
        return item;
    });
}

/** Build value items from a structured-form member's curated list.
 * @param member - The form member owning the value slot.
 * @returns Value items — numbers bare, strings quoted.
 */
function memberValueItems(member: ObjectFormMember): vscode.CompletionItem[] {
    return member.values.map(value => {
        const numeric = value !== '' && !Number.isNaN(Number(value));
        const item = new vscode.CompletionItem(
            value,
            numeric ? vscode.CompletionItemKind.Value : vscode.CompletionItemKind.EnumMember,
        );
        item.insertText = numeric ? value : `'${value}'`;
        item.filterText = value;
        item.detail = `${member.name}: ${numeric ? value : `'${value}'`}`;
        return item;
    });
}

/**
 * Resolve which style-object chain (if any) encloses the cursor for a form.
 *
 * - `sz`: every parent is a style key.
 * - `szs`: depth 1 is the slot-name level (no suggestions); the first parent is
 *   the user-defined slot name and is exempt from the property gate.
 * - `szv`: structural levels (config root, axis, option names) get no
 *   suggestions; only the chain below them is style keys.
 * - `szr`: like `sz`, the whole config object is a style object.
 * @param context - Parsed cursor context.
 * @returns The style-key chain to gate on, or null when not a style position.
 */
function styleChainFor(context: SzContext): readonly string[] | null {
    switch (context.form) {
        case 'sz':
        case 'szr':
            return context.parents;
        case 'szs':
            return context.depth >= 2 ? context.parents.slice(1) : null;
        case 'szv':
            return szvStyleChain(context.parents);
        default:
            return null;
    }
}

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
        if (ctx.type === 'none') {
            return undefined;
        }
        // Call forms are recognized by spelling; require a csszyx import in the
        // document head so a local function named szv cannot trigger styling
        // suggestions. (The tsserver plugin proves provenance via symbols.)
        if (ctx.form === 'szv' || ctx.form === 'szr') {
            const head = document.getText(
                new vscode.Range(new vscode.Position(0, 0), document.positionAt(IMPORT_SCAN_CHARS)),
            );
            if (!CSSZYX_IMPORT.test(head)) return undefined;
        }
        // Structural positions (szs slot names, szv schema levels), the opaque
        // `css` object, and invalid nesting under a utility property get no
        // suggestions. A structured object value (`bg: { color, op }`,
        // `bgImg: { gradient, … }`) is limited to exactly its members.
        const styleChain = styleChainFor(ctx);
        if (styleChain === null) return undefined;
        const innerFirst = [...styleChain].reverse();
        const kind = classifyStyleChain(innerFirst);
        if (kind !== 'style' && kind !== 'object-form') return undefined;
        const form = kind === 'object-form' ? objectValueForm(innerFirst[0] ?? '') : null;
        switch (ctx.type) {
            case 'key':
            case 'variant-key':
                // Full key set at every style level — nested variants are valid
                // (`hover: { focus: { … } }`), matching the tsserver plugin.
                return withoutSiblings(
                    form ? formKeyItems(form) : [...CHAINING_KEY_ITEMS],
                    ctx.siblings,
                );
            case 'value':
            case 'variant-value': {
                // The parser resolves the key owning this value slot; a ternary
                // or annotation colon yields no key and stays silent.
                if (!ctx.currentKey) return undefined;
                if (form) {
                    const member = form.members.find(
                        candidate => candidate.name === ctx.currentKey,
                    );
                    return member ? memberValueItems(member) : undefined;
                }
                return getValueCompletions(ctx.currentKey);
            }
            default:
                return undefined;
        }
    }
}
