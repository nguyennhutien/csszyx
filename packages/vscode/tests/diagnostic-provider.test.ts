/**
 * Debounced-validator lifecycle tests.
 *
 * The debounce timer can outlive its document: closing a file within the
 * debounce window fires the timer AFTER `onDidCloseTextDocument` deleted the
 * file's diagnostics, re-adding entries for a document that is no longer open.
 * These tests lock the guard that drops the pending validation instead.
 *
 * Only the pieces of the VS Code API that this path touches are mocked; the
 * disabled-diagnostics configuration keeps `validateDocument` on its early
 * `collection.set(uri, [])` branch so no parsing infrastructure is needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            get: (_key: string, _fallback: boolean) => false,
        }),
    },
    DiagnosticSeverity: { Warning: 1 },
    Range: class {},
    Diagnostic: class {},
    Uri: { parse: (value: string) => value },
    // Pulled in transitively via ./data.js (completion metadata built at import).
    CompletionItem: class {
        constructor(
            public label: string,
            public kind: number,
        ) {}
    },
    CompletionItemKind: { Property: 9, Value: 11 },
    MarkdownString: class {
        value = '';
        appendMarkdown(text: string): void {
            this.value += text;
        }
        appendCodeblock(text: string): void {
            this.value += text;
        }
    },
    SnippetString: class {
        constructor(public value: string) {}
    },
}));

const { createDebouncedValidator } = await import('../src/diagnostic-provider.js');

/**
 * Minimal TextDocument stand-in for the debounce path.
 * @param uri - document URI string
 * @returns object with the fields the validator reads
 */
function fakeDocument(uri: string): { uri: { toString: () => string }; isClosed: boolean } {
    return {
        uri: { toString: () => uri },
        isClosed: false,
    };
}

describe('createDebouncedValidator', () => {
    let collection: { set: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.useFakeTimers();
        collection = { set: vi.fn(), delete: vi.fn() };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('validates an open document after the debounce window', () => {
        const validate = createDebouncedValidator(collection as never);
        const doc = fakeDocument('file:///a.tsx');

        validate(doc as never);
        expect(collection.set).not.toHaveBeenCalled();

        vi.advanceTimersByTime(300);
        expect(collection.set).toHaveBeenCalledOnce();
    });

    it('coalesces rapid edits into one validation', () => {
        const validate = createDebouncedValidator(collection as never);
        const doc = fakeDocument('file:///a.tsx');

        validate(doc as never);
        vi.advanceTimersByTime(100);
        validate(doc as never);
        vi.advanceTimersByTime(300);

        expect(collection.set).toHaveBeenCalledOnce();
    });

    it('does not re-add diagnostics for a document closed inside the debounce window', () => {
        const validate = createDebouncedValidator(collection as never);
        const doc = fakeDocument('file:///a.tsx');

        validate(doc as never);
        // Close before the timer fires — the close handler already removed the
        // document's diagnostics; the late timer must not resurrect them.
        doc.isClosed = true;
        vi.advanceTimersByTime(300);

        expect(collection.set).not.toHaveBeenCalled();
    });
});
