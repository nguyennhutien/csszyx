/**
 * A project whose Tailwind forces every utility is told so.
 *
 * `@import "tailwindcss" important` appends `!important` to every declaration,
 * so a class csszyx emits cannot override one the project already applies —
 * the build goes green and the override silently loses, with nothing in the
 * log to search for.
 *
 * A prefix is no longer on this list: the build reads it from the stylesheet
 * and the engine writes it before every class it emits.
 */
import { describe, expect, it } from 'vitest';

import { unsupportedStylesheetFactsMessage } from '../src/project-style-model.js';

describe('unsupportedStylesheetFactsMessage', () => {
    it('says nothing for a stock import', () => {
        expect(unsupportedStylesheetFactsMessage({ prefix: null, important: false })).toBeNull();
    });

    it('says nothing for a prefix, which csszyx emits for', () => {
        expect(unsupportedStylesheetFactsMessage({ prefix: 'tw', important: false })).toBeNull();
    });

    it('names the forced important, what it costs, and the way out', () => {
        const message = unsupportedStylesheetFactsMessage({ prefix: null, important: true });

        expect(message).toContain('important');
        expect(message).toContain('cannot override');
        // The way out, because a message that only reports is a dead end.
        expect(message).toContain('help:');
    });

    it('names only the important when a prefix is set beside it', () => {
        const message = unsupportedStylesheetFactsMessage({ prefix: 'tw', important: true });

        expect(message).toContain('important');
        expect(message).not.toContain('prefix(');
    });
});
