/**
 * SSR-context and hydration-state helpers — the DOM/window readers the
 * hydration guard relies on. Exercised here directly against a jsdom document.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
    endHydration,
    getSSRContext,
    isHydrating,
    isSSREnvironment,
    startHydration,
    validateHydrationClass,
} from '../src/hydration.js';

interface HydrationWindow {
    __SZ_HYDRATING__?: boolean;
    __NEXT_DATA__?: unknown;
    __REMIX_CONTEXT__?: unknown;
}
const win = () => window as unknown as HydrationWindow;

afterEach(() => {
    win().__SZ_HYDRATING__ = undefined;
    win().__NEXT_DATA__ = undefined;
    win().__REMIX_CONTEXT__ = undefined;
    document.documentElement.removeAttribute('data-sz-checksum');
    document.documentElement.removeAttribute('data-sz-build-id');
    document.documentElement.removeAttribute('data-sz-timestamp');
    document.body.innerHTML = '';
});

describe('isSSREnvironment', () => {
    it('is false in a browser-like (jsdom) environment', () => {
        expect(isSSREnvironment()).toBe(false);
    });
});

describe('isHydrating', () => {
    it('is false by default and honours the explicit flag', () => {
        expect(isHydrating()).toBe(false);
        startHydration();
        expect(win().__SZ_HYDRATING__).toBe(true);
        expect(isHydrating()).toBe(true);
        endHydration();
        expect(isHydrating()).toBe(false);
    });

    it('infers hydration from a framework marker plus the SSR checksum attribute', () => {
        win().__SZ_HYDRATING__ = undefined;
        win().__NEXT_DATA__ = { props: {} };
        expect(isHydrating()).toBe(false);
        document.documentElement.setAttribute('data-sz-checksum', 'abc');
        expect(isHydrating()).toBe(true);
    });
});

describe('getSSRContext', () => {
    it('returns null until both checksum and build id are present', () => {
        expect(getSSRContext()).toBeNull();
        document.documentElement.setAttribute('data-sz-checksum', 'sum');
        expect(getSSRContext()).toBeNull();
    });

    it('reads the full context including timestamp and recovery-token presence', () => {
        document.documentElement.setAttribute('data-sz-checksum', 'sum');
        document.documentElement.setAttribute('data-sz-build-id', 'build-1');
        document.documentElement.setAttribute('data-sz-timestamp', '1700000000');
        document.body.innerHTML = '<div data-sz-recovery-token="t"></div>';

        expect(getSSRContext()).toEqual({
            buildId: 'build-1',
            checksum: 'sum',
            timestamp: 1_700_000_000,
            hasRecoveryTokens: true,
        });
    });

    it('defaults a missing timestamp to 0 and no recovery tokens to false', () => {
        document.documentElement.setAttribute('data-sz-checksum', 'sum');
        document.documentElement.setAttribute('data-sz-build-id', 'build-1');
        expect(getSSRContext()).toMatchObject({ timestamp: 0, hasRecoveryTokens: false });
    });
});

describe('validateHydrationClass', () => {
    it('matches regardless of class order or whitespace', () => {
        expect(validateHydrationClass('p-4 bg-red-500', 'bg-red-500  p-4')).toBe(true);
    });

    it('rejects a differing class set', () => {
        expect(validateHydrationClass('p-4', 'p-4 m-2')).toBe(false);
    });
});
