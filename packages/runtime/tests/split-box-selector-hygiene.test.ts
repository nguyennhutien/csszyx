/**
 * A selector the toolkit cannot act on has to say so, not answer quietly.
 *
 * Three shapes reached `matches` and produced an answer nobody meant:
 *   - `{}` matched every csszyx token, because "every entry agrees" is
 *     vacuously true of no entries — a selector built dynamically that came
 *     out empty turned every branch on;
 *   - a misspelt category (`widht`, or `width` where the category is
 *     `sizing`) fell through to the prefix test and answered false, which is
 *     indistinguishable from "no such class";
 *   - an array — the shape `splitBox`'s options take — answered false for
 *     the same reason, and TypeScript only catches it in typed code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDevWarnCache } from '../src/dev-warn.js';
import { has, omit, pick } from '../src/split-box.js';
import { SELECTOR_INVALID, unknownCategoryLine } from './helpers/split-box-lines.js';

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    resetDevWarnCache();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const said = (): string => warn.mock.calls.map(c => String(c[0])).join('\n');

describe('an empty object selector', () => {
    it('matches nothing instead of everything', () => {
        expect(has('w-full px-2', {})).toBe(false);
        expect(pick('w-full px-2', {})).toBe('');
        expect(omit('w-full px-2', {})).toBe('w-full px-2');
    });

    it('says why', () => {
        has('w-full', {});
        expect(said()).toBe(SELECTOR_INVALID.empty);
    });
});

describe('a selector the tables do not know', () => {
    it('still answers false, and warns once', () => {
        expect(has('w-full', 'widht')).toBe(false);
        expect(has('w-full', 'widht')).toBe(false);
        expect(warn.mock.calls).toEqual([[unknownCategoryLine('widht')]]);
    });

    it('names the category the caller probably meant', () => {
        has('w-full', 'width');
        expect(said()).toBe(unknownCategoryLine('width', 'sizing', true));
    });

    it('is quiet for every real selector shape', () => {
        has('w-full', 'w');
        has('w-full', 'sizing');
        has('px-2', 'inner');
        has('px-2', 'content');
        has('overflow-hidden', { overflow: 'hidden' });
        has('bg-red-500', 'bg');
        expect(said()).toBe('');
    });
});

describe('an array passed where one selector is expected', () => {
    it('warns instead of silently answering false', () => {
        expect(has('w-full', ['w', 'size'] as unknown as string)).toBe(false);
        expect(said()).toBe(SELECTOR_INVALID.array);
    });
});

describe('selector shapes the toolkit has always accepted stay quiet', () => {
    it('an exact class', () => {
        expect(has('overflow-hidden p-4', 'overflow-hidden')).toBe(true);
        expect(omit('w-full px-2', 'w-full')).toBe('px-2');
        expect(said()).toBe('');
    });

    it('a prefix deeper than the table entry', () => {
        expect(pick('bg-red-500 bg-blue-500', 'bg-red')).toBe('bg-red-500');
        expect(said()).toBe('');
    });

    it('a dashed prefix and an exact token', () => {
        expect(has('inset-x-0', 'inset-x')).toBe(true);
        expect(has('flex', 'flex')).toBe(true);
        expect(said()).toBe('');
    });
});

describe('an object selector that can never match', () => {
    it('warns when its category is not one the tables know', () => {
        expect(has('w-full', { width: 'full' })).toBe(false);
        expect(said()).toBe(unknownCategoryLine('width', 'sizing', true));
    });

    it('warns when it names more than one category', () => {
        // A token has one category, so two entries can never both agree.
        expect(has('overflow-hidden flex', { overflow: 'hidden', display: 'flex' })).toBe(false);
        expect(said()).toBe(SELECTOR_INVALID.multi(['overflow', 'display']));
    });
});

describe('a selector nobody can act on names what to do', () => {
    it('points at classify for a word with no hint', () => {
        has('w-full', 'margin-ish');
        expect(said()).toBe(unknownCategoryLine('margin-ish'));
    });

    it('knows the CSS property words people reach for', () => {
        has('text-red-500', 'color');
        // `text` alone would also catch `text-sm`; the qualified form is the
        // answer that matches what the word meant.
        has('bg-red-500', 'background');
        expect(warn.mock.calls).toEqual([
            [unknownCategoryLine('color', 'text', true)],
            [unknownCategoryLine('background', 'bg')],
        ]);
    });
});
