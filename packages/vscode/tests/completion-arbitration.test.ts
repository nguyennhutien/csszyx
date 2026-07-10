import { describe, expect, it } from 'vitest';

import {
    type CompletionMode,
    parseCompletionMode,
    planCompletions,
} from '../src/completion-arbitration';

describe('planCompletions', () => {
    it('auto: plugin owns TS/JS, companion fills trigger chars, extension covers HTML', () => {
        expect(planCompletions('auto')).toEqual({
            pluginEnabled: true,
            extensionLanguages: 'html-only',
            companion: true,
        });
    });

    it('extension: plugin and companion disabled, extension serves every language', () => {
        expect(planCompletions('extension')).toEqual({
            pluginEnabled: false,
            extensionLanguages: 'all',
            companion: false,
        });
    });

    it('off: no provider serves completions', () => {
        expect(planCompletions('off')).toEqual({
            pluginEnabled: false,
            extensionLanguages: 'none',
            companion: false,
        });
    });

    it('never enables the plugin and the full extension provider at once', () => {
        for (const mode of ['auto', 'extension', 'off'] as CompletionMode[]) {
            const plan = planCompletions(mode);
            expect(plan.pluginEnabled && plan.extensionLanguages === 'all').toBe(false);
            // The companion exists only alongside the plugin it complements.
            expect(plan.companion && !plan.pluginEnabled).toBe(false);
        }
    });
});

describe('parseCompletionMode', () => {
    it('passes through known modes', () => {
        expect(parseCompletionMode('extension')).toBe('extension');
        expect(parseCompletionMode('off')).toBe('off');
        expect(parseCompletionMode('auto')).toBe('auto');
    });

    it('falls back to auto for unknown or malformed values', () => {
        for (const value of ['nonsense', '', undefined, null, 42, {}]) {
            expect(parseCompletionMode(value)).toBe('auto');
        }
    });
});
