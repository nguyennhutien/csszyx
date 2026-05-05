/**
 * Tests for main index exports.
 */

import { describe, expect, it } from 'vitest';

import {
    DEFAULT_COMPILER_OPTIONS,
    ManifestBuilder,
    mergeOptions,
    transform,
    VERSION,
} from '../src/index.js';

describe('index exports', () => {
    it('should export VERSION', () => {
        expect(VERSION).toBe('0.0.0');
    });

    it('should export transform function', () => {
        expect(typeof transform).toBe('function');
        const result = transform({ p: 4 });
        expect(result.className).toBe('p-4');
    });

    it('should export ManifestBuilder', () => {
        expect(ManifestBuilder).toBeDefined();
        const builder = new ManifestBuilder('test');
        expect(builder.size()).toBe(0);
    });

    it('should export DEFAULT_COMPILER_OPTIONS', () => {
        expect(DEFAULT_COMPILER_OPTIONS).toBeDefined();
        expect(DEFAULT_COMPILER_OPTIONS.buildId).toBeDefined();
        expect(typeof DEFAULT_COMPILER_OPTIONS.development).toBe('boolean');
        expect(typeof DEFAULT_COMPILER_OPTIONS.strictMode).toBe('boolean');
    });
});

describe('mergeOptions', () => {
    it('should return default options when no options provided', () => {
        const options = mergeOptions();
        expect(options.buildId).toBeDefined();
        expect(typeof options.development).toBe('boolean');
        expect(typeof options.strictMode).toBe('boolean');
    });

    it('should merge user options with defaults', () => {
        const options = mergeOptions({
            development: true,
            strictMode: true,
        });

        expect(options.development).toBe(true);
        expect(options.strictMode).toBe(true);
        expect(options.buildId).toBeDefined();
    });

    it('should override default options', () => {
        const customBuildId = 'custom-build-123';
        const options = mergeOptions({
            buildId: customBuildId,
            development: false,
            strictMode: true,
        });

        expect(options.buildId).toBe(customBuildId);
        expect(options.development).toBe(false);
        expect(options.strictMode).toBe(true);
    });

    it('should handle partial options', () => {
        const options = mergeOptions({
            development: true,
        });

        expect(options.development).toBe(true);
        expect(options.buildId).toBeDefined();
        expect(typeof options.strictMode).toBe('boolean');
    });

    it('should handle empty options object', () => {
        const options = mergeOptions({});
        expect(options.buildId).toBeDefined();
        expect(typeof options.development).toBe('boolean');
        expect(typeof options.strictMode).toBe('boolean');
    });
});
