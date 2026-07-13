/**
 * SzCompletionProvider tests — the full extension-side provider (HTML files
 * and `csszyx.completions: "extension"` mode).
 *
 * Covers the four context kinds (key / variant-key / value / variant-value)
 * and the quote-absorption range applied to string value items so that
 * selecting `'center'` after a typed `'` never produces `''center''`.
 * Runs headless with the same `vscode` module mock as the companion tests.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
    CompletionItem: class {
        detail?: unknown;
        documentation?: unknown;
        filterText?: string;
        insertText?: unknown;
        range?: unknown;
        command?: unknown;
        constructor(
            public label: string,
            public kind: number,
        ) {}
    },
    CompletionItemKind: { EnumMember: 19, Field: 4, Module: 8, Property: 9, Value: 11 },
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

const { SzCompletionProvider } = await import('../src/completion-provider.js');
const { getValueCompletions } = await import('../src/data.js');

interface FakePosition {
    line: number;
    character: number;
}

/** Build the minimal TextDocument surface the provider and sz-context read.
 * @param source - Full document text; `|` marks the cursor and is removed.
 * @returns The document stand-in plus the cursor position.
 */
function documentAt(source: string): { document: never; position: never } {
    const cursor = source.indexOf('|');
    if (cursor < 0) throw new Error('source must contain a | cursor marker');
    const text = source.slice(0, cursor) + source.slice(cursor + 1);
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

const provider = new SzCompletionProvider();

const itemsAt = (source: string) => {
    const { document, position } = documentAt(source);
    return provider.provideCompletionItems(document, position);
};

interface RangeLike {
    start: FakePosition;
    end: FakePosition;
}

describe('SzCompletionProvider — key positions', () => {
    it('serves props, boolean shorthands, css, and variants at top level', () => {
        const items = itemsAt('const A = () => <div sz={{ |');
        expect(items?.length).toBeGreaterThan(300);
        const labels = items?.map(item => item.label);

        const bg = items?.find(item => item.label === 'bg');
        expect(bg?.kind).toBe(9); // Property
        expect(bg?.detail).toBe('sz prop → bg-*');
        expect((bg?.insertText as { value: string }).value).toBe('bg: $1,');

        const container = items?.find(item => item.label === 'container');
        expect(container?.kind).toBe(4); // Field (boolean shorthand)
        expect((container?.insertText as { value: string }).value).toBe('container: true,');

        const css = items?.find(item => item.label === 'css');
        expect((css?.insertText as { value: string }).value).toBe('css: { $1 },');

        const hover = items?.find(item => item.label === 'hover');
        expect(hover?.kind).toBe(8); // Module (variant)
        expect((hover?.insertText as { value: string }).value).toBe('hover: { $1 },');

        expect(labels).toContain('p');
    });

    it('serves only PROPERTY_MAP keys inside a variant object', () => {
        const items = itemsAt('const A = () => <div sz={{ hover: { |');
        expect(items?.length).toBeGreaterThan(0);
        const labels = items?.map(item => item.label);
        expect(labels).toContain('bg');
        // No nested variants and no css escape hatch at variant depth.
        expect(labels).not.toContain('hover');
        expect(labels).not.toContain('css');
        const p = items?.find(item => item.label === 'p');
        expect((p?.insertText as { value: string }).value).toBe('p: $1,');
    });
});

describe('SzCompletionProvider — value positions', () => {
    it('serves curated values: numbers bare, strings quoted', () => {
        const items = itemsAt('const A = () => <div sz={{ p: | }} />');
        const four = items?.find(item => item.label === '4');
        expect(four?.kind).toBe(11); // Value (numeric)
        expect(four?.insertText).toBe('4');
        const px = items?.find(item => item.label === 'px');
        expect(px?.kind).toBe(19); // EnumMember (string)
        expect(px?.insertText).toBe("'px'");
        expect(px?.detail).toBe("p: 'px'");
        // No quote typed → no replacement-range retargeting.
        expect(px?.range).toBeUndefined();
    });

    it('serves values inside a variant object too', () => {
        const items = itemsAt('const A = () => <div sz={{ hover: { bg: | }} />');
        expect(items?.some(item => item.label === 'red-500')).toBe(true);
    });

    it('returns an empty list for a key with no curated values', () => {
        expect(itemsAt('const A = () => <div sz={{ zzz: | }} />')).toEqual([]);
        expect(getValueCompletions('definitely-not-a-key')).toEqual([]);
    });

    it('retargets string items over a lone typed quote', () => {
        const source = "const A = () => <div sz={{ bg: '|";
        const items = itemsAt(source);
        const red = items?.find(item => item.label === 'red-500');
        const range = red?.range as RangeLike;
        const quoteAt = source.indexOf("'|");
        expect(range.start.character).toBe(quoteAt);
        expect(range.end.character).toBe(quoteAt + 1);
        // Numeric items keep their default range — only strings carry quotes.
        const items2 = itemsAt("const A = () => <div sz={{ p: '|");
        const four = items2?.find(item => item.label === '4');
        expect(four?.range).toBeUndefined();
    });

    it('absorbs a typed prefix and the auto-paired closing quote', () => {
        // User typed `'re` and the editor auto-paired the closing quote.
        const source = "const A = () => <div sz={{ bg: 're|'";
        const items = itemsAt(source);
        const red = items?.find(item => item.label === 'red-500');
        const range = red?.range as RangeLike;
        const quoteAt = source.indexOf("'re");
        expect(range.start.character).toBe(quoteAt);
        // Covers 're and the closing quote — cursor marker is not in the doc.
        expect(range.end.character).toBe(quoteAt + 4);
    });

    it('extends the range across word characters after the cursor', () => {
        const source = "const A = () => <div sz={{ bg: 'bl|ack'";
        const items = itemsAt(source);
        const red = items?.find(item => item.label === 'red-500');
        const range = red?.range as RangeLike;
        const quoteAt = source.indexOf("'bl");
        expect(range.start.character).toBe(quoteAt);
        expect(range.end.character).toBe(quoteAt + 7); // 'black' + both quotes
    });

    it('skips retargeting when the value continues on a bare next line', () => {
        // Cursor line holds only word chars — the backward walk exits the
        // line without finding a quote, so items keep their default range.
        const items = itemsAt('const A = () => <div sz={{ bg:\nred|');
        const red = items?.find(item => item.label === 'red-500');
        expect(red).toBeDefined();
        expect(red?.range).toBeUndefined();
    });
});

describe('SzCompletionProvider — outside sz', () => {
    it('serves nothing outside a sz context', () => {
        expect(itemsAt('const x = 1;|')).toBeUndefined();
        expect(itemsAt('const config = { retries: |')).toBeUndefined();
        expect(itemsAt('const A = () => <div sz={{ p: 4 }}>|')).toBeUndefined();
    });
});
