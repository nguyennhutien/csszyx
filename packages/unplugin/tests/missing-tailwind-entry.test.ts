import { describe, expect, it } from 'vitest';

import { missingTailwindEntryMessage, shouldWarnMissingTailwindEntry } from '../src/unplugin.js';

// The warning fires in buildEnd; rolldown runs that hook in a worker where an
// in-process console spy cannot observe it, so the decision + message are pulled
// into pure functions and asserted directly (the build wiring is exercised by the
// existing vite-build integration tests staying green).
describe('shouldWarnMissingTailwindEntry', () => {
    it('warns when csszyx generated classes but no CSS imported tailwindcss', () => {
        expect(shouldWarnMissingTailwindEntry(5, false)).toBe(true);
    });

    it('does not warn when a Tailwind entry was seen', () => {
        expect(shouldWarnMissingTailwindEntry(5, true)).toBe(false);
    });

    it('does not warn when csszyx generated no classes', () => {
        expect(shouldWarnMissingTailwindEntry(0, false)).toBe(false);
        expect(shouldWarnMissingTailwindEntry(0, true)).toBe(false);
    });
});

describe('missingTailwindEntryMessage', () => {
    it('names the count and the actionable fix', () => {
        const message = missingTailwindEntryMessage(3);
        expect(message).toContain('3 sz class');
        expect(message).toContain('found no CSS entry importing "tailwindcss"');
        expect(message).toContain('@source');
    });
});
