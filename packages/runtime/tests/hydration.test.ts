/**
 * Tests for hydration module.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    abortHydration,
    attemptCSRRecovery,
    clearHydrationErrors,
    disableCSRRecovery,
    enableCSRRecovery,
    getAbortedSubtreeCount,
    getHydrationErrors,
    guardHydration,
    type HydrationError,
    isCSRRecoveryAllowed,
    isHydrationAborted,
    loadMangleMapFromDOM,
} from '../src/hydration.js';

describe('CSR Recovery', () => {
    afterEach(() => {
        disableCSRRecovery();
    });

    it('should enable CSR recovery', () => {
        enableCSRRecovery();
        expect(isCSRRecoveryAllowed()).toBe(true);
    });

    it('should disable CSR recovery', () => {
        enableCSRRecovery();
        disableCSRRecovery();
        expect(isCSRRecoveryAllowed()).toBe(false);
    });

    it('should be disabled by default', () => {
        expect(isCSRRecoveryAllowed()).toBe(false);
    });
});

describe('abortHydration', () => {
    let element: HTMLElement, error: HydrationError;

    beforeEach(() => {
        element = document.createElement('div');
        error = {
            type: 'checksum_mismatch',
            message: 'Test error',
            timestamp: Date.now(),
        };
        clearHydrationErrors();
    });

    it('should mark element as aborted', () => {
        abortHydration(element, error);
        expect(isHydrationAborted(element)).toBe(true);
    });

    it('should add abort attribute', () => {
        abortHydration(element, error);
        expect(element.hasAttribute('data-sz-hydration-aborted')).toBe(true);
    });

    it('should add abort reason', () => {
        abortHydration(element, error);
        expect(element.getAttribute('data-sz-abort-reason')).toBe('checksum_mismatch');
    });

    it('should add interactive marker', () => {
        abortHydration(element, error);
        expect(element.getAttribute('data-sz-interactive')).toBe('false');
    });

    it('should record error', () => {
        abortHydration(element, error);
        const errors = getHydrationErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0].type).toBe('checksum_mismatch');
        expect(errors[0].element).toBe(element);
    });

    it('should increment aborted count', () => {
        const initialCount = getAbortedSubtreeCount();
        abortHydration(element, error);
        expect(getAbortedSubtreeCount()).toBe(initialCount + 1);
    });
});

describe('isHydrationAborted', () => {
    let element: HTMLElement;

    beforeEach(() => {
        element = document.createElement('div');
        clearHydrationErrors();
    });

    it('should return false for non-aborted element', () => {
        expect(isHydrationAborted(element)).toBe(false);
    });

    it('should return true after abort', () => {
        const error: HydrationError = {
            type: 'checksum_mismatch',
            message: 'Test',
            timestamp: Date.now(),
        };
        abortHydration(element, error);
        expect(isHydrationAborted(element)).toBe(true);
    });

    it('should detect abort attribute', () => {
        element.setAttribute('data-sz-hydration-aborted', Date.now().toString());
        expect(isHydrationAborted(element)).toBe(true);
    });
});

describe('attemptCSRRecovery', () => {
    let element: HTMLElement;

    beforeEach(() => {
        element = document.createElement('div');
        clearHydrationErrors();
    });

    afterEach(() => {
        disableCSRRecovery();
    });

    it('should fail when recovery is disabled', () => {
        disableCSRRecovery();
        element.setAttribute('data-sz-recovery-token', 'token1');
        element.setAttribute('szRecover', 'csr');

        const result = attemptCSRRecovery(element);
        expect(result).toBe(false);
    });

    it('should fail without recovery token', () => {
        enableCSRRecovery();
        const result = attemptCSRRecovery(element);
        expect(result).toBe(false);
    });

    it('should succeed with csr mode', () => {
        enableCSRRecovery();
        element.setAttribute('data-sz-recovery-token', 'token1');
        element.setAttribute('szRecover', 'csr');

        const error: HydrationError = {
            type: 'checksum_mismatch',
            message: 'Test',
            timestamp: Date.now(),
        };
        abortHydration(element, error);

        const result = attemptCSRRecovery(element);
        expect(result).toBe(true);
        expect(isHydrationAborted(element)).toBe(false);
    });

    it('should remove abort markers', () => {
        enableCSRRecovery();
        element.setAttribute('data-sz-recovery-token', 'token1');
        element.setAttribute('szRecover', 'csr');

        const error: HydrationError = {
            type: 'checksum_mismatch',
            message: 'Test',
            timestamp: Date.now(),
        };
        abortHydration(element, error);

        attemptCSRRecovery(element);

        expect(element.hasAttribute('data-sz-hydration-aborted')).toBe(false);
        expect(element.hasAttribute('data-sz-abort-reason')).toBe(false);
        expect(element.hasAttribute('data-sz-interactive')).toBe(false);
    });
});

describe('guardHydration', () => {
    beforeEach(() => {
        clearHydrationErrors();
        document.documentElement.removeAttribute('data-sz-hydration-aborted');
        document.documentElement.removeAttribute('data-sz-abort-reason');
        document.documentElement.removeAttribute('data-sz-interactive');
        document.documentElement.setAttribute('data-sz-checksum', 'mangle1234567890');
    });

    afterEach(() => {
        document.documentElement.removeAttribute('data-sz-checksum');
        document.documentElement.removeAttribute('data-sz-hydration-aborted');
        document.documentElement.removeAttribute('data-sz-abort-reason');
        document.documentElement.removeAttribute('data-sz-interactive');
        clearHydrationErrors();
    });

    it('uses mangleChecksum instead of token checksum for the mangle guard', () => {
        const result = guardHydration({
            buildId: 'build123',
            checksum: 'tokenabcdef12345',
            mangleChecksum: 'mangle1234567890',
            tokens: {},
        });

        expect(result).toBe(true);
        expect(isHydrationAborted(document.documentElement)).toBe(false);
    });

    it('aborts when mangleChecksum does not match the HTML checksum', () => {
        const result = guardHydration({
            buildId: 'build123',
            checksum: 'tokenabcdef12345',
            mangleChecksum: 'wrong12345678901',
            tokens: {},
        });

        expect(result).toBe(false);
        expect(isHydrationAborted(document.documentElement)).toBe(true);
        expect(getHydrationErrors()[0]?.type).toBe('checksum_mismatch');
    });

    it('aborts when mangleChecksum is missing from the manifest', () => {
        const result = guardHydration({
            buildId: 'build123',
            checksum: 'tokenabcdef12345',
            tokens: {},
        } as never);

        expect(result).toBe(false);
        expect(isHydrationAborted(document.documentElement)).toBe(true);
        expect(getHydrationErrors()[0]?.type).toBe('checksum_mismatch');
    });
});

describe('loadMangleMapFromDOM', () => {
    afterEach(() => {
        document.getElementById('__CSSZYX_MANGLE_MAP__')?.remove();
        document.getElementById('__SZ_MANGLE_MAP__')?.remove();
    });

    it('loads the current unplugin mangle map script id', () => {
        const script = document.createElement('script');
        script.id = '__CSSZYX_MANGLE_MAP__';
        script.type = 'application/json';
        script.textContent = JSON.stringify({
            'class:p-4': 'z',
            'var:--_sz-p:--cz': '--cz',
            'var:--_sz-p:--sz': '--sz',
        });
        document.head.appendChild(script);

        expect(loadMangleMapFromDOM()).toEqual({
            'class:p-4': 'z',
            'var:--_sz-p:--cz': '--cz',
            'var:--_sz-p:--sz': '--sz',
        });
    });

    it('keeps backward compatibility with the legacy script id', () => {
        const script = document.createElement('script');
        script.id = '__SZ_MANGLE_MAP__';
        script.type = 'application/json';
        script.textContent = JSON.stringify({ 'p-4': 'z' });
        document.head.appendChild(script);

        expect(loadMangleMapFromDOM()).toEqual({ 'p-4': 'z' });
    });
});

describe('getHydrationErrors', () => {
    beforeEach(() => {
        clearHydrationErrors();
    });

    it('should return empty array initially', () => {
        expect(getHydrationErrors()).toEqual([]);
    });

    it('should return recorded errors', () => {
        const element = document.createElement('div');
        const error: HydrationError = {
            type: 'checksum_mismatch',
            message: 'Test',
            timestamp: Date.now(),
        };

        abortHydration(element, error);

        const errors = getHydrationErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0].type).toBe('checksum_mismatch');
    });

    it('should return multiple errors', () => {
        const element1 = document.createElement('div');
        const element2 = document.createElement('div');

        abortHydration(element1, {
            type: 'checksum_mismatch',
            message: 'Error 1',
            timestamp: Date.now(),
        });

        abortHydration(element2, {
            type: 'map_missing',
            message: 'Error 2',
            timestamp: Date.now(),
        });

        const errors = getHydrationErrors();
        expect(errors).toHaveLength(2);
    });
});

describe('clearHydrationErrors', () => {
    beforeEach(() => {
        clearHydrationErrors();
    });

    it('should clear all errors', () => {
        const element = document.createElement('div');
        const error: HydrationError = {
            type: 'checksum_mismatch',
            message: 'Test',
            timestamp: Date.now(),
        };

        abortHydration(element, error);
        expect(getHydrationErrors()).toHaveLength(1);

        clearHydrationErrors();
        expect(getHydrationErrors()).toEqual([]);
        expect(getAbortedSubtreeCount()).toBe(0);
    });
});

describe('getAbortedSubtreeCount', () => {
    beforeEach(() => {
        clearHydrationErrors();
    });

    it('should return 0 initially', () => {
        expect(getAbortedSubtreeCount()).toBe(0);
    });

    it('should count aborted subtrees', () => {
        const element1 = document.createElement('div');
        const element2 = document.createElement('div');

        abortHydration(element1, {
            type: 'checksum_mismatch',
            message: 'Test',
            timestamp: Date.now(),
        });

        expect(getAbortedSubtreeCount()).toBe(1);

        abortHydration(element2, {
            type: 'checksum_mismatch',
            message: 'Test',
            timestamp: Date.now(),
        });

        expect(getAbortedSubtreeCount()).toBe(2);
    });
});
