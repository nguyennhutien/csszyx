/**
 * Completion-ownership arbitration between this extension and
 * `@csszyx/ts-plugin` (the tsserver language-service plugin).
 *
 * Exactly one provider should own sz/szv/szs completions for a workspace,
 * otherwise VS Code shows every key twice (the editor merges completion
 * providers without deduplication). This module is pure — no `vscode`
 * imports — so the decision table stays unit-testable.
 */

/** How the user asked completion ownership to be resolved. */
export type CompletionMode = 'auto' | 'extension' | 'off';

/** Which provider ends up owning sz completions. */
export type CompletionOwner = 'extension' | 'ts-plugin' | 'none';

/**
 * Decide who provides sz completions.
 * @param mode - The `csszyx.completions` setting value.
 * @param pluginConfigured - Whether a workspace tsconfig loads `@csszyx/ts-plugin`.
 * @returns The completion owner for this workspace.
 */
export function resolveCompletionOwner(
    mode: CompletionMode,
    pluginConfigured: boolean,
): CompletionOwner {
    if (mode === 'off') {
        return 'none';
    }
    if (mode === 'extension') {
        return 'extension';
    }
    return pluginConfigured ? 'ts-plugin' : 'extension';
}

/**
 * Normalize the raw setting value, tolerating unknown strings from
 * hand-edited settings files.
 * @param value - Raw `csszyx.completions` value from configuration.
 * @returns A valid mode, falling back to `auto`.
 */
export function parseCompletionMode(value: unknown): CompletionMode {
    return value === 'extension' || value === 'off' ? value : 'auto';
}

/**
 * Check whether tsconfig content enables the csszyx tsserver plugin.
 *
 * A plain substring test is deliberate: tsconfig files are JSONC (comments,
 * trailing commas), and `extends` chains make structural resolution
 * expensive. A commented-out plugin entry may match, which errs on the safe
 * side — the user can force the extension back with
 * `csszyx.completions: "extension"`.
 * @param content - Raw tsconfig file content.
 * @returns True when the file references `@csszyx/ts-plugin`.
 */
export function tsconfigMentionsTsPlugin(content: string): boolean {
    return content.includes('@csszyx/ts-plugin');
}
