import { describe, expect, it } from 'vitest';

import { createNextCacheIdentity, stableStringify } from '../src/next-cache-identity.js';

describe('Next cache identity', () => {
    it('stable-stringifies objects independent of key insertion order', () => {
        expect(
            stableStringify({
                b: 2,
                a: { y: true, x: ['p-4', null] },
            }),
        ).toBe(stableStringify({ a: { x: ['p-4', null], y: true }, b: 2 }));
    });

    it('normalizes unsupported runtime values like JSON.stringify does in objects', () => {
        expect(stableStringify(undefined as never)).toBe('null');
        expect(stableStringify({ omitted: undefined, kept: null })).toBe('{"kept":null}');
    });

    it('hashes only explicit env keys', () => {
        const base = {
            root: '/repo/apps/web',
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development' as const,
            envKeys: ['NEXT_PUBLIC_THEME'],
        };

        const first = createNextCacheIdentity({
            ...base,
            env: {
                NEXT_PUBLIC_THEME: 'dark',
                SECRET_TOKEN: 'do-not-hash',
            },
        });
        const ignoredSecretChange = createNextCacheIdentity({
            ...base,
            env: {
                NEXT_PUBLIC_THEME: 'dark',
                SECRET_TOKEN: 'changed',
            },
        });
        const relevantEnvChange = createNextCacheIdentity({
            ...base,
            env: {
                NEXT_PUBLIC_THEME: 'light',
                SECRET_TOKEN: 'changed',
            },
        });

        expect(ignoredSecretChange.envHash).toBe(first.envHash);
        expect(ignoredSecretChange.generation).toBe(first.generation);
        expect(relevantEnvChange.envHash).not.toBe(first.envHash);
        expect(relevantEnvChange.generation).not.toBe(first.generation);
    });

    it('changes generation when config, root, mode, or versions change', () => {
        const base = {
            root: '/repo/apps/web',
            config: { mangleVars: false },
            env: {},
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development' as const,
        };
        const first = createNextCacheIdentity(base);

        expect(
            createNextCacheIdentity({ ...base, config: { mangleVars: true } }).generation,
        ).not.toBe(first.generation);
        expect(createNextCacheIdentity({ ...base, root: '/repo/apps/docs' }).generation).not.toBe(
            first.generation,
        );
        expect(createNextCacheIdentity({ ...base, mode: 'production' }).generation).not.toBe(
            first.generation,
        );
        expect(createNextCacheIdentity({ ...base, nextVersion: '16.3.0' }).generation).not.toBe(
            first.generation,
        );
        expect(createNextCacheIdentity({ ...base, csszyxVersion: '0.10.0' }).generation).not.toBe(
            first.generation,
        );
        expect(
            createNextCacheIdentity({ ...base, nativeVersion: '0.9.0-linux-x64-gnu' }).generation,
        ).not.toBe(first.generation);
    });
});
