/**
 * Tests for verify module.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
    getRecoveryMode,
    hasRecoveryToken,
    isValidManifest,
    type RecoveryManifest,
    verifyRecoveryToken,
} from '../src/verify.js';

describe('isValidManifest', () => {
    it('should validate correct manifest', () => {
        const manifest = {
            buildId: 'build123',
            checksum: 'abc123',
            mangleChecksum: 'def456',
            tokens: {},
        };
        expect(isValidManifest(manifest)).toBe(true);
    });

    it('should reject null', () => {
        expect(isValidManifest(null)).toBe(false);
    });

    it('should reject undefined', () => {
        expect(isValidManifest(undefined)).toBe(false);
    });

    it('should reject non-objects', () => {
        expect(isValidManifest('string')).toBe(false);
        expect(isValidManifest(42)).toBe(false);
    });

    it('should reject missing buildId', () => {
        expect(
            isValidManifest({
                checksum: 'abc123',
                tokens: {},
            }),
        ).toBe(false);
    });

    it('should reject missing checksum', () => {
        expect(
            isValidManifest({
                buildId: 'build123',
                tokens: {},
            }),
        ).toBe(false);
    });

    it('should reject missing tokens', () => {
        expect(
            isValidManifest({
                buildId: 'build123',
                checksum: 'abc123',
                mangleChecksum: 'def456',
            }),
        ).toBe(false);
    });

    it('should reject missing mangleChecksum', () => {
        expect(
            isValidManifest({
                buildId: 'build123',
                checksum: 'abc123',
                tokens: {},
            }),
        ).toBe(false);
    });

    it('should reject non-string mangleChecksum', () => {
        expect(
            isValidManifest({
                buildId: 'build123',
                checksum: 'abc123',
                mangleChecksum: 123,
                tokens: {},
            }),
        ).toBe(false);
    });
});

describe('verifyRecoveryToken', () => {
    let element: HTMLElement,
        manifest: RecoveryManifest;

    beforeEach(() => {
        element = document.createElement('div');
        manifest = {
            buildId: 'build123',
            checksum: 'abc123',
            mangleChecksum: 'def456',
            tokens: {
                token1: {
                    mode: 'csr',
                    component: 'Button',
                    path: 'app/Button.tsx',
                },
            },
        };
    });

    it('should verify valid token', () => {
        element.setAttribute('data-sz-recovery-token', 'token1');
        element.setAttribute('szRecover', 'csr');

        const result = verifyRecoveryToken(element, manifest);
        expect(result.valid).toBe(true);
        expect(result.tokenData).toEqual({
            mode: 'csr',
            component: 'Button',
            path: 'app/Button.tsx',
        });
    });

    it('should reject missing token attribute', () => {
        const result = verifyRecoveryToken(element, manifest);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('No recovery token');
    });

    it('should reject token not in manifest', () => {
        element.setAttribute('data-sz-recovery-token', 'invalid');
        element.setAttribute('szRecover', 'csr');

        const result = verifyRecoveryToken(element, manifest);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Token not found');
    });

    it('should reject mode mismatch', () => {
        element.setAttribute('data-sz-recovery-token', 'token1');
        element.setAttribute('szRecover', 'dev-only');

        const result = verifyRecoveryToken(element, manifest);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('does not match');
    });
});

describe('hasRecoveryToken', () => {
    it('should return true for element with token', () => {
        const element = document.createElement('div');
        element.setAttribute('data-sz-recovery-token', 'token1');
        expect(hasRecoveryToken(element)).toBe(true);
    });

    it('should return false for element without token', () => {
        const element = document.createElement('div');
        expect(hasRecoveryToken(element)).toBe(false);
    });
});

describe('getRecoveryMode', () => {
    it('should return csr mode', () => {
        const element = document.createElement('div');
        element.setAttribute('szRecover', 'csr');
        expect(getRecoveryMode(element)).toBe('csr');
    });

    it('should return dev-only mode', () => {
        const element = document.createElement('div');
        element.setAttribute('szRecover', 'dev-only');
        expect(getRecoveryMode(element)).toBe('dev-only');
    });

    it('should return null for invalid mode', () => {
        const element = document.createElement('div');
        element.setAttribute('szRecover', 'invalid');
        expect(getRecoveryMode(element)).toBe(null);
    });

    it('should return null for missing attribute', () => {
        const element = document.createElement('div');
        expect(getRecoveryMode(element)).toBe(null);
    });
});
