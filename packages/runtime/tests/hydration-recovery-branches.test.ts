/**
 * Remaining hydration.ts branches not covered by hydration.test.ts /
 * hydration-checksum.test.ts:
 *  - loadMangleMapFromDOM / verifyMangleMapIntegrity with an empty (but
 *    present) mangle-map script tag, exercising the `textContent || '{}'`
 *    fallback.
 *  - verifyMangleMapIntegrity's unverified-schema-only acceptance in
 *    production (no console.warn).
 *  - attemptCSRRecovery's `dev-only` mode rejected in production.
 *  - attemptCSRRecovery succeeding on an element that was never aborted
 *    (the abortedSubtrees.delete() no-op branch).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    attemptCSRRecovery,
    disableCSRRecovery,
    enableCSRRecovery,
    getAbortedSubtreeCount,
    loadMangleMapFromDOM,
    verifyMangleMapIntegrity,
} from '../src/hydration.js';

afterEach(() => {
    document.documentElement.removeAttribute('data-sz-checksum');
    document.getElementById('__CSSZYX_MANGLE_MAP__')?.remove();
    vi.restoreAllMocks();
});

describe('loadMangleMapFromDOM with an empty script tag', () => {
    it('fails to parse and returns null, logging the error', () => {
        const script = document.createElement('script');
        script.id = '__CSSZYX_MANGLE_MAP__';
        script.type = 'application/json';
        document.head.appendChild(script);
        expect(script.textContent).toBe('');

        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(loadMangleMapFromDOM()).toBeNull();
        expect(errorLog).toHaveBeenCalledWith('Failed to parse mangle map:', expect.anything());
    });
});

describe('verifyMangleMapIntegrity with an empty script tag', () => {
    it('treats empty content as {} (schema-valid) and accepts it, unverified', () => {
        document.documentElement.setAttribute('data-sz-checksum', 'sum');
        const script = document.createElement('script');
        script.id = '__CSSZYX_MANGLE_MAP__';
        script.type = 'application/json';
        document.head.appendChild(script);

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(verifyMangleMapIntegrity()).toBe(true);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('unverified'));
    });
});

describe('verifyMangleMapIntegrity is silent in production', () => {
    const prevEnv = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = prevEnv;
    });

    it('accepts a schema-valid, unverifiable map without warning', () => {
        process.env.NODE_ENV = 'production';
        document.documentElement.setAttribute('data-sz-checksum', 'sum');
        const script = document.createElement('script');
        script.id = '__CSSZYX_MANGLE_MAP__';
        script.type = 'application/json';
        script.textContent = JSON.stringify({ 'p-4': 'a' });
        document.head.appendChild(script);

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(verifyMangleMapIntegrity()).toBe(true);
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('attemptCSRRecovery — dev-only mode in production', () => {
    afterEach(() => disableCSRRecovery());
    const prevEnv = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = prevEnv;
    });

    it('is rejected with a warning', () => {
        process.env.NODE_ENV = 'production';
        enableCSRRecovery();
        const element = document.createElement('div');
        element.setAttribute('data-sz-recovery-token', 't1');
        element.setAttribute('szRecover', 'dev-only');

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(attemptCSRRecovery(element)).toBe(false);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('szRecover="dev-only" is disabled in production'),
        );
    });
});

describe('attemptCSRRecovery on an element that was never aborted', () => {
    afterEach(() => disableCSRRecovery());

    it('still succeeds and leaves the aborted-subtree count untouched', () => {
        enableCSRRecovery();
        const element = document.createElement('div');
        element.setAttribute('data-sz-recovery-token', 't2');
        element.setAttribute('szRecover', 'csr');

        const before = getAbortedSubtreeCount();
        expect(attemptCSRRecovery(element)).toBe(true);
        expect(getAbortedSubtreeCount()).toBe(before);
    });
});
