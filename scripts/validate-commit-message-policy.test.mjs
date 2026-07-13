import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'csszyx-commit-policy-'));

after(() => rmSync(fixtureDirectory, { force: true, recursive: true }));

function validate(message) {
    const fixture = path.join(fixtureDirectory, 'COMMIT_EDITMSG');
    writeFileSync(fixture, message);

    return spawnSync(process.execPath, ['scripts/validate-commit-message-policy.mjs', fixture], {
        cwd: root,
        encoding: 'utf8',
    });
}

test('accepts separate balanced parentheses', () => {
    const result = validate(
        'ci: keep release commits parseable\n\nExplain foo() and bar() separately.',
    );

    assert.equal(result.status, 0, result.stderr);
});

test('rejects unbalanced parentheses', () => {
    const result = validate('ci: keep release commits parseable\n\nExplain foo(.');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /unbalanced parentheses/);
});

test('rejects balanced nested parentheses', () => {
    const result = validate(
        'ci: keep release commits parseable\n\nExplain calc(value * var(--spacing)).',
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /nested parentheses/);
});
