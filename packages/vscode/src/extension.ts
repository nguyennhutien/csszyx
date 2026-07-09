/**
 * CSSzyx VS Code Extension — entry point.
 *
 * Registers:
 *   - CompletionItemProvider  (JSX/TSX/JS/HTML)
 *   - HoverProvider           (JSX/TSX/JS/HTML)
 *   - DiagnosticCollection    (debounced on change, immediate on open/save)
 *
 * All completion data is built at activation time from @csszyx/compiler
 * metadata. Providers are synchronous — no async overhead on every keypress.
 */

import * as vscode from 'vscode';

import { parseCompletionMode, planCompletions } from './completion-arbitration.js';
import { SzCompletionProvider } from './completion-provider.js';
import { createDebouncedValidator, validateDocument } from './diagnostic-provider.js';
import { SzHoverProvider } from './hover-provider.js';

/** Languages where sz props can appear. */
const SZ_LANGUAGES = [
    { language: 'typescriptreact' },
    { language: 'javascriptreact' },
    { language: 'typescript' },
    { language: 'javascript' },
    { language: 'html' },
];

/** HTML alone — tsserver never sees it, so the plugin cannot cover it. */
const HTML_LANGUAGES = [{ language: 'html' }];

/** Plugin id as declared in `contributes.typescriptServerPlugins`. */
const TS_PLUGIN_ID = '@csszyx/ts-plugin';

/**
 * Called by VS Code when the extension activates. Registers all providers.
 * @param context - Extension context for managing disposables
 */
export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel('CSSzyx');
    context.subscriptions.push(output);

    // ── Completions ─────────────────────────────────────────────────────────
    // The extension injects @csszyx/ts-plugin into tsserver (see
    // `contributes.typescriptServerPlugins`), so the plugin serves sz
    // completions in TypeScript/JavaScript. The extension's own provider only
    // covers HTML, which tsserver never sees. `csszyx.completions` re-plans both
    // sides and toggles the plugin so the two never duplicate each other.
    let completionRegistration: vscode.Disposable | undefined;
    context.subscriptions.push(
        new vscode.Disposable(() => completionRegistration?.dispose()),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('csszyx.completions')) {
                void syncCompletions();
            }
        }),
    );
    void syncCompletions();

    /**
     * Re-plan completion ownership from `csszyx.completions`: toggle the
     * tsserver plugin and register the extension's provider for the planned
     * languages. Runs at activation and whenever the setting changes.
     */
    async function syncCompletions(): Promise<void> {
        const mode = parseCompletionMode(
            vscode.workspace.getConfiguration('csszyx').get('completions'),
        );
        const plan = planCompletions(mode);
        await configureTsPlugin(plan.pluginEnabled);

        completionRegistration?.dispose();
        completionRegistration = undefined;
        if (plan.extensionLanguages === 'none') {
            output.appendLine("completions: off (csszyx.completions = 'off')");
            return;
        }
        // Trigger characters fire completions as the user types inside a sz
        // expression: `{`, `"`, `'` open the object (HTML attribute form); `:`,
        // `,`, ` ` cover typing a key/value/separator.
        completionRegistration = vscode.languages.registerCompletionItemProvider(
            plan.extensionLanguages === 'all' ? SZ_LANGUAGES : HTML_LANGUAGES,
            new SzCompletionProvider(),
            '{',
            '"',
            "'",
            ':',
            ',',
            ' ',
        );
        output.appendLine(
            plan.extensionLanguages === 'all'
                ? "completions: extension provides all languages (csszyx.completions = 'extension')"
                : 'completions: @csszyx/ts-plugin handles TS/JS, extension covers HTML',
        );
    }

    // ── Hover ────────────────────────────────────────────────────────────────
    const hoverProvider = new SzHoverProvider();
    context.subscriptions.push(vscode.languages.registerHoverProvider(SZ_LANGUAGES, hoverProvider));

    // ── Diagnostics ──────────────────────────────────────────────────────────
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('csszyx');
    context.subscriptions.push(diagnosticCollection);

    const debouncedValidate = createDebouncedValidator(diagnosticCollection);

    // Validate already-open documents on activation
    for (const doc of vscode.workspace.textDocuments) {
        if (isSzDocument(doc)) {
            validateDocument(doc, diagnosticCollection);
        }
    }

    context.subscriptions.push(
        // Validate immediately when a document opens
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (isSzDocument(doc)) {
                validateDocument(doc, diagnosticCollection);
            }
        }),
        // Debounced validation while editing
        vscode.workspace.onDidChangeTextDocument(e => {
            if (isSzDocument(e.document)) {
                debouncedValidate(e.document);
            }
        }),
        // Immediate validation on save
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (isSzDocument(doc)) {
                validateDocument(doc, diagnosticCollection);
            }
        }),
        // Clean up diagnostics when file is closed
        vscode.workspace.onDidCloseTextDocument(doc => {
            diagnosticCollection.delete(doc.uri);
        }),
    );
}

/**
 *
 */
export function deactivate(): void {
    // VS Code disposes subscriptions registered via context.subscriptions automatically.
}

/** Minimal shape of the built-in TypeScript extension's plugin-config API. */
interface TypeScriptServerApi {
    configurePlugin(pluginId: string, configuration: unknown): void;
}

/**
 * Enable or disable the bundled tsserver plugin through the built-in
 * TypeScript extension's API, so `csszyx.completions` controls it at runtime.
 *
 * The plugin defaults to enabled, so an unavailable API (or a host that is not
 * VS Code) simply leaves it on — never a hard failure.
 * @param enabled - Whether the plugin should serve completions.
 */
async function configureTsPlugin(enabled: boolean): Promise<void> {
    try {
        const tsExtension = vscode.extensions.getExtension('vscode.typescript-language-features');
        if (!tsExtension) {
            return;
        }
        if (!tsExtension.isActive) {
            await tsExtension.activate();
        }
        const api = tsExtension.exports?.getAPI?.(0) as TypeScriptServerApi | undefined;
        api?.configurePlugin?.(TS_PLUGIN_ID, { enabled });
    } catch {
        // Reaching the API is best-effort; the plugin's own default stands.
    }
}

/**
 * Returns true if this document's language could contain sz props.
 * @param doc - The document to check
 * @returns True if the document language is one of the supported sz languages
 */
function isSzDocument(doc: vscode.TextDocument): boolean {
    const lang = doc.languageId;
    return (
        lang === 'typescriptreact' ||
        lang === 'javascriptreact' ||
        lang === 'typescript' ||
        lang === 'javascript' ||
        lang === 'html'
    );
}
