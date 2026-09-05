/**
 * The split is a routing decision, and three of its outcomes are shapes that
 * cannot do what the className asked for. Each is silent in the DOM — the
 * classes are all present and correct — so the only place to say so is here,
 * in development, once per message.
 *
 * None of these is an error: a caller may well be adding the missing piece on
 * the next line. They name the shape, and what to add.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDevWarnCache } from '../src/dev-warn.js';
import { splitBox } from '../src/split-box.js';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    resetDevWarnCache();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    warn.mockRestore();
});

/**
 * Every warning text emitted during the call, joined for substring matching.
 *
 * @returns The captured messages, one per line.
 */
function messages(): string {
    return warn.mock.calls.map(call => String(call[0])).join('\n');
}

describe('a scroller with nothing to scroll inside', () => {
    it('warns when neither node bounds the height', () => {
        splitBox('overflow-y-auto p-4');
        expect(messages()).toContain("'overflow-y-auto' went to the content node");
        expect(messages()).toContain('nothing bounds the height');
    });

    // Each case also asserts the partition it produced. `splitMemo` is module
    // level and the suite does not clear it, so a className another case
    // already split would return from the memo without running the analysis at
    // all — and a `not.toContain` alone cannot tell that apart from silence.
    it.each([
        ['a fixed height', 'h-64 overflow-y-auto p-4', 'h-64', 'overflow-y-auto p-4'],
        ['a max height', 'max-h-96 overflow-auto p-4', 'max-h-96', 'overflow-auto p-4'],
        ['a min height', 'min-h-32 overflow-scroll p-4', 'min-h-32', 'overflow-scroll p-4'],
        ['a square size', 'size-64 overflow-auto p-4', 'size-64', 'overflow-auto p-4'],
        ['an inherited height', 'h-full overflow-auto p-4', 'h-full', 'overflow-auto p-4'],
    ])('stays quiet with %s', (_label, className, outer, inner) => {
        expect(splitBox(className)).toEqual({ outer, inner });
        expect(messages()).not.toContain('nothing bounds the height');
    });

    // A frame stretched by its parent is bounded too, and the bound is not a
    // class on this element at all.
    it.each([
        [
            'an absolutely positioned frame',
            'absolute inset-0 overflow-auto p-4',
            'absolute inset-0',
        ],
        [
            'a fixed frame pinned top and bottom',
            'fixed top-0 bottom-0 overflow-auto p-4',
            'fixed top-0 bottom-0',
        ],
        ['a flex child that grows', 'flex-1 overflow-auto p-4', 'flex-1'],
        ['a flex child with grow', 'grow overflow-auto p-4', 'grow'],
        ['a flex child with a basis', 'basis-0 overflow-auto p-4', 'basis-0'],
        ['a flex child that cannot grow but is sized', 'grow-0 overflow-auto p-4', 'grow-0'],
    ])('stays quiet with %s', (_label, className, outer) => {
        expect(splitBox(className)).toEqual({ outer, inner: 'overflow-auto p-4' });
        expect(messages()).not.toContain('nothing bounds the height');
    });

    // Positioned but not pinned: `absolute` alone leaves the height to the
    // content, so the scroller is still unbounded.
    it('still warns for a positioned frame with no inset', () => {
        splitBox('absolute overflow-auto p-4');
        expect(messages()).toContain('nothing bounds the height');
    });

    // An unowned class carries no box role, so it can never be the bound.
    it('still warns when only a third-party class is present', () => {
        splitBox('zzz-vendor-frame overflow-auto p-4');
        expect(messages()).toContain('nothing bounds the height');
    });

    it('says nothing when there is no scroller at all', () => {
        expect(splitBox('h-64 p-4 overflow-hidden')).toEqual({
            outer: 'h-64 overflow-hidden',
            inner: 'p-4',
        });
        expect(messages()).not.toContain('nothing bounds the height');
    });
});

describe('a display:none that hides only the content', () => {
    it('warns, because the frame stays visible', () => {
        splitBox('hidden bg-white border');
        expect(messages()).toContain("'hidden' went to the content node");
        expect(messages()).toContain("{ outer: ['hidden'] }");
    });

    // Under a variant the pair is usually deliberate — `hidden md:block` toggles
    // the content, and the frame is meant to stay.
    it('stays quiet under a variant', () => {
        expect(splitBox('md:hidden bg-white')).toEqual({
            outer: 'bg-white',
            inner: 'md:hidden',
        });
        expect(messages()).not.toContain('went to the content node');
    });
});

describe('a rounded frame that does not clip its scroller', () => {
    it('warns that scrolled content paints over the corners', () => {
        splitBox('rounded-xl h-64 overflow-y-auto');
        expect(messages()).toContain('the frame is rounded and the content scrolls');
    });

    it.each([
        [
            'overflow-hidden',
            'rounded-xl h-64 overflow-hidden overflow-y-auto',
            'rounded-xl h-64 overflow-hidden',
            'overflow-y-auto',
        ],
        [
            'overflow-clip',
            'rounded-lg h-64 overflow-clip overflow-y-scroll',
            'rounded-lg h-64 overflow-clip',
            'overflow-y-scroll',
        ],
    ])('stays quiet once the frame clips with %s', (_label, className, outer, inner) => {
        expect(splitBox(className)).toEqual({ outer, inner });
        expect(messages()).not.toContain('the frame is rounded');
    });

    it('stays quiet with square corners', () => {
        expect(splitBox('h-64 overflow-y-auto border')).toEqual({
            outer: 'h-64 border',
            inner: 'overflow-y-auto',
        });
        expect(messages()).not.toContain('the frame is rounded');
    });
});

describe('outside development', () => {
    it('says nothing at all', () => {
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            splitBox('prod-probe-1 overflow-y-auto hidden rounded-xl');
        } finally {
            process.env.NODE_ENV = previous;
        }
        expect(warn).not.toHaveBeenCalled();
    });
});
