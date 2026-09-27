/**
 * The start-tag walk the Vue and Svelte adapters share.
 */
import { describe, expect, it } from 'vitest';

import { rewriteStartTags } from '../src/start-tags.js';

describe('rewriteStartTags', () => {
    const upper = (tag: string) => tag.toUpperCase();

    it('rewrites every element start tag and leaves the text between', () => {
        expect(rewriteStartTags('<p x="1">text</p><em> end', upper)).toBe(
            '<P X="1">text</p><EM> end',
        );
    });

    it('skips what is not an element start tag', () => {
        expect(rewriteStartTags('a < b <!-- c --> <1>', upper)).toBe('a < b <!-- c --> <1>');
    });

    it('stops at a tag that never closes', () => {
        expect(rewriteStartTags('<p> <em', upper)).toBe('<P> <em');
    });

    it('keeps the markup when nothing changes', () => {
        const markup = '<div class="a"></div>';
        expect(rewriteStartTags(markup, tag => tag)).toBe(markup);
    });

    it('goes on after a rewrite that changes the length', () => {
        expect(rewriteStartTags('<p><em>', tag => `${tag}!`)).toBe('<p>!<em>!');
    });
});
