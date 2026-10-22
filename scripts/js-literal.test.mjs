import assert from 'node:assert/strict';
import { test } from 'node:test';

import { jsLiteral } from './js-literal.mjs';

/** Every character the literal escapes, inside the shapes a test writes. */
const VALUE = {
    key: 'w',
    value: '1/2',
    markup: '</script><p>',
    lines: 'a\u2028b\u2029c',
    quote: 'say "hi" \\ there',
};

test('a literal parses back to the value it was written from', () => {
    // Every escape it writes is JSON as well, so JSON reads it as a parser does.
    assert.deepEqual(JSON.parse(jsLiteral(VALUE)), VALUE);
});

test('a literal carries none of the characters that end its context', () => {
    assert.doesNotMatch(jsLiteral(VALUE), /[<>/\u2028\u2029]/);
    assert.equal(jsLiteral('</x>'), '"\\u003C\\u002Fx\\u003E"');
});
