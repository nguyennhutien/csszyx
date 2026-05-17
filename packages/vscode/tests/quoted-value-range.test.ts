/**
 * Verifies the quote-absorption logic applied to string value completions
 * (see completion-provider.ts `getQuotedValueRange`).
 *
 * We don't import from completion-provider.ts directly (it pulls in the
 * `vscode` module which isn't available in Node). Instead we reproduce the
 * same logic here and assert it against representative line/cursor pairs —
 * any future change to the heuristic must be kept in sync with this file.
 */

import { describe, expect, it } from 'vitest';

/**
 * Compute the replacement range for a quoted value completion, as a pair
 * of character offsets on the same line.
 * @param line - The line of source text.
 * @param cursor - Cursor character offset on that line.
 * @returns [startChar, endChar] of the range, or null if no quote precedes cursor.
 */
function computeRange(line: string, cursor: number): [number, number] | null {
    let start = cursor - 1;
    while (start >= 0 && /[a-zA-Z0-9_-]/.test(line[start] ?? '')) {
        start--;
    }
    if (start < 0) {
        return null;
    }
    const opener = line[start];
    if (opener !== "'" && opener !== '"') {
        return null;
    }

    let end = cursor;
    while (end < line.length && /[a-zA-Z0-9_-]/.test(line[end] ?? '')) {
        end++;
    }
    if (line[end] === opener) {
        end++;
    }

    return [start, end];
}

describe('quoted value replacement range', () => {
    it('returns null when no quote precedes the cursor', () => {
        const line = '{ textAlign: ';
        expect(computeRange(line, line.length)).toBeNull();
    });

    it('covers a lone opening quote typed by the user', () => {
        const line = "{ textAlign: '";
        // cursor right after the typed `'`
        expect(computeRange(line, line.length)).toEqual([line.length - 1, line.length]);
    });

    it('covers an auto-paired quote pair with cursor in between', () => {
        const line = "{ textAlign: ''";
        // cursor between the pair (HTML LS auto-inserted the closing `'`)
        const cursor = line.length - 1;
        expect(computeRange(line, cursor)).toEqual([cursor - 1, cursor + 1]);
    });

    it('covers opening quote + partial word', () => {
        const line = "{ textAlign: 'ce";
        expect(computeRange(line, line.length)).toEqual([line.length - 3, line.length]);
    });

    it('covers opening quote + partial word + auto-paired closing quote', () => {
        const line = "{ textAlign: 'ce'";
        const cursor = line.length - 1; // cursor before the closing `'`
        expect(computeRange(line, cursor)).toEqual([cursor - 3, cursor + 1]);
    });

    it('handles double-quoted opener (e.g. inside a single-quoted HTML attr)', () => {
        const line = '{ bg: "blu';
        expect(computeRange(line, line.length)).toEqual([line.length - 4, line.length]);
    });

    it('does not match when a non-quote char precedes the identifier', () => {
        const line = '{ p: ce';
        expect(computeRange(line, line.length)).toBeNull();
    });

    it('handles hyphenated values in Tailwind-style tokens', () => {
        const line = "{ bg: 'slate-9";
        expect(computeRange(line, line.length)).toEqual([line.length - 8, line.length]);
    });
});
