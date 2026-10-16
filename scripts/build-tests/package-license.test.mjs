/**
 * Every published package ships the root license; the rules live in
 * `scripts/check-package-license.mjs`.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkLicenses } from '../check-package-license.mjs';

test('every published package ships the root LICENSE', () => {
    const { problems, checked } = checkLicenses();
    assert.ok(checked > 0, 'no published package found under packages/');
    assert.deepEqual(problems, []);
});

test('names a missing and a changed copy, and skips a private package', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'csszyx-license-'));
    try {
        writeFileSync(path.join(root, 'LICENSE'), 'MIT\n');
        const add = (name, manifest, license) => {
            mkdirSync(path.join(root, 'packages', name), { recursive: true });
            writeFileSync(
                path.join(root, 'packages', name, 'package.json'),
                JSON.stringify(manifest),
            );
            if (license !== undefined)
                writeFileSync(path.join(root, 'packages', name, 'LICENSE'), license);
        };
        add('a', { name: 'a' }, 'MIT\n');
        add('b', { name: 'b' });
        add('c', { name: 'c' }, 'Apache\n');
        add('d', { name: 'd', private: true });
        mkdirSync(path.join(root, 'packages', 'e'));
        assert.deepEqual(checkLicenses({ root }), {
            problems: [
                'b: no LICENSE in packages/b',
                'c: packages/c/LICENSE differs from the root LICENSE',
            ],
            checked: 3,
        });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
