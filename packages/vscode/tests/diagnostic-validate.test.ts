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
const { KNOWN_SPECIAL_PROPERTIES, MIGRATION_NOTES, SUGGESTION_MAP } = await import(
    '../src/data.js'
);
const { REMOVED_BOOLEAN_SUGAR, REPLACED_KEYS } = await import('@csszyx/compiler/browser');
const { renderSzDiagnosticParts, SZ_DIAGNOSTIC_COMPUTED_VALUES } = await import('@csszyx/compiler');
const { transformSource } = await import('@csszyx/compiler/engine');

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
    it('explains removed shape keys through their migration note', () => {
        const [diagnostic] = diagnosticsFor("const A = () => <div sz={{ maskVia: 'red' }} />;");
        expect(diagnostic?.message).toBe(
            `\`maskVia\` was removed, and nothing is emitted for it.\nhelp: ${MIGRATION_NOTES.maskVia}.`,
        );
        expect(diagnostic?.code).toEqual({
            value: 'removed-key',
            target: { url: 'https://csszyx.com/e/removed-key' },
        });
    });

    it('names a flag that joined a group under a new name, with what to write', () => {
        const key = [...REPLACED_KEYS].find(
            candidate => SUGGESTION_MAP[candidate] !== undefined && !MIGRATION_NOTES[candidate],
        ) as string;
        const [diagnostic] = diagnosticsFor(`const A = () => <div sz={{ ${key}: true }} />;`);
        expect(diagnostic?.message).toBe(
            `\`${key}\` was replaced, and nothing is emitted for it.\n` +
                `help: write \`{ ${SUGGESTION_MAP[key]}: true }\` instead, or run \`csszyx migrate\`.`,
        );
        expect(diagnostic?.code?.value).toBe('removed-key');
    });

    it('names a numeric key as the engine does', () => {
        const [diagnostic] = diagnosticsFor("const A = () => <div sz={{ 0: 'p-4' }} />;");
        expect(diagnostic?.code?.value).toBe('numeric-key');
        expect(diagnostic?.message).toMatch(
            /^`sz` received a numeric key `0`, and its value is ignored\.\nhelp: /,
        );
    });

    it('accepts every parametric variant, which took a nested key not a value', () => {
        // `group`, `peer`, `data`, `aria`, `has`, `not` and `supports` live in
        // SPECIAL_VARIANTS rather than KNOWN_VARIANTS because the compiler
        // resolves them by descending into the nested key. Validating top-level
        // keys against KNOWN_VARIANTS alone reported all seven as unknown props
        // — including `group: { hover: … }`, which the front page documents.
        for (const source of [
            "const A = () => <div sz={{ group: { hover: { color: 'white' } } }} />;",
            "const A = () => <div sz={{ peer: { checked: { bg: 'blue-500' } } }} />;",
            "const A = () => <div sz={{ data: { active: { bg: 'blue-500' } } }} />;",
            "const A = () => <div sz={{ aria: { expanded: { color: 'blue-600' } } }} />;",
            'const A = () => <div sz={{ has: { focus: { ring: 2 } } }} />;',
            'const A = () => <div sz={{ not: { first: { mt: 4 } } }} />;',
            "const A = () => <div sz={{ supports: { grid: { display: 'grid' } } }} />;",
        ]) {
            expect(diagnosticsFor(source), source).toEqual([]);
        }
    });

    it('accepts canonical properties lowered by dedicated compiler branches', () => {
        const entries = KNOWN_SPECIAL_PROPERTIES.map(key => `${key}: 'test'`).join(', ');
        expect(diagnosticsFor(`const A = () => <div sz={{ ${entries} }} />;`)).toEqual([]);
    });

    it('warns on an unknown key with the docs link and an exact range', () => {
        const text = 'const A = () => <div sz={{ foo: 4, p: 2 }} />;';
        const diags = diagnosticsFor(text);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toBe(
            '`foo` is not an sz property.\n' +
                "help: check the spelling; for a custom utility, define it with Tailwind's `@utility`.\n" +
                'note: the class is still emitted, and it styles nothing unless Tailwind serves that utility.',
        );
        expect(diags[0].severity).toBe(1);
        expect(diags[0].source).toBe('csszyx');
        expect(diags[0].code).toEqual({
            value: 'unknown-key',
            target: { url: 'https://csszyx.com/e/unknown-key' },
        });
        expect(diags[0].range.start).toEqual({ line: 0, character: text.indexOf('foo') });
        expect(diags[0].range.end).toEqual({ line: 0, character: text.indexOf('foo') + 3 });
    });

    it('names a known CSS-property alias by its canonical key, with the code its page has', () => {
        const diags = diagnosticsFor(
            "const A = () => <div sz={{ backgroundColor: 'red-500' }} />;",
        );
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toBe(
            '`backgroundColor` is an alias of `bg`, and nothing is emitted for it.\nhelp: write `bg`.',
        );
        expect(diags[0].code?.value).toBe('canonical-key');
        expect(diags[0].code?.target.url).toBe('https://csszyx.com/e/canonical-key');
    });

    it('names the keys a split shorthand is written with, as the build does', () => {
        const diags = diagnosticsFor(
            "const A = () => <div sz={{ font: 'bold', scrollbarColor: 'red-500' }} />;",
        );
        expect(diags.map(diag => [diag.code?.value, diag.message])).toEqual([
            [
                'canonical-key',
                '`font` is not an sz key, and nothing is emitted for it.\nhelp: write `weight` for the font weight, or `fontFamily` for the font family.',
            ],
            [
                'canonical-key',
                '`scrollbarColor` is not an sz key, and nothing is emitted for it.\nhelp: write `scrollbarThumb` for the thumb colour, or `scrollbarTrack` for the track colour.',
            ],
        ]);
    });

    it('suggests the key a typo most likely means, as the build does', () => {
        const [diagnostic] = diagnosticsFor("const A = () => <div sz={{ wordBrak: 'all' }} />;");
        expect(diagnostic?.message).toContain('help: write `');
        expect(diagnostic?.message).toContain('` if you meant it;');
    });

    it('warns inside the implicit HTML attribute form', () => {
        const text = '<div sz="foo: 4, p: 2">';
        const diags = diagnosticsFor(text);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toContain('`foo` is not an sz property.');
        expect(diags[0].range.start.character).toBe(text.indexOf('foo'));
    });

    it('reports each unknown key across multiple sz expressions', () => {
        const diags = diagnosticsFor('<a sz={{ foo: 1 }}></a><b sz="{ bar: 2 }"></b>');
        expect(diags.map(diag => diag.message)).toEqual([
            expect.stringContaining('`foo`'),
            expect.stringContaining('`bar`'),
        ]);
    });

    it('locates an unknown bare key containing regex punctuation', () => {
        const text = 'const A = () => <div sz={{ foo$bar: 4 }} />;';
        const diags = diagnosticsFor(text);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toContain('`foo$bar` is not an sz property.');
        expect(diags[0].range.start.character).toBe(text.indexOf('foo$bar'));
    });

    it('skips a key whose spelling cannot be located in the source', () => {
        // '@foo' parses as a valid string key but `\b@foo` never matches
        // (quote→@ is not a word boundary), so no range can be attributed.
        expect(diagnosticsFor("const A = () => <div sz={{ '@foo': 4 }} />;")).toEqual([]);
    });
});

