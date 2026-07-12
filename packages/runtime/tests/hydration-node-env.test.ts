// @vitest-environment node
/**
 * hydration.ts guards nearly every exported function with a
 * `typeof document === 'undefined'` or `typeof window === 'undefined'`
 * check for SSR safety. The package's default jsdom environment means
 * document/window are always defined in every other suite, so those guards
 * were never exercised for real. This file opts into a genuine node
 * environment (no DOM globals) to hit them, mirroring verify-node-env.test.ts
 * and the packages/dynamic node/jsdom split.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
    disableCSRRecovery,
    enableCSRRecovery,
    endHydration,
    getSSRContext,
    guardHydration,
    isCSRRecoveryAllowed,
    isHydrating,
    loadMangleMapFromDOM,
    startHydration,
    verifyMangleChecksum,
    verifyMangleMapIntegrity,
} from '../src/hydration.js';

describe('hydration guards without a DOM/window (SSR)', () => {
    afterEach(() => {
        disableCSRRecovery();
    });

    it('confirms this suite really has no document/window', () => {
        expect(typeof document).toBe('undefined');
        expect(typeof window).toBe('undefined');
    });

    it('loadMangleMapFromDOM returns null', () => {
        expect(loadMangleMapFromDOM()).toBeNull();
    });

    it('verifyMangleChecksum returns false', () => {
        expect(verifyMangleChecksum('anything')).toBe(false);
    });

    it('verifyMangleMapIntegrity returns false', () => {
        expect(verifyMangleMapIntegrity()).toBe(false);
    });

    it('guardHydration returns true (nothing to guard without a DOM)', () => {
        expect(
            guardHydration({
                buildId: 'b',
                checksum: 'c',
                mangleChecksum: 'm',
                tokens: {},
            }),
        ).toBe(true);
    });

    it('isHydrating returns false', () => {
        expect(isHydrating()).toBe(false);
    });

    it('getSSRContext returns null', () => {
        expect(getSSRContext()).toBeNull();
    });

    it('enableCSRRecovery / disableCSRRecovery still toggle internal state without touching window', () => {
        expect(isCSRRecoveryAllowed()).toBe(false);
        enableCSRRecovery();
        expect(isCSRRecoveryAllowed()).toBe(true);
        disableCSRRecovery();
        expect(isCSRRecoveryAllowed()).toBe(false);
    });

    it('startHydration / endHydration are no-ops without window (do not throw)', () => {
        expect(() => startHydration()).not.toThrow();
        expect(() => endHydration()).not.toThrow();
    });
});
