import { describe, expect, it } from 'vitest';

import { parseSzObjectEntries } from './parse-sz-object.js';

describe('parseSzObjectEntries', () => {
    it('parses scalar, quoted, and boolean values in source order', () => {
        expect(parseSzObjectEntries(`p: 4, color: 'red-500', disabled: true`)).toEqual([
            { key: 'p', val: '4' },
            { key: 'color', val: "'red-500'" },
            { key: 'disabled', val: 'true' },
        ]);
    });

    it('keeps nested objects intact for recursive token rendering', () => {
        expect(
            parseSzObjectEntries(`hover: { bg: 'red-500', color: 'white' }, p: 4`),
        ).toEqual([
            { key: 'hover', val: `{ bg: 'red-500', color: 'white' }` },
            { key: 'p', val: '4' },
        ]);
    });

    it('keeps commas inside quoted strings and ignores bare keys', () => {
        expect(parseSzObjectEntries(`content: 'hello, world', p: 2`)).toEqual([
            { key: 'content', val: "'hello, world'" },
            { key: 'p', val: '2' },
        ]);
        expect(parseSzObjectEntries('nowrap')).toEqual([]);
    });
});
