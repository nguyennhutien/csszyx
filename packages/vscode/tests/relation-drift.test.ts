/**
 * Drift guard: the regex companion and the AST tsserver plugin must reach the
 * SAME serve/silent verdict for the same structure. One shared table runs
 * through both real classifiers — a relationship-rule change that lands on only
 * one side fails here instead of in a user's editor.
 */
import {
    createDefaultMapFromNodeModules,
    createSystem,
    createVirtualTypeScriptEnvironment,
} from '@typescript/vfs';
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

const PLUGIN_FILE = '/virtual/drift.tsx';
const COMPILER_OPTIONS: ts.CompilerOptions = { jsx: ts.JsxEmit.ReactJSX, allowJs: true };

/**
 * One TypeScript environment for the whole table.
 *
 * A language service loads the standard library when it first builds a program,
 * and building one per case is what made this file the slowest in the package —
 * measured, eleven fresh services cost 839ms against 66ms for one reused, and on
 * a CI runner the same shape reached 25s and tripped the 5s timeout.
 *
 * Reuse needs the service to notice the file changed, which it decides from the
 * script VERSION rather than the content: hand it the same version twice and it
 * answers from the parse it already has, so every case after the first would be
 * graded against the first case's source and the suite would pass without
 * checking anything. `updateFile` from `@typescript/vfs` — the TypeScript team's
 * own virtual file system, which the Playground runs on — owns that bookkeeping,
 * which is why this does not hand-roll a counter.
 */
const pluginFiles = createDefaultMapFromNodeModules(COMPILER_OPTIONS, ts);
// The root file has to exist before the environment is built, and the seed has
// to be non-empty: an empty string reads back as a missing file and the program
// fails to construct. Every case replaces it through `updateFile` below.
pluginFiles.set(PLUGIN_FILE, 'export {};');
const pluginEnv = createVirtualTypeScriptEnvironment(
    createSystem(pluginFiles),
    [PLUGIN_FILE],
    ts,
    COMPILER_OPTIONS,
);

/** Plugin verdict via the real classifier on an in-memory language service.
 * @param text - Document text with cursor removed.
 * @param cursor - Cursor offset.
 * @returns Whether key entries were computed.
 */
function pluginServes(text: string, cursor: number): boolean {
    const fileName = PLUGIN_FILE;
    // Empty content does not merely fail this case, it poisons every later one:
    // the virtual system reads a file back through a truthiness check, so `''`
    // makes the source file vanish and the NEXT `updateFile` throws
    // "Did not find a source file". No verdict in the table can reach here empty
    // — removing the cursor marker cannot empty a source — so this guards the
    // table against a future row rather than the code against itself.
    if (text.trim().length === 0) {
        throw new Error('relation-drift verdict sources must not be empty');
    }
    pluginEnv.updateFile(fileName, text);
    const service = pluginEnv.languageService;
    const entries = computeSzEntries({
        tsMod: ts as never,
        languageService: service as never,
        fileName,
        position: cursor,
        config: {
            enabled: true,
            values: true,
            themeValues: false,
            maxEntries: 512,
            deadlineMs: 20,
            failureThreshold: 3,
        },
        deadline: Number.POSITIVE_INFINITY,
        projectRoot: '/virtual',
    });
    return entries.length > 0;
}

describe('relationship verdicts stay identical across both classifiers', () => {
    for (const { source, serves, note } of VERDICTS) {
        it(`${note}: ${serves ? 'serves' : 'silent'}`, () => {
            const cursor = source.indexOf('|');
            const text = source.slice(0, cursor) + source.slice(cursor + 1);
            expect(companionServes(text, cursor), 'companion').toBe(serves);
            expect(pluginServes(text, cursor), 'plugin').toBe(serves);
        });
    }
});
