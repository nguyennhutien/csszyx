/**
 * Completion-ownership planning for the CSSzyx extension.
 *
 * The extension ships `@csszyx/ts-plugin` and injects it into tsserver (via the
 * `typescriptServerPlugins` contribution), so the plugin handles sz/szv/szs
 * completions in TypeScript/JavaScript files. The extension's own regex-based
 * completion provider is only needed for HTML, which tsserver does not process.
 *
 * This module is pure — no `vscode` imports — so the decision table stays
 * unit-testable.
 */

/** How the user asked completion ownership to be resolved (`csszyx.completions`). */
export type CompletionMode = 'auto' | 'extension' | 'off';

/** Which languages the extension's own regex provider should serve. */
export type ExtensionLanguages = 'none' | 'html-only' | 'all';

/** The resolved completion plan for a mode. */
export interface CompletionPlan {
    /** Whether the bundled tsserver plugin stays enabled. */
    readonly pluginEnabled: boolean;
    /** Which languages the extension's regex provider registers for. */
    readonly extensionLanguages: ExtensionLanguages;
    /** Whether the TS/JS trigger-character companion provider registers.
     * It fills the moments tsserver can never auto-open (`{` `,` `:` space)
     * and only answers TriggerCharacter sessions, so it never overlaps the
     * plugin's letter/Invoke sessions. */
    readonly companion: boolean;
}

/**
 * Plan who provides sz completions for a mode.
 *
 * - `auto`: the plugin owns TypeScript/JavaScript letter/Invoke sessions, the
 *   trigger-character companion covers `{`/`,`/`:`/space moments, and the
 *   extension's regex provider covers only HTML (tsserver never sees HTML).
 * - `extension`: the plugin is disabled and the extension serves every
 *   language — a fallback for when the plugin is unwanted.
 * - `off`: no sz completions from any provider.
 * @param mode - The `csszyx.completions` setting value.
 * @returns Whether the plugin stays enabled and what the extension registers.
 */
export function planCompletions(mode: CompletionMode): CompletionPlan {
    if (mode === 'off') {
        return { pluginEnabled: false, extensionLanguages: 'none', companion: false };
    }
    if (mode === 'extension') {
        return { pluginEnabled: false, extensionLanguages: 'all', companion: false };
    }
    return { pluginEnabled: true, extensionLanguages: 'html-only', companion: true };
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
