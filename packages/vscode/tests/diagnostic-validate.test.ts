/**
 * validateDocument tests — unknown sz prop keys become warnings with precise
 * ranges; every legal key shape (props, boolean shorthands, variants,
 * arbitrary `[...]` variants, css) stays silent. Companion file to
 * diagnostic-provider.test.ts, which owns the debounce lifecycle; this one
 * needs the diagnostics-ENABLED configuration so it carries its own mock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({ enabled: true }));

vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            get: (_key: string, fallback: boolean) => config.enabled && fallback,
        }),
    },
    DiagnosticSeverity: { Warning: 1 },
    Range: class {
        constructor(
            public start: { line: number; character: number },
            public end: { line: number; character: number },
        ) {}
    },
    Diagnostic: class {
        source?: string;
        code?: unknown;
        constructor(
            public range: unknown,
            public message: string,
            public severity: number,
        ) {}
    },
    Uri: { parse: (value: string) => ({ url: value }) },
    // Pulled in transitively via ./data.js (completion metadata built at import).
    CompletionItem: class {
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
}));

const { validateDocument } = await import('../src/diagnostic-provider.js');

interface Diag {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    message: string;
    severity: number;
    source?: string;
    code?: { value: string; target: { url: string } };
}

/** Run validateDocument over `text` and return the diagnostics it set.
 * @param text - Full document text.
 * @returns Diagnostics written to the collection for this document.
 */
function diagnosticsFor(text: string): Diag[] {
    const lines = text.split('\n');
    const document = {
        uri: { toString: () => 'file:///test.tsx' },
        getText: () => text,
        positionAt: (offset: number) => {
            let remaining = offset;
            for (let line = 0; line < lines.length; line += 1) {
                const length = (lines[line] ?? '').length;
                if (remaining <= length) return { line, character: remaining };
                remaining -= length + 1;
            }
            return { line: lines.length - 1, character: (lines.at(-1) ?? '').length };
        },
    };
    let result: Diag[] = [];
    const collection = {
        set: (_uri: unknown, diags: Diag[]) => {
            result = diags;
        },
    };
    validateDocument(document as never, collection as never);
    return result;
}

beforeEach(() => {
    config.enabled = true;
});

describe('validateDocument — unknown keys', () => {
    it('warns on an unknown key with the docs link and an exact range', () => {
        const text = 'const A = () => <div sz={{ foo: 4, p: 2 }} />;';
        const diags = diagnosticsFor(text);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toBe(
            "Unknown sz prop 'foo'. See https://csszyx.com/docs/sz-props for valid props.",
        );
        expect(diags[0].severity).toBe(1);
        expect(diags[0].source).toBe('csszyx');
        expect(diags[0].code).toBeUndefined();
        expect(diags[0].range.start).toEqual({ line: 0, character: text.indexOf('foo') });
        expect(diags[0].range.end).toEqual({ line: 0, character: text.indexOf('foo') + 3 });
    });

    it('suggests the sz name for a known CSS-property alias and attaches a code', () => {
        const diags = diagnosticsFor(
            "const A = () => <div sz={{ backgroundColor: 'red-500' }} />;",
        );
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toBe("Unknown sz prop 'backgroundColor'. Did you mean 'bg'?");
        expect(diags[0].code?.value).toBe('unknown-prop');
        expect(diags[0].code?.target.url).toBe('https://csszyx.com/docs/migrate');
    });

    it('warns inside the implicit HTML attribute form', () => {
        const text = '<div sz="foo: 4, p: 2">';
        const diags = diagnosticsFor(text);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toContain("Unknown sz prop 'foo'");
        expect(diags[0].range.start.character).toBe(text.indexOf('foo'));
    });

    it('reports each unknown key across multiple sz expressions', () => {
        const diags = diagnosticsFor('<a sz={{ foo: 1 }}></a><b sz="{ bar: 2 }"></b>');
        expect(diags.map(diag => diag.message)).toEqual([
            expect.stringContaining("'foo'"),
            expect.stringContaining("'bar'"),
        ]);
    });

    it('locates an unknown bare key containing regex punctuation', () => {
        const text = 'const A = () => <div sz={{ foo$bar: 4 }} />;';
        const diags = diagnosticsFor(text);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toContain("Unknown sz prop 'foo$bar'");
        expect(diags[0].range.start.character).toBe(text.indexOf('foo$bar'));
    });

    it('skips a key whose spelling cannot be located in the source', () => {
        // '@foo' parses as a valid string key but `\b@foo` never matches
        // (quote→@ is not a word boundary), so no range can be attributed.
        expect(diagnosticsFor("const A = () => <div sz={{ '@foo': 4 }} />;")).toEqual([]);
    });
});

describe('validateDocument — valid documents', () => {
    it('accepts props, shorthands, variants, arbitrary variants, and css', () => {
        const diags = diagnosticsFor(
            'const A = () => <div sz={{ ' +
                "p: 4, blur: true, hover: { bg: 'red-500' }, " +
                "css: { color: 'red' }, '[&:nth-child(2)]': { p: 2 } }} />;",
        );
        expect(diags).toEqual([]);
    });

    it('skips expressions that contain dynamic values', () => {
        expect(diagnosticsFor('const A = () => <div sz={{ foo: someVar }} />;')).toEqual([]);
    });

    it('produces nothing for documents without sz expressions', () => {
        expect(diagnosticsFor('const x = { foo: 1 };')).toEqual([]);
    });
});

describe('validateDocument — configuration gate', () => {
    it('clears diagnostics without validating when disabled', () => {
        config.enabled = false;
        expect(diagnosticsFor('const A = () => <div sz={{ foo: 4 }} />;')).toEqual([]);
    });
});
