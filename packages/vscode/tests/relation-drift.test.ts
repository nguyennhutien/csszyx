/**
 * Drift guard: the regex companion and the AST tsserver plugin must reach the
 * SAME serve/silent verdict for the same structure. One shared table runs
 * through both real classifiers — a relationship-rule change that lands on only
 * one side fails here instead of in a user's editor.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
    CompletionItem: class {
        detail?: unknown;
        documentation?: unknown;
        filterText?: string;
        insertText?: unknown;
        command?: unknown;
        constructor(
            public label: string,
            public kind: number,
        ) {}
    },
    CompletionItemKind: { EnumMember: 19, Field: 4, Module: 8, Property: 9, Value: 11 },
    CompletionTriggerKind: { Invoke: 0, TriggerCharacter: 1 },
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
    Range: class {
        constructor(
            public start: { line: number; character: number },
            public end: { line: number; character: number },
        ) {}
    },
    Position: class {
        constructor(
            public line: number,
            public character: number,
        ) {}
    },
}));

import ts from 'typescript';

const { SzCompanionProvider } = await import('../src/companion-provider.js');
const { computeSzEntries } = await import('../../ts-plugin/src/core.js');

/** Shared verdict table: does a key list open at `{ |`? */
const VERDICTS: ReadonlyArray<{ source: string; serves: boolean; note: string }> = [
    {
        source: 'const A = () => <div sz={{ p: { | } }} />;',
        serves: false,
        note: 'non-form property parent gates nesting',
    },
    {
        source: 'const A = () => <div sz={{ bg: { | } }} />;',
        serves: true,
        note: 'color property serves its { color, op } form',
    },
    {
        source: 'const A = () => <div sz={{ bgImg: { | } }} />;',
        serves: true,
        note: 'bgImg serves its gradient form',
    },
    {
        source: 'const A = () => <div sz={{ css: { | } }} />;',
        serves: false,
        note: 'css object is opaque (arbitrary CSS properties)',
    },
    {
        source: 'const A = () => <div sz={{ hover: { | } }} />;',
        serves: true,
        note: 'variant parent nests',
    },
    {
        source: 'const A = () => <div sz={{ fooVariant: { | } }} />;',
        serves: true,
        note: 'unknown parent keeps benefit of the doubt',
    },
    {
        source: "import { szv } from 'csszyx';\nconst s = szv({ variants: { size: { sm: { | } } } });",
        serves: true,
        note: 'szv option style object',
    },
    {
        source: "import { szv } from 'csszyx';\nconst s = szv({ variants: { | } });",
        serves: false,
        note: 'szv axis level is schema, not style',
    },
    {
        source: "import { szr } from 'csszyx';\nconst s = szr({ p: { | } });",
        serves: false,
        note: 'property parent gates inside szr too',
    },
    {
        source: 'const A = () => <Card szs={{ | }} />;',
        serves: false,
        note: 'szs slot-name level',
    },
    {
        source: 'const A = () => <Card szs={{ header: { | } }} />;',
        serves: true,
        note: 'szs slot style object',
    },
];

interface FakePosition {
    line: number;
    character: number;
}

/** Build the minimal document surface for the companion.
 * @param text - Document text with the cursor already removed.
 * @param cursor - Cursor offset in `text`.
 * @returns The document stand-in plus the cursor position.
 */
function fakeDocument(text: string, cursor: number): { document: never; position: never } {
    const lines = text.split('\n');
    const offsetOf = (position: FakePosition): number =>
        lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) +
        position.character;
    const positionOf = (offset: number): FakePosition => {
        let remaining = offset;
        for (let line = 0; line < lines.length; line += 1) {
            const length = (lines[line] ?? '').length;
            if (remaining <= length) return { line, character: remaining };
            remaining -= length + 1;
        }
        return { line: lines.length - 1, character: (lines.at(-1) ?? '').length };
    };
    const document = {
        lineAt: (line: number) => ({ text: lines[line] ?? '' }),
        offsetAt: offsetOf,
        positionAt: positionOf,
        getText: (range: { start: FakePosition; end: FakePosition }) =>
            text.slice(offsetOf(range.start), offsetOf(range.end)),
    };
    return { document: document as never, position: positionOf(cursor) as never };
}

/** Companion verdict via the real provider on a `{`-trigger session.
 * @param text - Document text with cursor removed.
 * @param cursor - Cursor offset.
 * @returns Whether key items were served.
 */
function companionServes(text: string, cursor: number): boolean {
    const provider = new SzCompanionProvider();
    const { document, position } = fakeDocument(text, cursor);
    const items = provider.provideCompletionItems(
        document,
        position,
        undefined as never,
        {
            triggerKind: 1,
            triggerCharacter: '{',
        } as never,
    );
    return (items?.length ?? 0) > 0;
}

/** Plugin verdict via the real classifier on an in-memory language service.
 * @param text - Document text with cursor removed.
 * @param cursor - Cursor offset.
 * @returns Whether key entries were computed.
 */
function pluginServes(text: string, cursor: number): boolean {
    const fileName = '/virtual/drift.tsx';
    const files: Record<string, string> = { [fileName]: text };
    const host: ts.LanguageServiceHost = {
        getScriptFileNames: () => [fileName],
        getScriptVersion: () => '1',
        getScriptSnapshot: file => {
            const content =
                files[file] ?? (ts.sys.fileExists(file) ? ts.sys.readFile(file) : undefined);
            return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
        },
        getCurrentDirectory: () => '/virtual',
        getCompilationSettings: () => ({ jsx: ts.JsxEmit.ReactJSX, allowJs: true }),
        getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
        fileExists: file => file in files || ts.sys.fileExists(file),
        readFile: file => files[file] ?? ts.sys.readFile(file),
    };
    const service = ts.createLanguageService(host);
    const entries = computeSzEntries(
        ts as never,
        service as never,
        fileName,
        cursor,
        { enabled: true, values: true, maxEntries: 512, deadlineMs: 20, failureThreshold: 3 },
        Number.POSITIVE_INFINITY,
    );
    return entries.length > 0;
}

describe('relationship verdicts stay identical across both classifiers', () => {
    for (const { source, serves, note } of VERDICTS) {
        it(`${note}: ${serves ? 'serves' : 'silent'}`, () => {
            const cursor = source.indexOf('|');
            const text = source.replace('|', '');
            expect(companionServes(text, cursor), 'companion').toBe(serves);
            expect(pluginServes(text, cursor), 'plugin').toBe(serves);
        });
    }
});
