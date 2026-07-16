/**
 * Static completion data derived from @csszyx/compiler metadata.
 * Built once at module load — all completion lookups are O(1) array reads.
 */

import {
    BOOLEAN_SHORTHANDS,
    SUGGESTION_MAP as GENERATED_SUGGESTION_MAP,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    VALUE_SUGGESTIONS,
} from '@csszyx/tooling-metadata';
import * as vscode from 'vscode';

/** Widen generated literal keys for diagnostics fed by arbitrary user input. */
export const SUGGESTION_MAP: Readonly<Record<string, string>> = GENERATED_SUGGESTION_MAP;

// ============================================================================
// PRE-BUILT COMPLETION ITEMS (built once at module load)
// ============================================================================

/**
 * Build a MarkdownString showing the Tailwind prefix for a sz prop.
 * @param tailwindPrefix - The Tailwind utility prefix (e.g. "bg", "p")
 * @returns Formatted MarkdownString for CompletionItem documentation
 */
function doc(tailwindPrefix: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString(`**CSSzyx** → \`${tailwindPrefix}-*\``);
    md.isTrusted = true;
    return md;
}

/** CompletionItems for top-level sz prop keys (PROPERTY_MAP + BOOLEAN_SHORTHANDS). */
export const KEY_COMPLETIONS: vscode.CompletionItem[] = [
    // Regular props from PROPERTY_MAP
    ...Object.entries(PROPERTY_MAP).map(([key, twPrefix]) => {
        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
        item.documentation = doc(twPrefix);
        item.detail = `sz prop → ${twPrefix}-*`;
        item.insertText = new vscode.SnippetString(`${key}: $1,`);
        return item;
    }),
    // Boolean shorthands — value is always `true`
    ...[...BOOLEAN_SHORTHANDS].map(key => {
        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Field);
        item.documentation = new vscode.MarkdownString(`**CSSzyx** boolean shorthand → \`${key}\``);
        item.detail = `sz boolean → ${key}`;
        item.insertText = new vscode.SnippetString(`${key}: true,`);
        return item;
    }),
    // Special: css key for arbitrary CSS
    (() => {
        const item = new vscode.CompletionItem('css', vscode.CompletionItemKind.Property);
        item.documentation = new vscode.MarkdownString(
            '**CSSzyx** arbitrary CSS escape hatch.\n\nAccepts any `CSS.Properties` key + CSS custom properties (`--*`).',
        );
        item.detail = 'sz arbitrary CSS';
        item.insertText = new vscode.SnippetString('css: { $1 },');
        return item;
    })(),
];

/** CompletionItems for variant keys (inside a variant object like `hover: { | }`). */
export const VARIANT_KEY_COMPLETIONS: vscode.CompletionItem[] = Object.entries(PROPERTY_MAP).map(
    ([key, twPrefix]) => {
        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
        item.documentation = doc(twPrefix);
        item.detail = `sz prop → ${twPrefix}-*`;
        item.insertText = new vscode.SnippetString(`${key}: $1,`);
        return item;
    },
);

/** CompletionItems for top-level variant keys (hover, focus, sm, md, ...). */
export const TOP_LEVEL_VARIANT_COMPLETIONS: vscode.CompletionItem[] = [...KNOWN_VARIANTS].map(v => {
    const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Module);
    item.documentation = new vscode.MarkdownString(`**CSSzyx** variant → \`${v}:\` prefix`);
    item.detail = 'sz variant';
    item.insertText = new vscode.SnippetString(`${v}: { $1 },`);
    return item;
});

/**
 * Build value completion items for a given sz key.
 *
 * String values are labeled WITHOUT surrounding quotes (`center`, not `'center'`)
 * for a cleaner dropdown. The insertText keeps single quotes so a bare selection
 * still produces a valid JS object literal. The provider re-adjusts the
 * replacement range at completion time if the user has already typed a quote.
 * @param key - The sz prop key (e.g. "bg", "p")
 * @returns Array of CompletionItems, or empty array if no suggestions exist for this key
 */
export function getValueCompletions(key: string): vscode.CompletionItem[] {
    const values = VALUE_SUGGESTIONS[key];
    if (!values) {
        return [];
    }
    return values.map(v => {
        const isNum = !Number.isNaN(Number(v)) && v !== '';
        const item = new vscode.CompletionItem(
            v,
            isNum ? vscode.CompletionItemKind.Value : vscode.CompletionItemKind.EnumMember,
        );
        item.insertText = isNum ? v : `'${v}'`;
        item.filterText = v;
        const detailValue = isNum ? v : `'${v}'`;
        item.detail = `${key}: ${detailValue}`;
        return item;
    });
}

// Export compiler data for use by diagnostic-provider and hover-provider
// Re-export for use by diagnostic-provider (avoids a second import of compiler/browser)
export { BOOLEAN_SHORTHANDS, KNOWN_VARIANTS, PROPERTY_MAP };
