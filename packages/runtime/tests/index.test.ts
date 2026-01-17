/**
 * Tests for main index exports.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
    _sz,
    DEFAULT_RUNTIME_CONFIG,
    getRuntimeConfig,
    initRuntime,
    isRuntimeInitialized,
    resetRuntime,
    verifyRecoveryToken,
    VERSION,
} from '../src/index.js';

describe('index exports', () => {
    it('should export VERSION', () => {
        expect(VERSION).toBe('0.0.0');
    });

    it('should export _sz function', () => {
        expect(typeof _sz).toBe('function');
        expect(_sz('a', 'b')).toBe('a b');
    });

    it('should export verifyRecoveryToken function', () => {
        expect(typeof verifyRecoveryToken).toBe('function');
    });

    it('should export DEFAULT_RUNTIME_CONFIG', () => {
        expect(DEFAULT_RUNTIME_CONFIG).toBeDefined();
        expect(typeof DEFAULT_RUNTIME_CONFIG.development).toBe('boolean');
        expect(typeof DEFAULT_RUNTIME_CONFIG.allowCSRRecovery).toBe('boolean');
        expect(typeof DEFAULT_RUNTIME_CONFIG.strictHydration).toBe('boolean');
        expect(typeof DEFAULT_RUNTIME_CONFIG.debug).toBe('boolean');
    });
});

describe('initRuntime', () => {
    afterEach(() => {
        resetRuntime();
    });

    it('should initialize with default config', () => {
        initRuntime();
        expect(isRuntimeInitialized()).toBe(true);

        const config = getRuntimeConfig();
        expect(config).toBeDefined();
        expect(typeof config.development).toBe('boolean');
    });

    it('should initialize with custom config', () => {
        initRuntime({
            development: true,
            debug: true,
        });

        const config = getRuntimeConfig();
        expect(config.development).toBe(true);
        expect(config.debug).toBe(true);
    });

    it('should not re-initialize when already initialized', () => {
        initRuntime({ debug: true });
        const config1 = getRuntimeConfig();

        initRuntime({ debug: false });
        const config2 = getRuntimeConfig();

        // Config should not change
        expect(config2.debug).toBe(config1.debug);
    });

    it('should merge config with defaults', () => {
        initRuntime({
            development: true,
        });

        const config = getRuntimeConfig();
        expect(config.development).toBe(true);
        expect(typeof config.allowCSRRecovery).toBe('boolean');
        expect(typeof config.strictHydration).toBe('boolean');
        expect(typeof config.debug).toBe('boolean');
    });
});

describe('getRuntimeConfig', () => {
    afterEach(() => {
        resetRuntime();
    });

    it('should return default config before initialization', () => {
        const config = getRuntimeConfig();
        expect(config).toBeDefined();
        expect(typeof config.development).toBe('boolean');
    });

    it('should return custom config after initialization', () => {
        initRuntime({
            development: true,
            debug: true,
        });

        const config = getRuntimeConfig();
        expect(config.development).toBe(true);
        expect(config.debug).toBe(true);
    });

    it('should return a copy of config', () => {
        initRuntime({ debug: true });
        const config1 = getRuntimeConfig();
        const config2 = getRuntimeConfig();

        expect(config1).not.toBe(config2);
        expect(config1).toEqual(config2);
    });
});

describe('isRuntimeInitialized', () => {
    afterEach(() => {
        resetRuntime();
    });

    it('should return false before initialization', () => {
        expect(isRuntimeInitialized()).toBe(false);
    });

    it('should return true after initialization', () => {
        initRuntime();
        expect(isRuntimeInitialized()).toBe(true);
    });

    it('should return false after reset', () => {
        initRuntime();
        resetRuntime();
        expect(isRuntimeInitialized()).toBe(false);
    });
});

describe('resetRuntime', () => {
    it('should reset initialization state', () => {
        initRuntime();
        expect(isRuntimeInitialized()).toBe(true);

        resetRuntime();
        expect(isRuntimeInitialized()).toBe(false);
    });

    it('should reset config to defaults', () => {
        initRuntime({
            development: true,
            debug: true,
        });

        resetRuntime();

        const config = getRuntimeConfig();
        expect(config).toEqual(DEFAULT_RUNTIME_CONFIG);
    });
});
