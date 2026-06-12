import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CODE_RELEVANT_FIELDS, isCodeRelevantChange } from './detect-pkg-code-changes.mjs';

test('metadata-only edits are not code-relevant', () => {
    const base = { name: 'x', version: '0.9.8', dependencies: { a: '^1' } };
    const head = {
        name: 'x',
        version: '0.9.9',
        description: 'now described',
        repository: { type: 'git', url: 'git+https://example.com/x.git' },
        engines: { node: '>=22' },
        files: ['dist'],
        dependencies: { a: '^1' },
    };
    assert.equal(isCodeRelevantChange(base, head), false);
});

test('a dependency change is code-relevant', () => {
    const base = { dependencies: { a: '^1' } };
    const head = { dependencies: { a: '^2' } };
    assert.equal(isCodeRelevantChange(base, head), true);
});

test('an exports/main/scripts/bin change is code-relevant', () => {
    assert.equal(
        isCodeRelevantChange({ main: './a.js' }, { main: './b.js' }),
        true,
    );
    assert.equal(
        isCodeRelevantChange({ exports: { '.': './a.js' } }, { exports: { '.': './b.js' } }),
        true,
    );
    assert.equal(
        isCodeRelevantChange({ scripts: { build: 'a' } }, { scripts: { build: 'b' } }),
        true,
    );
    assert.equal(isCodeRelevantChange({}, { bin: { cli: './c.js' } }), true);
});

test('a pnpm.overrides change is code-relevant', () => {
    const base = { pnpm: { overrides: { lodash: '^4.18.0' } } };
    const head = { pnpm: { overrides: { lodash: '^4.18.1' } } };
    assert.equal(isCodeRelevantChange(base, head), true);
});

test('add or delete is always code-relevant', () => {
    assert.equal(isCodeRelevantChange(null, { name: 'new' }), true);
    assert.equal(isCodeRelevantChange({ name: 'gone' }, null), true);
});

test('field ordering and untouched non-code fields do not matter', () => {
    const base = { version: '1', dependencies: { a: '^1', b: '^2' } };
    const head = { dependencies: { b: '^2', a: '^1' }, version: '2', keywords: ['x'] };
    assert.equal(isCodeRelevantChange(base, head), false);
});

test('the field list covers the structural build inputs', () => {
    for (const field of ['dependencies', 'exports', 'main', 'scripts', 'bin', 'sideEffects', 'pnpm']) {
        assert.ok(CODE_RELEVANT_FIELDS.includes(field), `${field} should be tracked`);
    }
    // Metadata fields must NOT be tracked.
    for (const field of ['version', 'repository', 'engines', 'description', 'files']) {
        assert.ok(!CODE_RELEVANT_FIELDS.includes(field), `${field} should be ignored`);
    }
});
