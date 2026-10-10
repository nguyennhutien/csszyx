/**
 * Every engine diagnostic carries a code and a position.
 *
 * The rendered text is for people. A gate, a config rule or an editor needs to
 * know which kind of problem a line reports and where, and reading either back
 * out of the English breaks the day a message is reworded. So the engine hands
 * both over beside the text: `issues[i]` describes `diagnostics[i]`.
 *
 * Each source below is diagnosed by both engine artifacts; the code is what the
 * engine says, not what a text matcher guesses.
 */
import { describe, expect, it } from 'vitest';

import { SZ_DIAGNOSTIC_CODES } from '../src/index.js';
import { CODE_SOURCES } from './diagnostic-code-sources.js';
import { ENGINES } from './engine-parity-harness.js';

/**
 * The 1-based line and UTF-16 column of an index into a source string.
 *
 * @param source - The module.
 * @param index - A UTF-16 index into it.
 * @returns Where the index sits.
 */
function positionOf(source: string, index: number): { line: number; column: number } {
    const before = source.slice(0, index).split('\n');
    return { line: before.length, column: (before.at(-1) ?? '').length + 1 };
}

describe('SZ_DIAGNOSTIC_CODES', () => {
    it('has an engine-diagnosed source for every code', () => {
        expect(CODE_SOURCES.map(([code]) => code).sort()).toEqual([...SZ_DIAGNOSTIC_CODES].sort());
    });
});

describe.each(ENGINES)('engine diagnostic codes — %s', (_name, transform) => {
    it.each(CODE_SOURCES)('codes %s beside the text it renders', (code, source, options) => {
        const result = transform(source, '/p/src/A.tsx', options);
        const diagnostics = result.diagnostics ?? [];

        expect(result.issues).toHaveLength(diagnostics.length);
        expect(result.issues?.map(issue => issue.code)).toContain(code);
        for (const issue of result.issues ?? []) {
            expect(SZ_DIAGNOSTIC_CODES).toContain(issue.code);
        }
    });

    it('places an issue where its key is written, counting columns in UTF-16', () => {
        const source = [
            '// é😀 above',
            'export const A = () => <div',
            "    sz={{ /* é😀 */ xyzzy: 4, display: 'bogus' }} />;",
        ].join('\n');
        const result = transform(source, '/p/src/A.tsx');

        // As plain data: the position is an accessor, which `toEqual` does not read.
        expect(JSON.parse(JSON.stringify(result.issues))).toEqual([
            { code: 'unknown-key', ...positionOf(source, source.indexOf('xyzzy')) },
            { code: 'closed-enum-value', ...positionOf(source, source.indexOf('display')) },
        ]);
    });

    it('places a diagnostic about the whole file at its start', () => {
        const result = transform(
            CODE_SOURCES.find(([code]) => code === 'nesting-depth')?.[1] ?? '',
            '/p/src/A.tsx',
        );

        expect(JSON.parse(JSON.stringify(result.issues))).toEqual([
            { code: 'nesting-depth', line: 1, column: 1 },
        ]);
    });

    it('reports no issue for a clean file', () => {
        const result = transform('export const A = () => <div sz={{ p: 4 }} />;', '/p/src/A.tsx');

        expect(result.issues).toEqual([]);
    });
});
