/**
 * SzHoverProvider tests — hovering a sz expression shows the classes the
 * compiler would generate. The main path runs the REAL browser transform
 * (`@csszyx/compiler/browser`), so these assertions lock actual sz→Tailwind
 * output. The transform never throws on literal input, so the throw-recovery
 * path is exercised through a scoped transform override: the provider's
 * contract is the transform's TYPE, and it must recover for any legal result.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const transformOverride = vi.hoisted(() => ({
    fn: null as null | ((obj: object) => { className: string }),
}));

vi.mock('@csszyx/compiler/browser', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler/browser')>();
    return {
        ...actual,
        transform: (obj: never) =>
            transformOverride.fn ? transformOverride.fn(obj) : actual.transform(obj),
    };
});

vi.mock('vscode', () => ({
    Hover: class {
        constructor(public contents: unknown) {}
    },
    MarkdownString: class {
        isTrusted = false;
        constructor(public value: string = '') {}
        appendMarkdown(text: string): void {
            this.value += text;
        }
        appendCodeblock(text: string, language?: string): void {
            this.value += `\n\`\`\`${language ?? ''}\n${text}\n\`\`\`\n`;
        }
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

const { SzHoverProvider } = await import('../src/hover-provider.js');

interface FakePosition {
    line: number;
    character: number;
}

/** Build the minimal TextDocument surface the hover provider reads.
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
        lineCount: lines.length,
        lineAt: (line: number) => ({ text: lines[line] ?? '' }),
        offsetAt: offsetOf,
        positionAt: positionOf,
        getText: (range: { start: FakePosition; end: FakePosition }) =>
            text.slice(offsetOf(range.start), offsetOf(range.end)),
    };
    return { document: document as never, position: positionOf(cursor) as never };
}

const provider = new SzHoverProvider();

const hoverAt = (source: string) => {
    const { document, position } = documentAt(source);
    return provider.provideHover(document, position);
};

/** Read the markdown text out of a produced hover.
 * @param hover - Provider result.
 * @returns The accumulated markdown value.
 */
function markdownOf(hover: { contents: unknown } | undefined): string {
    return (hover?.contents as { value: string }).value;
}

afterEach(() => {
    transformOverride.fn = null;
});

describe('SzHoverProvider — real transform output', () => {
    it('shows the generated classes for a JSX sz object', () => {
        const hover = hoverAt("const A = () => <div sz={{ p|: 4, bg: 'red-500' }} />");
        const md = markdownOf(hover);
        expect(md).toContain('**CSSzyx** → generated classes:');
        expect(md).toContain('p-4 bg-red-500');
        expect((hover?.contents as { isTrusted: boolean }).isTrusted).toBe(true);
    });

    it('resolves variants through the real compiler', () => {
        const md = markdownOf(
            hoverAt("const A = () => <div sz={{ hover: { bg|: 'red-500' } }} />"),
        );
        expect(md).toContain('hover:bg-red-500');
    });

    it('shows classes for the implicit HTML attribute form', () => {
        const md = markdownOf(hoverAt('<div sz="bg: \'red-500\'|, p: 4">'));
        expect(md).toContain('bg-red-500 p-4');
    });

    it('spans a multi-line sz object around the cursor window', () => {
        const source = [
            'const A = () => (',
            '    <div sz={{',
            '        p: 4,',
            "        bg: 'red|-500',",
            '    }} />',
            ');',
        ].join('\n');
        expect(markdownOf(hoverAt(source))).toContain('p-4 bg-red-500');
    });

    it('renders (empty) when the object produces no classes', () => {
        expect(markdownOf(hoverAt('const A = () => <div sz={{ | }} />'))).toContain('(empty)');
    });
});

describe('SzHoverProvider — silent fallbacks', () => {
    it('returns undefined outside a sz context', () => {
        expect(hoverAt('const x| = 1;')).toBeUndefined();
        expect(hoverAt('<div className="p-4|">')).toBeUndefined();
    });

    it('returns undefined when no complete object encloses the cursor', () => {
        // Open expression, never closed: context says "in sz" but there is
        // no brace-balanced object to extract.
        expect(hoverAt('const A = () => <div sz={{ p|: 4')).toBeUndefined();
    });

    it('returns undefined for objects with dynamic values', () => {
        expect(hoverAt('const A = () => <div sz={{ p|: someVar }} />')).toBeUndefined();
    });

    it('returns undefined for pathologically long objects', () => {
        const filler = `'${'a'.repeat(1100)}'`;
        expect(hoverAt(`const A = () => <div sz={{ p|: 4, css: ${filler} }} />`)).toBeUndefined();
    });
});

describe('SzHoverProvider — transform result contract', () => {
    it('returns undefined when the transform throws', () => {
        transformOverride.fn = () => {
            throw new Error('boom');
        };
        expect(hoverAt('const A = () => <div sz={{ p|: 4 }} />')).toBeUndefined();
    });
});
