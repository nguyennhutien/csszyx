/**
 * `collectAuthoredClassNames` reads a source in work linear in its length.
 *
 * A file of generated data holds tens of thousands of string literals and no
 * class sink. Each literal is a candidate key, and a search for its escapes
 * that ran on past its closing quote read the rest of the file once per
 * literal: 80,000 literals took half a second where they had taken 4 ms. The
 * fuzz test pins what the scan finds, not what it costs, so this counts the
 * characters the scan's `indexOf` searches pass over, a number that does not
 * depend on the machine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectAuthoredClassNames } from '../src/authored-class-scanner.js';

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Characters `indexOf` searches pass over while the scan reads `source`.
 *
 * @param source - The text to scan.
 * @returns The sum, over every search of `source`, of the text from where it
 * starts to the end.
 */
function searchedCharacters(source: string): number {
    const indexOf = String.prototype.indexOf;
    let searched = 0;
    vi.spyOn(String.prototype, 'indexOf').mockImplementation(function (
        this: string,
        needle: string,
        from?: number,
    ) {
        if (this === source) searched += source.length - Math.max(0, from ?? 0);
        return indexOf.call(this, needle, from);
    });
    collectAuthoredClassNames(source);
    vi.restoreAllMocks();
    return searched;
}

describe('collectAuthoredClassNames', () => {
    it('searches a file of string literals in work linear in its length', () => {
        for (const count of [1_000, 8_000]) {
            const source = `export const data = [${'"payload",'.repeat(count)}];`;
            expect(searchedCharacters(source)).toBeLessThanOrEqual(4 * source.length);
        }
    });

    it('still decodes an escaped key inside a longer file', () => {
        const source = `${'"payload",'.repeat(100)} x({ "cl\\x61ss": "p-4" }); ${'"tail",'.repeat(100)}`;
        expect([...collectAuthoredClassNames(source)]).toEqual(['p-4']);
    });
});
