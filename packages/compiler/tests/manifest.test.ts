/**
 * Tests for manifest module.
 */

import { describe, expect, it } from 'vitest';

import {
    ManifestBuilder,
    parseManifest,
    serializeManifest,
    validateManifest,
} from '../src/manifest.js';

describe('ManifestBuilder', () => {
    it('should create empty builder', () => {
        const builder = new ManifestBuilder('build123');
        expect(builder.size()).toBe(0);
    });

    it('should add tokens', () => {
        const builder = new ManifestBuilder('build123');

        builder.addToken('token1', {
            mode: 'csr',
            component: 'Button',
            filePath: '/app/Button.tsx',
            line: 10,
            column: 5,
            buildId: 'build123',
        });

        expect(builder.size()).toBe(1);
        expect(builder.hasToken('token1')).toBe(true);
    });

    it('should add multiple tokens', () => {
        const builder = new ManifestBuilder('build123');

        builder.addToken('token1', {
            mode: 'csr',
            component: 'Button',
            filePath: '/app/Button.tsx',
            line: 10,
            column: 5,
            buildId: 'build123',
        });

        builder.addToken('token2', {
            mode: 'dev-only',
            component: 'Input',
            filePath: '/app/Input.tsx',
            line: 20,
            column: 8,
            buildId: 'build123',
        });

        expect(builder.size()).toBe(2);
        expect(builder.hasToken('token1')).toBe(true);
        expect(builder.hasToken('token2')).toBe(true);
    });

    it('should build manifest', () => {
        const builder = new ManifestBuilder('build123');

        builder.addToken('token1', {
            mode: 'csr',
            component: 'Button',
            filePath: '/app/Button.tsx',
            line: 10,
            column: 5,
            buildId: 'build123',
        });

        const manifest = builder.build();

        expect(manifest.buildId).toBe('build123');
        expect(manifest.checksum).toBeTruthy();
        expect(manifest.tokens.token1).toBeDefined();
        expect(manifest.tokens.token1.mode).toBe('csr');
        expect(manifest.tokens.token1.component).toBe('Button');
    });

    it('should generate deterministic checksums', () => {
        const builder1 = new ManifestBuilder('build123');
        builder1.addToken('token1', {
            mode: 'csr',
            component: 'Button',
            filePath: '/app/Button.tsx',
            line: 10,
            column: 5,
            buildId: 'build123',
        });

        const builder2 = new ManifestBuilder('build123');
        builder2.addToken('token1', {
            mode: 'csr',
            component: 'Button',
            filePath: '/app/Button.tsx',
            line: 10,
            column: 5,
            buildId: 'build123',
        });

        const manifest1 = builder1.build();
        const manifest2 = builder2.build();

        expect(manifest1.checksum).toBe(manifest2.checksum);
    });

    it('should clear tokens', () => {
        const builder = new ManifestBuilder('build123');

        builder.addToken('token1', {
            mode: 'csr',
            component: 'Button',
            filePath: '/app/Button.tsx',
            line: 10,
            column: 5,
            buildId: 'build123',
        });

        expect(builder.size()).toBe(1);

        builder.clear();

        expect(builder.size()).toBe(0);
        expect(builder.hasToken('token1')).toBe(false);
    });

    it('should handle duplicate tokens', () => {
        const builder = new ManifestBuilder('build123');

        builder.addToken('token1', {
            mode: 'csr',
            component: 'Button',
            filePath: '/app/Button.tsx',
            line: 10,
            column: 5,
            buildId: 'build123',
        });

        builder.addToken('token1', {
            mode: 'dev-only',
            component: 'Input',
            filePath: '/app/Input.tsx',
            line: 20,
            column: 8,
            buildId: 'build123',
        });

        // Should overwrite
        expect(builder.size()).toBe(1);

        const manifest = builder.build();
        expect(manifest.tokens.token1.component).toBe('Input');
    });
});

describe('serializeManifest', () => {
    it('should serialize manifest to JSON', () => {
        const manifest = {
            buildId: 'build123',
            checksum: 'abc123',
            tokens: {
                token1: {
                    mode: 'csr' as const,
                    component: 'Button',
                    path: 'app/Button.tsx',
                },
            },
        };

        const json = serializeManifest(manifest);
        expect(typeof json).toBe('string');
        expect(JSON.parse(json)).toEqual(manifest);
    });

    it('should serialize with pretty formatting', () => {
        const manifest = {
            buildId: 'build123',
            checksum: 'abc123',
            tokens: {
                token1: {
                    mode: 'csr' as const,
                    component: 'Button',
                    path: 'app/Button.tsx',
                },
            },
        };

        const json = serializeManifest(manifest, true);
        expect(json).toContain('\n');
        expect(json).toContain('  ');
    });

    it('should serialize without formatting by default', () => {
        const manifest = {
            buildId: 'build123',
            checksum: 'abc123',
            tokens: {},
        };

        const json = serializeManifest(manifest);
        expect(json).not.toContain('\n');
    });
});

describe('parseManifest', () => {
    it('should parse valid manifest', () => {
        const json = JSON.stringify({
            buildId: 'build123',
            checksum: 'abc123',
            tokens: {
                token1: {
                    mode: 'csr',
                    component: 'Button',
                    path: 'app/Button.tsx',
                },
            },
        });

        const manifest = parseManifest(json);
        expect(manifest.buildId).toBe('build123');
        expect(manifest.checksum).toBe('abc123');
        expect(manifest.tokens.token1).toBeDefined();
    });

    it('should throw on invalid JSON', () => {
        expect(() => parseManifest('invalid json')).toThrow();
    });

    it('should throw on missing fields', () => {
        expect(() => parseManifest('{}')).toThrow();
        expect(() => parseManifest('{"buildId": "123"}')).toThrow();
        expect(() =>
            parseManifest('{"buildId": "123", "checksum": "abc"}'),
        ).toThrow();
    });
});

describe('validateManifest', () => {
    it('should validate correct manifest', () => {
        const manifest = {
            buildId: 'build123',
            checksum: 'abc123',
            tokens: {},
        };

        const result = validateManifest(manifest);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it('should reject non-objects', () => {
        expect(validateManifest(null).valid).toBe(false);
        expect(validateManifest(undefined).valid).toBe(false);
        expect(validateManifest('string').valid).toBe(false);
        expect(validateManifest(42).valid).toBe(false);
    });

    it('should reject missing buildId', () => {
        const result = validateManifest({
            checksum: 'abc123',
            tokens: {},
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('buildId');
    });

    it('should reject missing checksum', () => {
        const result = validateManifest({
            buildId: 'build123',
            tokens: {},
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('checksum');
    });

    it('should reject missing tokens', () => {
        const result = validateManifest({
            buildId: 'build123',
            checksum: 'abc123',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('tokens');
    });

    it('should reject invalid field types', () => {
        const result1 = validateManifest({
            buildId: 123,
            checksum: 'abc123',
            tokens: {},
        });
        expect(result1.valid).toBe(false);

        const result2 = validateManifest({
            buildId: 'build123',
            checksum: 123,
            tokens: {},
        });
        expect(result2.valid).toBe(false);

        const result3 = validateManifest({
            buildId: 'build123',
            checksum: 'abc123',
            tokens: 'invalid',
        });
        expect(result3.valid).toBe(false);
    });
});
