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

function validate(message, ...flags) {
    const fixture = path.join(fixtureDirectory, 'COMMIT_EDITMSG');
    writeFileSync(fixture, message);

    return spawnSync(
        process.execPath,
        ['scripts/validate-commit-message-policy.mjs', fixture, ...flags],
        { cwd: root, encoding: 'utf8' },
    );
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

test('rejects a bare <placeholder> in the header', () => {
    const result = validate('docs: require the @scope/pkg-<platform> package');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /code span/);
});

test('rejects a bare <placeholder> in the BREAKING CHANGE footer', () => {
    const result = validate(
        'feat!: drop the fallback\n\nWhy.\n\nBREAKING CHANGE: migrate needs @scope/pkg-<platform>\nfor the host.',
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /code span/);
});

test('accepts <placeholder> inside a code span and in the body', () => {
    const result = validate(
        'docs: require the `@scope/pkg-<platform>` package\n\nThe body may say Props<T> in plain text.\n\nBREAKING CHANGE: `csszyx migrate <path>` needs it.',
    );

    assert.equal(result.status, 0, result.stderr);
});

test('rejects a breaking marker with nothing saying what breaks', () => {
    // release-please copies the subject into the changelog's breaking section
    // whether or not a footer exists, so a commit like this ships a heading
    // that describes the work and never tells a reader what to change.
    const result = validate('feat!: drop the fallback\n\nWhy it went.');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /BREAKING CHANGE/);
});

test('accepts a breaking marker carrying its footer', () => {
    const result = validate(
        'feat!: drop the fallback\n\nWhy it went.\n\nBREAKING CHANGE: call `transform` directly.',
    );

    assert.equal(result.status, 0, result.stderr);
});

test('accepts the hyphenated spelling of the footer', () => {
    const result = validate(
        'fix!: drop the fallback\n\nWhy it went.\n\nBREAKING-CHANGE: call `transform` directly.',
    );

    assert.equal(result.status, 0, result.stderr);
});

test('leaves a non-breaking commit alone', () => {
    const result = validate('fix: keep the fallback\n\nWhy it stayed.');

    assert.equal(result.status, 0, result.stderr);
});

test('checks a pull request title without demanding a body it cannot have', () => {
    // The title becomes the squash subject release-please parses, and a title
    // has no footer to carry: the explanation lives in the commits below it.
    const result = validate('feat!: drop the fallback', '--subject-only');

    assert.equal(result.status, 0, result.stderr);
});

test('still rejects a malformed pull request title', () => {
    const result = validate('Drop the fallback', '--subject-only');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /<type>/);
});

test('still rejects a bare placeholder in a pull request title', () => {
    const result = validate('fix: repair @scope/pkg-<platform>', '--subject-only');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /code span/);
});
