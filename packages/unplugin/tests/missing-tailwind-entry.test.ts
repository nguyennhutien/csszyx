import { describe, expect, it } from 'vitest';

import {
    emitMissingCssFallback,
    missingTailwindEntryMessage,
    shouldEmitMissingCssFallback,
    shouldEmitWarning,
    shouldWarnMissingTailwindEntry,
} from '../src/unplugin.js';

// Warning-emission policy: `quiet` mutes everything; `devOnly` usage nudges are
// suppressed in production so csszyx-as-a-dependency doesn't noise a host app's
// prod build. csszyx-output-defect warnings (devOnly=false) stay in every mode.
describe('shouldEmitWarning', () => {
    it('mutes every warning when quiet is set, regardless of mode', () => {
        expect(shouldEmitWarning(true, false, false)).toBe(false);
        expect(shouldEmitWarning(true, false, true)).toBe(false);
        expect(shouldEmitWarning(true, true, false)).toBe(false);
    });

    it('keeps a non-devOnly (output-defect) warning in every mode', () => {
        expect(shouldEmitWarning(false, false, false)).toBe(true);
        expect(shouldEmitWarning(false, false, true)).toBe(true);
    });

    it('suppresses a devOnly (usage-nudge) warning only in production', () => {
        expect(shouldEmitWarning(false, true, false)).toBe(true); // dev → shown
        expect(shouldEmitWarning(false, true, true)).toBe(false); // prod → silent
    });
});

describe('shouldEmitMissingCssFallback', () => {
    const missingCss = 'szv catalog at 1:1: factory config cannot be resolved at build time';

    it('emits only actionable missing-CSS diagnostics when not quiet', () => {
        expect(shouldEmitMissingCssFallback(false, missingCss)).toBe(true);
        expect(shouldEmitMissingCssFallback(true, missingCss)).toBe(false);
        expect(shouldEmitMissingCssFallback(false, 'ordinary diagnostic')).toBe(false);
    });

    it('routes an eligible diagnostic through the supplied channel', () => {
        const emitted: string[] = [];
        emitMissingCssFallback(false, missingCss, message => emitted.push(message));
        emitMissingCssFallback(true, missingCss, message => emitted.push(message));
        expect(emitted).toEqual([missingCss]);
    });
});

// The warning fires in buildEnd; rolldown runs that hook in a worker where an
// in-process console spy cannot observe it, so the decision + message are pulled
// into pure functions and asserted directly (the build wiring is exercised by the
// existing vite-build integration tests staying green).
describe('shouldWarnMissingTailwindEntry', () => {
    it('warns when csszyx generated classes and CSS was seen but no tailwindcss entry', () => {
        expect(shouldWarnMissingTailwindEntry(5, false, true)).toBe(true);
    });

    it('does not warn when a Tailwind entry was seen', () => {
        expect(shouldWarnMissingTailwindEntry(5, true, true)).toBe(false);
    });

    it('does not warn when csszyx generated no classes', () => {
        expect(shouldWarnMissingTailwindEntry(0, false, true)).toBe(false);
        expect(shouldWarnMissingTailwindEntry(0, true, true)).toBe(false);
    });

    it('does NOT warn when no CSS was observed (astro check / early phase / external CSS)', () => {
        // csszyx never saw the CSS pipeline, so it cannot conclude the entry is
        // missing — staying silent avoids the Astro false-positive.
        expect(shouldWarnMissingTailwindEntry(5, false, false)).toBe(false);
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
