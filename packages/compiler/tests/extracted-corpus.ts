import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseSync } from 'oxc-parser';

type OxcNode = Record<string, unknown>;

export interface ExtractedSnippet {
    file: string;
    index: number;
    source: string;
}

export function extractCorpusSnippets(): ExtractedSnippet[] {
    const testsDir = path.resolve(__dirname);
    const snippets: ExtractedSnippet[] = [];

    for (const file of fs.readdirSync(testsDir).sort()) {
        // Branch-coverage files are not curated parity-corpus entries. Excluding
        // them keeps this signal stable as coverage-oriented cases are added.
        if (
            !file.endsWith('.test.ts') ||
            file.startsWith('oxc-') ||
            file.includes('branch-coverage')
        ) {
            continue;
        }

        const content = fs.readFileSync(path.join(testsDir, file), 'utf-8');
        const sources = [
            ...extractDeclaredSources(content),
            ...extractMarkedParameterizedSources(content),
        ];
        for (const source of sources) {
            if (/\bsz(?:Recover)?\s*=/.test(source)) {
                snippets.push({ file, index: snippets.length, source });
            }
        }
    }

    return snippets;
}

function extractDeclaredSources(content: string): string[] {
    const declaration = /const\s+(?:source|src)\s*=\s*(['"`])([\s\S]*?)\1\s*;/g;
    return decodeMatches(content.matchAll(declaration), 1, 2);
}

function extractMarkedParameterizedSources(content: string): string[] {
    const table =
        /\/\/ @extracted-corpus-source-column[^\S\r\n]*\r?\n[^\S\r\n]*it\.each\(\[([\s\S]*?)\]\)[^\S\r\n]*\(/g;
    const sources: string[] = [];

    for (const tableMatch of content.matchAll(table)) {
        const literal = /(['"`])([\s\S]*?)\1/g;
        sources.push(...decodeMatches(tableMatch[1].matchAll(literal), 1, 2));
    }

    return sources;
}

function decodeMatches(
    matches: IterableIterator<RegExpMatchArray>,
    quoteIndex: number,
    rawIndex: number,
): string[] {
    const decoded: string[] = [];
    for (const match of matches) {
        const source = decodeLiteral(match[quoteIndex], match[rawIndex]);
        if (source) decoded.push(source);
    }
    return decoded;
}

function decodeLiteral(quote: string, raw: string): string | null {
    if (quote === '`') return raw.includes('${') ? null : raw;

    try {
        const parsed = parseSync('corpus-literal.js', `const value=${quote}${raw}${quote}`);
        if (parsed.errors.length > 0) return null;
        const body = (parsed.program as unknown as OxcNode).body as OxcNode[];
        const declaration = (body[0].declarations as OxcNode[])[0];
        const literal = declaration.init as OxcNode | undefined;
        return literal?.type === 'Literal' && typeof literal.value === 'string'
            ? literal.value
            : null;
    } catch {
        return null;
    }
}
