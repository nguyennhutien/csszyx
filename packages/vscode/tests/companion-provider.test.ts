/**
 * Trigger-character companion provider tests.
 *
 * The companion must serve ONLY TriggerCharacter sessions in sz contexts —
 * Invoke/letter sessions belong to the tsserver plugin — and its `:` trigger
 * must stand alone (no space required) while staying silent on ternary colons,
 * quoted moments, and non-sz code.
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
    CompletionTriggerKind: { Invoke: 0, TriggerCharacter: 1, TriggerForIncompleteCompletions: 2 },
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

const { COMPANION_TRIGGERS, SzCompanionProvider } = await import('../src/companion-provider.js');

interface FakePosition {
    line: number;
    character: number;
}

/** Build the minimal TextDocument surface the companion and sz-context read.
 * @param source - Full document text; `|` marks the cursor and is removed.
 * @returns The document stand-in plus the cursor position.
 */
function documentAt(source: string): { document: never; position: never } {
    const cursor = source.indexOf('|');
    if (cursor < 0) throw new Error('source must contain a | cursor marker');
    const text = source.replace('|', '');
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

const provider = new SzCompanionProvider();
const trigger = (character: string) => ({ triggerKind: 1, triggerCharacter: character }) as never;
const invoke = { triggerKind: 0 } as never;
const token = undefined as never;

const itemsAt = (source: string, context: never) => {
    const { document, position } = documentAt(source);
    return provider.provideCompletionItems(document, position, token, context);
};

describe('SzCompanionProvider', () => {
    it('registers the { , : space triggers', () => {
        expect([...COMPANION_TRIGGERS]).toEqual(['{', ',', ':', ' ']);
    });

    it('serves nothing on Invoke — letter sessions belong to the plugin', () => {
        expect(itemsAt('const A = () => <div sz={{ |', invoke)).toBeUndefined();
    });

    it('opens key items on { with snippet chaining into the next session', () => {
        const items = itemsAt('const A = () => <div sz={{|', trigger('{'));
        expect(items?.length).toBeGreaterThan(300);
        const bg = items?.find(item => item.label === 'bg');
        expect((bg?.insertText as { value: string }).value).toBe('bg: $1');
        expect((bg?.command as { command: string }).command).toBe('editor.action.triggerSuggest');
        const hover = items?.find(item => item.label === 'hover');
        expect((hover?.insertText as { value: string }).value).toBe('hover: { $1 }');
    });

    it('opens per-key values on a standalone colon — no space required', () => {
        const items = itemsAt('const A = () => <div sz={{ p:| }} />', trigger(':'));
        expect(items?.length).toBeGreaterThan(0);
        const four = items?.find(item => item.label === '4');
        expect(four?.insertText).toBe('4');
        const px = items?.find(item => item.label === 'px');
        expect(px?.insertText).toBe("'px'");
    });

    it('serves color values for bg after colon plus space', () => {
        const items = itemsAt('const A = () => <div sz={{ bg: | }} />', trigger(' '));
        expect(items?.some(item => item.label === 'red-500')).toBe(true);
    });

    it('serves the owning key in a ternary else-branch — a finite conditional is sz', () => {
        // `p: ok ? 4 : |` — both branches are values of `p` (the compiler
        // hoists finite conditionals), so the else-branch keeps p's values.
        const items = itemsAt('const A = () => <div sz={{ p: ok ? 4 :| }} />', trigger(':'));
        expect(items?.some(item => item.label === '4')).toBe(true);
        // A colon outside any sz object never fires (annotation guard below).
    });

    it('yields quoted moments to the tsserver plugin', () => {
        expect(
            itemsAt("const A = () => <div sz={{ bg: 'red-500' | }} />", trigger(' ')),
        ).toBeUndefined();
    });

    it('serves nothing outside an sz context', () => {
        expect(itemsAt('const config = { retries:| }', trigger(':'))).toBeUndefined();
        expect(itemsAt('const x:| number = 1', trigger(':'))).toBeUndefined();
    });

    // R1 — property-parent gate parity with the tsserver plugin: non-form
    // properties and the opaque css object are silent; a color property's
    // object serves exactly its { color, op } members.
    it('stays silent inside a nested object under a non-form property', () => {
        expect(itemsAt('const A = () => <div sz={{ p: {|', trigger('{'))).toBeUndefined();
        expect(itemsAt('const A = () => <div sz={{ hover: { p: {|', trigger('{'))).toBeUndefined();
        expect(itemsAt('const A = () => <div sz={{ css: {|', trigger('{'))).toBeUndefined();
    });

    it('serves the structured members inside a color-property object', () => {
        const items = itemsAt('const A = () => <div sz={{ bg: {|', trigger('{'));
        expect(items?.map(item => item.label).sort()).toEqual(['color', 'op']);
        const quoted = itemsAt("const A = () => <div sz={{ 'bg': {|", trigger('{'));
        expect(quoted?.length).toBe(2);
        const colorValues = itemsAt('const A = () => <div sz={{ bg: { color:|', trigger(':'));
        expect(colorValues?.some(item => item.label === 'red-500')).toBe(true);
        const opValues = itemsAt('const A = () => <div sz={{ bg: { op:|', trigger(':'));
        expect(opValues?.find(item => item.label === '50')?.insertText).toBe('50');
    });

    it('serves the bgImg gradient form members and values', () => {
        const items = itemsAt('const A = () => <div sz={{ bgImg: {|', trigger('{'));
        expect(items?.map(item => item.label).sort()).toEqual(['dir', 'gradient', 'in']);
        const gradient = itemsAt('const A = () => <div sz={{ bgImg: { gradient:|', trigger(':'));
        expect(gradient?.map(item => item.label).sort()).toEqual(['conic', 'linear', 'radial']);
        expect(gradient?.find(item => item.label === 'linear')?.insertText).toBe("'linear'");
    });

    it('keeps variant and unknown parents suggesting', () => {
        expect(
            itemsAt('const A = () => <div sz={{ hover: {|', trigger('{'))?.length,
        ).toBeGreaterThan(300);
        expect(
            itemsAt('const A = () => <div sz={{ fooVariant: {|', trigger('{'))?.length,
        ).toBeGreaterThan(300);
    });

    // R2 — sibling keys already assigned disappear from key lists.
    it('excludes assigned siblings but keeps everything else', () => {
        const items = itemsAt("const A = () => <div sz={{ color: 'red', |", trigger(','));
        const labels = items?.map(item => (typeof item.label === 'string' ? item.label : ''));
        expect(labels).not.toContain('color');
        expect(labels).toContain('caption');
    });

    it('scopes sibling exclusion to the cursor object only', () => {
        const items = itemsAt('const A = () => <div sz={{ hover: { p: 4 }, |', trigger(','));
        const labels = items?.map(item => (typeof item.label === 'string' ? item.label : ''));
        expect(labels).not.toContain('hover');
        expect(labels).toContain('p');
    });

    // C — szv/szr call sites and the szs attribute.
    const szvDoc = (tail: string) => `import { szv } from 'csszyx';\nconst s = szv(${tail}`;

    it("opens per-key values on ':' inside a szv option object — the field report", () => {
        const items = itemsAt(szvDoc('{ variants: { size: { sm: { bg:| } } } })'), trigger(':'));
        expect(items?.some(item => item.label === 'red-500')).toBe(true);
    });

    it('opens key items inside szv style objects but not at schema levels', () => {
        expect(
            itemsAt(szvDoc('{ variants: { size: { sm: {|'), trigger('{'))?.length,
        ).toBeGreaterThan(300);
        expect(itemsAt(szvDoc('{ variants: {|'), trigger('{'))).toBeUndefined();
        expect(itemsAt(szvDoc('{|'), trigger('{'))).toBeUndefined();
        expect(itemsAt(szvDoc('{ base: {|'), trigger('{'))?.length).toBeGreaterThan(300);
    });

    it('requires a csszyx import for call forms', () => {
        expect(
            itemsAt('const szv = (x) => x; szv({ variants: { size: { sm: {|', trigger('{')),
        ).toBeUndefined();
    });

    it('serves szr and the szs slot styles, but never szs slot names', () => {
        expect(
            itemsAt("import { szr } from 'csszyx';\nszr({|", trigger('{'))?.length,
        ).toBeGreaterThan(300);
        expect(itemsAt('const A = () => <Card szs={{|', trigger('{'))).toBeUndefined();
        expect(
            itemsAt('const A = () => <Card szs={{ header: {|', trigger('{'))?.length,
        ).toBeGreaterThan(300);
        expect(
            itemsAt('const A = () => <Card szs={{ header: { bg:| }', trigger(':'))?.some(
                item => item.label === 'red-500',
            ),
        ).toBe(true);
    });
});
