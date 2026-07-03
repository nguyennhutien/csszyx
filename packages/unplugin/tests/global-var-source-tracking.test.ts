import { describe, expect, it } from 'vitest';

import { recordGlobalVarSourceFile, shouldTrackGlobalVarSources } from '../src/unplugin.js';

/**
 * Source-text retention for global-var alias validation.
 *
 * The plugin keeps the pre-bundling text of transformed modules in
 * `state.globalVarSourceFilesByFile` so `validateGlobalVarBundleInputs` can
 * diff aliases against original sources. That validation only runs when
 * `production.mangleGlobalVars.enabled === true` — retaining sources without
 * it holds the full text of every transformed JS/TS module in memory for the
 * lifetime of a dev server. These tests lock the gate and the writer contract.
 */
describe('shouldTrackGlobalVarSources', () => {
    it('is off when the feature is not configured', () => {
        expect(shouldTrackGlobalVarSources(undefined)).toBe(false);
    });

    it('is off when the feature is configured but not enabled', () => {
        expect(shouldTrackGlobalVarSources({})).toBe(false);
        expect(shouldTrackGlobalVarSources({ enabled: false })).toBe(false);
    });

    it('is on only for an explicit enabled: true', () => {
        expect(shouldTrackGlobalVarSources({ enabled: true })).toBe(true);
    });
});

describe('recordGlobalVarSourceFile', () => {
    it('retains only script sources, keyed by normalized filename', () => {
        const state = { globalVarSourceFilesByFile: new Map<string, string>() };

        recordGlobalVarSourceFile(state, '/app/src/Button.tsx', 'export const a = 1;');
        recordGlobalVarSourceFile(state, '/app/src/styles.css', '.a { color: red }');

        expect([...state.globalVarSourceFilesByFile.keys()]).toEqual(['/app/src/Button.tsx']);
    });

    it('replaces an existing entry instead of accumulating per edit', () => {
        const state = { globalVarSourceFilesByFile: new Map<string, string>() };

        recordGlobalVarSourceFile(state, '/app/src/Button.tsx', 'v1');
        recordGlobalVarSourceFile(state, '/app/src/Button.tsx', 'v2');

        expect(state.globalVarSourceFilesByFile.size).toBe(1);
        expect(state.globalVarSourceFilesByFile.get('/app/src/Button.tsx')).toBe('v2');
    });

    it('clears the entry when the file is deleted (code = null)', () => {
        const state = { globalVarSourceFilesByFile: new Map<string, string>() };

        recordGlobalVarSourceFile(state, '/app/src/Button.tsx', 'v1');
        recordGlobalVarSourceFile(state, '/app/src/Button.tsx', null);

        expect(state.globalVarSourceFilesByFile.size).toBe(0);
    });
});
