import assert from 'node:assert/strict';
import test from 'node:test';

import { findingsInSource } from './check-tag-filter-regexes.mjs';

const lines = source => findingsInSource(source, 'f.ts').map(finding => finding.line);

test('a tag filter without the `i` flag is reported', () => {
    assert.deepEqual(lines('const r = /<script>/;'), [1]);
});

test('a close tag inside a string is not a regex', () => {
    assert.deepEqual(lines("const html = '</script><script>bad()</script>';"), []);
});

test('a real regex after a close tag in a string on the same line is still read', () => {
    assert.deepEqual(lines("check('</a>'); const r = /<script>/;"), [1]);
});

test('a sound filter passes', () => {
    assert.deepEqual(lines('const open = /<script/i; const close = /<\\/script[^>]*>/i;'), []);
});

test('a close tag that allows only whitespace before `>` is reported', () => {
    assert.deepEqual(lines('const r = /<\\/script\\s*>/i;'), [1]);
});
