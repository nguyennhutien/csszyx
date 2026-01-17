/**
 * Tests for recovery module.
 */

import { describe, expect, it } from 'vitest';

import {
    createRecoveryToken,
    generateRecoveryToken,
    injectRecoveryToken,
    isValidRecoveryMode,
    validateSzRecover,
} from '../src/recovery.js';

describe('isValidRecoveryMode', () => {
    it('should return true for valid modes', () => {
        expect(isValidRecoveryMode('csr')).toBe(true);
        expect(isValidRecoveryMode('dev-only')).toBe(true);
    });

    it('should return false for invalid modes', () => {
        expect(isValidRecoveryMode('invalid')).toBe(false);
        expect(isValidRecoveryMode('CSR')).toBe(false);
        expect(isValidRecoveryMode('')).toBe(false);
        expect(isValidRecoveryMode(null)).toBe(false);
        expect(isValidRecoveryMode(undefined)).toBe(false);
        expect(isValidRecoveryMode(42)).toBe(false);
    });
});

describe('generateRecoveryToken', () => {
    it('should generate a 12-character token', () => {
        const token = generateRecoveryToken({
            mode: 'csr',
            component: 'TestComponent',
            filePath: '/app/test.tsx',
            line: 10,
            column: 5,
            buildId: 'build123',
        });

        expect(token).toHaveLength(12);
        expect(token).toMatch(/^[0-9a-f]{12}$/);
    });

    it('should generate consistent tokens for same input', () => {
        const metadata = {
            mode: 'csr' as const,
            component: 'TestComponent',
            filePath: '/app/test.tsx',
            line: 10,
            column: 5,
            buildId: 'build123',
        };

        const token1 = generateRecoveryToken(metadata);
        const token2 = generateRecoveryToken(metadata);

        expect(token1).toBe(token2);
    });

    it('should generate different tokens for different inputs', () => {
        const token1 = generateRecoveryToken({
            mode: 'csr',
            component: 'Component1',
            filePath: '/app/test.tsx',
            line: 10,
            column: 5,
            buildId: 'build123',
        });

        const token2 = generateRecoveryToken({
            mode: 'csr',
            component: 'Component2',
            filePath: '/app/test.tsx',
            line: 10,
            column: 5,
            buildId: 'build123',
        });

        expect(token1).not.toBe(token2);
    });

    it('should generate different tokens for different positions', () => {
        const token1 = generateRecoveryToken({
            mode: 'csr',
            component: 'TestComponent',
            filePath: '/app/test.tsx',
            line: 10,
            column: 5,
            buildId: 'build123',
        });

        const token2 = generateRecoveryToken({
            mode: 'csr',
            component: 'TestComponent',
            filePath: '/app/test.tsx',
            line: 20,
            column: 5,
            buildId: 'build123',
        });

        expect(token1).not.toBe(token2);
    });

    it('should generate different tokens for different build IDs', () => {
        const token1 = generateRecoveryToken({
            mode: 'csr',
            component: 'TestComponent',
            filePath: '/app/test.tsx',
            line: 10,
            column: 5,
            buildId: 'build123',
        });

        const token2 = generateRecoveryToken({
            mode: 'csr',
            component: 'TestComponent',
            filePath: '/app/test.tsx',
            line: 10,
            column: 5,
            buildId: 'build456',
        });

        expect(token1).not.toBe(token2);
    });
});

describe('createRecoveryToken', () => {
    it('should create token with full metadata', () => {
        const result = createRecoveryToken(
            {
                mode: 'csr',
                component: 'TestComponent',
                filePath: '/app/test.tsx',
                line: 10,
                column: 5,
            },
            'build123',
        );

        expect(result.token).toHaveLength(12);
        expect(result.metadata.mode).toBe('csr');
        expect(result.metadata.component).toBe('TestComponent');
        expect(result.metadata.filePath).toBe('/app/test.tsx');
        expect(result.metadata.line).toBe(10);
        expect(result.metadata.column).toBe(5);
        expect(result.metadata.buildId).toBe('build123');
    });
});

describe('validateSzRecover', () => {
    it('should validate valid modes', () => {
        const result1 = validateSzRecover('csr', 'TestComponent');
        expect(result1.valid).toBe(true);
        expect(result1.error).toBeUndefined();

        const result2 = validateSzRecover('dev-only', 'TestComponent');
        expect(result2.valid).toBe(true);
        expect(result2.error).toBeUndefined();
    });

    it('should reject invalid modes', () => {
        const result = validateSzRecover('invalid', 'TestComponent');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('TestComponent');
        expect(result.error).toContain('csr');
        expect(result.error).toContain('dev-only');
    });

    it('should reject non-string values', () => {
        const result1 = validateSzRecover(42, 'TestComponent');
        expect(result1.valid).toBe(false);

        const result2 = validateSzRecover(null, 'TestComponent');
        expect(result2.valid).toBe(false);

        const result3 = validateSzRecover(undefined, 'TestComponent');
        expect(result3.valid).toBe(false);
    });
});

describe('injectRecoveryToken', () => {
    it('should inject token into attributes', () => {
        const attrs = { szRecover: 'csr', className: 'foo' };
        const result = injectRecoveryToken(attrs, 'abc123');

        expect(result.szRecover).toBe('csr');
        expect(result.className).toBe('foo');
        expect(result['data-sz-recovery-token']).toBe('abc123');
    });

    it('should preserve existing attributes', () => {
        const attrs = {
            szRecover: 'csr',
            className: 'foo',
            id: 'test',
            'data-custom': 'value',
        };
        const result = injectRecoveryToken(attrs, 'abc123');

        expect(result.szRecover).toBe('csr');
        expect(result.className).toBe('foo');
        expect(result.id).toBe('test');
        expect(result['data-custom']).toBe('value');
        expect(result['data-sz-recovery-token']).toBe('abc123');
    });

    it('should work with empty attributes', () => {
        const result = injectRecoveryToken({}, 'abc123');
        expect(result['data-sz-recovery-token']).toBe('abc123');
    });
});
