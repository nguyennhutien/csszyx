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

import {
    parseCompletionMode,
    resolveCompletionOwner,
    tsconfigMentionsTsPlugin,
} from './completion-arbitration.js';
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

/**
 * Called by VS Code when the extension activates. Registers all providers.
 * @param context - Extension context for managing disposables
 */
export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel('CSSzyx');
    context.subscriptions.push(output);

    // ── Completions ─────────────────────────────────────────────────────────
    // Ownership is arbitrated with @csszyx/ts-plugin: when a workspace
    // tsconfig loads the tsserver plugin, the extension yields completions so
    // the user never sees duplicate entries (VS Code merges completion
    // providers without deduplication). `csszyx.completions` overrides.
    let completionRegistration: vscode.Disposable | undefined;
    context.subscriptions.push(
        new vscode.Disposable(() => completionRegistration?.dispose()),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('csszyx.completions')) {
                void syncCompletionOwnership();
            }
        }),
    );
    void syncCompletionOwnership();

    /**
     * Register or dispose the completion provider to match the resolved owner.
     * Runs at activation and again whenever `csszyx.completions` changes.
     */
    async function syncCompletionOwnership(): Promise<void> {
        const mode = parseCompletionMode(
            vscode.workspace.getConfiguration('csszyx').get('completions'),
        );
        const pluginConfigured = mode === 'auto' && (await workspaceLoadsTsPlugin());
        const owner = resolveCompletionOwner(mode, pluginConfigured);
        if (owner !== 'extension') {
            completionRegistration?.dispose();
            completionRegistration = undefined;
            output.appendLine(
                owner === 'ts-plugin'
                    ? "completions: yielding to @csszyx/ts-plugin (set csszyx.completions to 'extension' to override)"
                    : "completions: disabled by csszyx.completions = 'off'",
            );
            return;
        }
        if (!completionRegistration) {
            // Trigger characters fire completions automatically as the user
            // types inside a sz expression. `{`, `"`, `'` cover the opening of
            // the object in HTML attribute form; `:`, `,`, ` ` cover typing a
            // key/value/separator in both JSX and HTML forms. Without these,
            // VS Code only invokes the provider on Ctrl+Space inside HTML
            // attribute strings.
            completionRegistration = vscode.languages.registerCompletionItemProvider(
                SZ_LANGUAGES,
                new SzCompletionProvider(),
                '{',
                '"',
                "'",
                ':',
                ',',
                ' ',
            );
            output.appendLine('completions: provided by the CSSzyx extension');
        }
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

/**
 * Detect whether any workspace tsconfig loads `@csszyx/ts-plugin`.
 *
 * Bounded scan (25 files, node_modules excluded); unreadable files are
 * skipped so a broken tsconfig can never break activation.
 * @returns True when the tsserver plugin is configured somewhere in the workspace
 */
async function workspaceLoadsTsPlugin(): Promise<boolean> {
    let tsconfigs: readonly vscode.Uri[];
    try {
        tsconfigs = await vscode.workspace.findFiles('**/tsconfig*.json', '**/node_modules/**', 25);
    } catch {
        return false;
    }
    for (const uri of tsconfigs) {
        try {
            const content = await vscode.workspace.fs.readFile(uri);
            if (tsconfigMentionsTsPlugin(new TextDecoder().decode(content))) {
                return true;
            }
        } catch {
            // Unreadable tsconfig: keep checking the rest.
        }
    }
    return false;
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
