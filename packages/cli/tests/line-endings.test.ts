import { describe, expect, it } from 'vitest';

import { detectLineEnding, withLineEnding } from '../src/utils/line-endings.js';

describe('inserted text follows the source line endings', () => {
    it.each([
        ['', '\n'],
        ['one line', '\n'],
        ['\nfirst blank', '\n'],
        ['a\nb', '\n'],
        ['a\r\nb', '\r\n'],
        ['a\r\nb\nc', '\r\n'],
        ['a\nb\r\nc', '\n'],
    ] as const)('detects the first break in %j', (source, expected) => {
        expect(detectLineEnding(source)).toBe(expected);
    });

    it('converts only bare newlines and is idempotent', () => {
        const mixed = 'a\nb\r\nc\n';
        expect(withLineEnding(mixed, '\n')).toBe(mixed);
        const result = withLineEnding(mixed, '\r\n');
        expect(result).toBe('a\r\nb\r\nc\r\n');
        expect(withLineEnding(result, '\r\n')).toBe(result);
        expect(withLineEnding('one line', '\r\n')).toBe('one line');
    });
});
