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
    // ── Completions ─────────────────────────────────────────────────────────
    // Trigger characters fire completions automatically as the user types
    // inside a sz expression. `{`, `"`, `'` cover the opening of the object in
    // HTML attribute form; `:`, `,`, ` ` cover typing a key/value/separator
    // in both JSX and HTML forms. Without these, VS Code only invokes the
    // provider on Ctrl+Space inside HTML attribute strings.
    const completionProvider = new SzCompletionProvider();
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            SZ_LANGUAGES,
            completionProvider,
            '{', '"', "'", ':', ',', ' ',
        ),
    );

    // ── Hover ────────────────────────────────────────────────────────────────
    const hoverProvider = new SzHoverProvider();
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(SZ_LANGUAGES, hoverProvider),
    );

    // ── Diagnostics ──────────────────────────────────────────────────────────
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('csszyx');
    context.subscriptions.push(diagnosticCollection);

    const debouncedValidate = createDebouncedValidator(diagnosticCollection);

    // Validate already-open documents on activation
    for (const doc of vscode.workspace.textDocuments) {
        if (isSzDocument(doc)) {validateDocument(doc, diagnosticCollection);}
    }

    context.subscriptions.push(
        // Validate immediately when a document opens
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (isSzDocument(doc)) {validateDocument(doc, diagnosticCollection);}
        }),
        // Debounced validation while editing
        vscode.workspace.onDidChangeTextDocument(e => {
            if (isSzDocument(e.document)) {debouncedValidate(e.document);}
        }),
        // Immediate validation on save
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (isSzDocument(doc)) {validateDocument(doc, diagnosticCollection);}
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
