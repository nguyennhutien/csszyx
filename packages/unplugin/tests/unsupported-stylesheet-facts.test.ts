/**
 * A project whose Tailwind renames or forces every utility is told so.
 *
 * `@import "tailwindcss" prefix(tw)` makes `tw:p-4` the served class and `p-4`
 * a class with no CSS; `important` appends `!important` to every declaration.
 * csszyx lowers `sz` to the unprefixed names either way, so on such a project
 * every class it emits styles nothing — the build goes green and the page
 * renders unstyled, with nothing in the log to search for.
 *
 * Supporting the prefix is a separate piece of work. Saying so is not: a build
 * tool whose output is silently inert is the failure its own rules rank worst.
 */
import { describe, expect, it } from 'vitest';

import { unsupportedStylesheetFactsMessage } from '../src/project-style-model.js';

describe('unsupportedStylesheetFactsMessage', () => {
    it('says nothing for a stock import', () => {
        expect(unsupportedStylesheetFactsMessage({ prefix: null, important: false })).toBeNull();
    });

    it('names the prefix, what it costs, and the way out', () => {
        const message = unsupportedStylesheetFactsMessage({ prefix: 'tw', important: false });

        expect(message).toContain('prefix(tw)');
        // The consequence, in the terms the user sees on the page.
        expect(message).toContain('no CSS');
        // The way out, because a message that only reports is a dead end.
        expect(message).toContain('help:');
    });

    it('names the forced important', () => {
        const message = unsupportedStylesheetFactsMessage({ prefix: null, important: true });

        expect(message).toContain('important');
        expect(message).toContain('help:');
    });

    it('reports both in one message when both are set', () => {
        const message = unsupportedStylesheetFactsMessage({ prefix: 'tw', important: true });

        expect(message).toContain('prefix(tw)');
        expect(message).toContain('important');
        // One message, not two: they come from one line of the stylesheet and
        // have one fix.
        expect(message?.split('\n').filter(line => line.startsWith('[csszyx]'))).toHaveLength(1);
    });
});
