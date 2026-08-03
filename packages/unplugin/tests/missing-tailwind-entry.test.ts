import { describe, expect, it } from 'vitest';

import {
    emitMissingCssFallback,
    missingTailwindEntryMessage,
    resolveQuietMode,
    shouldEmitMissingCssFallback,
    shouldEmitWarning,
    shouldWarnMissingTailwindEntry,
} from '../src/unplugin.js';

// Warning-emission policy: `quiet: true` mutes everything; `'nudges'` mutes
// exactly the `devOnly` usage nudges, which are also the ones suppressed in
// production so csszyx-as-a-dependency doesn't noise a host app's prod build.
// csszyx-output-defect warnings (devOnly=false) stay in every mode but `'all'`.
describe('resolveQuietMode', () => {
    it('maps the authored values onto the three modes', () => {
        expect(resolveQuietMode(true)).toBe('all');
        expect(resolveQuietMode('nudges')).toBe('nudges');
        expect(resolveQuietMode(false)).toBe('off');
        expect(resolveQuietMode(undefined)).toBe('off');
    });
});

describe('shouldEmitWarning', () => {
    it('mutes every warning when quiet is all, regardless of mode', () => {
        expect(shouldEmitWarning('all', false, false)).toBe(false);
        expect(shouldEmitWarning('all', false, true)).toBe(false);
        expect(shouldEmitWarning('all', true, false)).toBe(false);
    });

    it('keeps a non-devOnly (output-defect) warning in every mode', () => {
        expect(shouldEmitWarning('off', false, false)).toBe(true);
        expect(shouldEmitWarning('off', false, true)).toBe(true);
        expect(shouldEmitWarning('nudges', false, false)).toBe(true);
        expect(shouldEmitWarning('nudges', false, true)).toBe(true);
    });

    it('suppresses a devOnly (usage-nudge) warning in production or under nudges', () => {
        expect(shouldEmitWarning('off', true, false)).toBe(true); // dev → shown
        expect(shouldEmitWarning('off', true, true)).toBe(false); // prod → silent
        expect(shouldEmitWarning('nudges', true, false)).toBe(false);
    });
});

describe('shouldEmitMissingCssFallback', () => {
    const missingCss = 'szv catalog at 1:1: factory config cannot be resolved at build time';

    it('emits only actionable missing-CSS diagnostics when not fully quiet', () => {
        expect(shouldEmitMissingCssFallback('off', missingCss)).toBe(true);
        expect(shouldEmitMissingCssFallback('all', missingCss)).toBe(false);
        expect(shouldEmitMissingCssFallback('off', 'ordinary diagnostic')).toBe(false);
    });

    it('survives the nudges mode, which is the whole point of that mode', () => {
        expect(shouldEmitMissingCssFallback('nudges', missingCss)).toBe(true);
    });

    it('routes an eligible diagnostic through the supplied channel', () => {
        const emitted: string[] = [];
        emitMissingCssFallback('off', missingCss, '/src/Card.tsx', message =>
            emitted.push(message),
        );
        emitMissingCssFallback('all', missingCss, '/src/Card.tsx', message =>
            emitted.push(message),
        );
        expect(emitted).toEqual([`[csszyx] /src/Card.tsx\n  ${missingCss}`]);
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
