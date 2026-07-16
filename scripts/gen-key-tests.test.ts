import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classTokens, parseSzProp, szObjectLiterals } from './gen-key-tests.mjs';

describe('key-test generator parsing', () => {
    it('splits only top-level commas in class cells', () => {
        assert.deepEqual(classTokens('`grid-cols-[1fr,2fr]`, `p-4`'), [
            'grid-cols-[1fr,2fr]',
            'p-4',
        ]);
        assert.deepEqual(classTokens('translate-[calc(1px,2px)], m-2'), [
            'translate-[calc(1px,2px)]',
            'm-2',
        ]);
    });

    it('parses quoted values and removes only a prose etc suffix', () => {
        assert.deepEqual(parseSzProp("{ color: 'red', content: 'etc' } etc."), {
            color: 'red',
            content: 'etc',
        });
        assert.deepEqual(parseSzProp("{ content: 'etc' }"), { content: 'etc' });
        assert.equal(parseSzProp('{ ... }'), null);
    });

    it('extracts nested top-level sz object literals', () => {
        assert.deepEqual(szObjectLiterals('{ hover: { p: 2 } }, { m: 4 }'), [
            '{ hover: { p: 2 } }',
            '{ m: 4 }',
        ]);
    });
});
