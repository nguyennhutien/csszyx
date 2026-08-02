import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    findNulByteFiles,
    isCheckedTextFile,
    listTrackedTextFiles,
} from './validate-no-nul-bytes.mjs';

test('checks text formats and skips binary-capable extensions', () => {
    assert.equal(isCheckedTextFile('packages/compiler/src/szv-precompile.ts'), true);
    assert.equal(isCheckedTextFile('packages/core/src/transform/parser.rs'), true);
    assert.equal(isCheckedTextFile('docs/specs/snippets/effects.md'), true);
    assert.equal(isCheckedTextFile('assets/logo.png'), false);
    assert.equal(isCheckedTextFile('packages/core/core.node'), false);
    assert.equal(isCheckedTextFile('LICENSE'), false);
});

test('flags only files containing a raw NUL byte, in input order', () => {
    const contents = new Map([
        ['clean.ts', Buffer.from("const SEP = '\\u0000';\n")],
        ['nul.ts', Buffer.from('const SEP = \u0000;\n')],
        ['clean.rs', Buffer.from('const SEP: &str = "\\u{0}";\n')],
        ['nul.md', Buffer.concat([Buffer.from('text '), Buffer.from([0]), Buffer.from(' more')])],
    ]);

    assert.deepEqual(
        findNulByteFiles([...contents.keys()], filePath => contents.get(filePath)),
        ['nul.ts', 'nul.md'],
    );
});

test('lists tracked files filtered to text extensions', t => {
    const temporaryRepository = mkdtempSync(path.join(os.tmpdir(), 'csszyx-nul-'));
    t.after(() => rmSync(temporaryRepository, { recursive: true, force: true }));

    execFileSync('git', ['init', '--quiet'], { cwd: temporaryRepository });
    writeFileSync(path.join(temporaryRepository, 'source.ts'), 'export {};\n');
    writeFileSync(path.join(temporaryRepository, 'binary.bin'), Buffer.from([0, 1, 2]));
    writeFileSync(path.join(temporaryRepository, 'notes.md'), '# notes\n');
    execFileSync('git', ['add', '.'], { cwd: temporaryRepository });

    assert.deepEqual(listTrackedTextFiles(temporaryRepository), ['notes.md', 'source.ts']);
});
