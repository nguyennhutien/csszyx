/**
 * A comma-separated `--ignore` value, split into its globs.
 *
 * The comma separates patterns and is also glob syntax: `legacy/{a,b}/**` is one
 * pattern. Splitting on every comma turned it into `legacy/{a` and `b}/**`,
 * which match nothing, so the directories the user named were scanned anyway.
 */
import { describe, expect, it } from 'vitest';

import { splitGlobList } from '../src/glob-list.js';

describe('splitGlobList', () => {
    it.each([
        ['a/**,b/**', ['a/**', 'b/**']],
        ['legacy/{a,b}/**', ['legacy/{a,b}/**']],
        ['legacy/{a,b}/**,other/**', ['legacy/{a,b}/**', 'other/**']],
        ['x/{a,{b,c}}/**,y', ['x/{a,{b,c}}/**', 'y']],
        [' a/** , b/** ', ['a/**', 'b/**']],
        ['a/**,,b/**,', ['a/**', 'b/**']],
        ['**/*.{test,spec}.tsx', ['**/*.{test,spec}.tsx']],
        ['x/[a,b]/**,y', ['x/[a,b]/**', 'y']],
        ['+(a,b)/**,y', ['+(a,b)/**', 'y']],
        ['x/{a,[b,c]}/**', ['x/{a,[b,c]}/**']],
    ])('%s', (value, expected) => {
        expect(splitGlobList(value)).toEqual(expected);
    });

    it('splits on a comma after a brace that never closes, rather than swallow the rest', () => {
        expect(splitGlobList('odd{name,other/**')).toEqual(['odd{name', 'other/**']);
    });

    it('does not pair a bracket with a brace', () => {
        expect(splitGlobList('odd{name],other/**')).toEqual(['odd{name]', 'other/**']);
    });

    it('uses forward slashes, which both readers of the list expect', () => {
        expect(splitGlobList(String.raw`legacy\**`)).toEqual(['legacy/**']);
    });

    it('does not let a stray closing brace hide the commas after it', () => {
        expect(splitGlobList('odd}name,other/**')).toEqual(['odd}name', 'other/**']);
    });

    it('reads a repeated flag, which the parser hands over as an array', () => {
        expect(splitGlobList(['a/{x,y}/**', 'b/**,c/**'])).toEqual(['a/{x,y}/**', 'b/**', 'c/**']);
    });

    it('answers undefined when the option was not given', () => {
        expect(splitGlobList(undefined)).toBeUndefined();
        expect(splitGlobList('')).toBeUndefined();
    });
});
