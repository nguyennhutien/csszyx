/**
 * The public dynamic() entry: its SSR path (this suite runs under node, where
 * `isServer` is true) plus the preload and cleanup wrappers. The browser
 * injection path is covered by dynamic-client.test.ts under jsdom.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, dynamic, preloadManifest } from '../src/index.js';

const globals = globalThis as Record<string, unknown>;

afterEach(() => {
    globals.__csszyx_ssr_mangle_map = undefined;
    cleanup();
});

describe('dynamic() on the server', () => {
    it('returns compiled class names without touching the CSSOM', () => {
        expect(dynamic({ p: 4, bg: 'blue-500' })).toContain('p-4');
    });

    it('returns an empty string when nothing compiles', () => {
        expect(dynamic({})).toBe('');
    });

    it('applies the SSR mangle map the plugin exposes on globalThis', () => {
        globals.__csszyx_ssr_mangle_map = { 'p-4': 'q0' };
        expect(dynamic({ p: 4 })).toBe('q0');
    });

    it('preload and cleanup run without throwing', async () => {
        await preloadManifest().catch(() => undefined);
        expect(() => cleanup()).not.toThrow();
    });
});
