// The two generated-table scripts trust this module for every value they read,
// so the cases below are the ones a regex reader got wrong: a declaration whose
// type annotation moved, and a quoted word inside a comment.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readTableSource } from './extract-ts-tables.mjs';

/**
 * Write a source file to a temp dir and open it.
 *
 * @param name - File name, its extension deciding TS vs TSX.
 * @param source - The file contents.
 * @returns Extractors bound to the written file.
 */
function open(name, source) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'csszyx-extract-'));
    const file = path.join(dir, name);
    writeFileSync(file, source);
    test.after(() => rmSync(dir, { force: true, recursive: true }));
    return readTableSource(file);
}

test('reads an object table however its type is declared', () => {
    // The annotated and inferred forms are one identifier to this reader; to a
    // pattern they are two shapes, and the wrong one matches nothing.
    for (const declaration of [
        "const MAP: Record<string, string> = { bg: 'bg' };",
        "const MAP = { bg: 'bg' };",
        "const MAP = { bg: 'bg' } as const;",
    ]) {
        assert.deepEqual(open('t.ts', declaration).stringObject('MAP'), [['bg', 'bg']]);
    }
});

test('unwraps a type-locked literal', () => {
    const source = 'const VOCAB = { border: true, ring: true } as const satisfies SzProps;';

    assert.deepEqual(open('t.ts', source).objectKeys('VOCAB'), ['border', 'ring']);
});

test('ignores quoted words outside the table', () => {
    // A regex over the declaration's text range read the prose too, so a
    // sentence naming a key added a member nobody declared.
    const source = [
        '// Not \'textAlign\', and not "display" either.',
        'const KEYS: ReadonlySet<string> = new Set([',
        "    'bgSize', // 'display' is a comment, not a member",
        ']);',
    ].join('\n');

    assert.deepEqual(open('t.ts', source).stringSet('KEYS'), ['bgSize']);
});

test('returns the value of a string, not its source text', () => {
    const source = String.raw`const MAP = { quote: 'it\'s' };`;

    assert.deepEqual(open('t.ts', source).stringObject('MAP'), [['quote', "it's"]]);
});

test('reads a grouped key map out of a TSX component', () => {
    const source = [
        "export const GROUPS = { layout: ['display'], typography: ['text', 'textAlign'] } as const;",
        'export function Note() {',
        '    return <p>{GROUPS.layout}</p>;',
        '}',
    ].join('\n');

    assert.deepEqual(open('t.tsx', source).stringArrayRecord('GROUPS'), {
        layout: ['display'],
        typography: ['text', 'textAlign'],
    });
});

test('names the table it cannot find rather than returning nothing', () => {
    const source = open('t.ts', "const OTHER = { bg: 'bg' };");

    assert.throws(() => source.stringObject('MISSING'), /Could not find MISSING in t\.ts/);
});

test('rejects a table whose shape is not the one asked for', () => {
    const source = open('t.ts', "const MAP = { bg: 'bg' };");

    assert.throws(() => source.stringSet('MAP'), /must be new Set/);
    assert.throws(() => source.stringArrayRecord('MAP'), /other than an array literal/);
});

test('rejects a computed value a generated table cannot carry', () => {
    const source = open('t.ts', 'const MAP = { bg: prefix + suffix };');

    assert.throws(() => source.stringObject('MAP'), /expected a string literal/);
});