/**
 * The build's verdict on one sz object, as the editor prints it: the engine's
 * code, its page, and its sentence with the `help:` and `note:` lines.
 *
 * @param source - A component whose sz object holds one key.
 * @returns One entry per issue the engine reports.
 */
function buildVerdict(source: string): Array<{ code: string; url: string; message: string }> {
    const { issues = [] } = transformSource(source, { filename: 'differential.tsx' });
    return issues.map(issue => {
        const { text, help, note, docs } = renderSzDiagnosticParts(
            issue,
            SZ_DIAGNOSTIC_COMPUTED_VALUES,
        );
        const lines = [text];
        if (help !== undefined) lines.push(`help: ${help}`);
        if (note !== undefined) lines.push(`note: ${note}`);
        return { code: issue.code, url: docs, message: lines.join('\n') };
    });
}

describe('validateDocument — removed boolean sugar, against the engine', () => {
    it.each(Object.keys(REMOVED_BOOLEAN_SUGAR))(
        '`%s: true` gets the code and words the build gives it',
        key => {
            const source = `const A = () => <div sz={{ ${key}: true }} />;`;
            const editor = diagnosticsFor(source).map(diagnostic => ({
                code: diagnostic.code?.value,
                url: diagnostic.code?.target.url,
                message: diagnostic.message,
            }));
            expect(editor).toEqual(buildVerdict(source));
            expect(editor).toHaveLength(1);
        },
    );

    it('leaves a sugar key with a value other than `true` to its property', () => {
        // `flex: 1` is the flex property, not removed sugar; the engine is silent.
        const source = 'const A = () => <div sz={{ flex: 1 }} />;';
        expect(diagnosticsFor(source)).toEqual([]);
        expect(buildVerdict(source)).toEqual([]);
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
