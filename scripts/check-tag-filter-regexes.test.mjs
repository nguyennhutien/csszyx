import assert from 'node:assert/strict';
import test from 'node:test';

import { findingsInSource } from './check-tag-filter-regexes.mjs';

/**
 * A regex literal, built so this file holds none: the check also reads its
 * own tests when they change, and a fixture written as a literal would be a
 * finding of its own.
 *
 * @param {string} body - The pattern.
 * @param {string} [flags] - The flags.
 * @returns {string} The literal as source text.
 */
const re = (body, flags = '') => `/${body}/${flags}`;

const lines = source => findingsInSource(source, 'f.ts').map(finding => finding.line);

test('a tag filter without the `i` flag is reported', () => {
    assert.deepEqual(lines(`const r = ${re('<script>')};`), [1]);
});

test('a close tag inside a string is not a regex', () => {
    assert.deepEqual(lines("const html = '</script><script>bad()</script>';"), []);
});

test('a real regex after a close tag in a string on the same line is still read', () => {
    assert.deepEqual(lines(`check('</a>'); const r = ${re('<script>')};`), [1]);
});

test('a sound filter passes', () => {
    const sound = `const open = ${re('<script', 'i')}; const close = ${re('<\\/script[^>]*>', 'i')};`;
    assert.deepEqual(lines(sound), []);
});

test('a close tag that allows only whitespace before `>` is reported', () => {
    assert.deepEqual(lines(`const r = ${re('<\\/script\\s*>', 'i')};`), [1]);
});
