/**
 * Where the development sz warnings may print: in Node, and in the browser
 * only under the development CDN bundle's build flag.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    szNodeWarningsUnmuted,
    szWarningsQuiet,
    withSzWarningsMuted,
} from '../src/sz-dev-warnings.js';

describe('szNodeWarningsUnmuted', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('lets a warning print in Node', () => {
        expect(szNodeWarningsUnmuted()).toBe(true);
    });

    it('keeps a warning out of a browser bundle, which a server render already printed it from', () => {
        vi.stubGlobal('window', {});
        expect(szNodeWarningsUnmuted()).toBe(false);
    });

    it('lets a warning print in the browser under the development CDN bundle flag', () => {
        vi.stubGlobal('window', {});
        vi.stubGlobal('__CSSZYX_SZ_WARNINGS_IN_BROWSER__', true);
        expect(szNodeWarningsUnmuted()).toBe(true);
    });

    it('stays muted by CSSZYX_QUIET_SZ_WARNINGS under the flag', () => {
        vi.stubGlobal('window', {});
        vi.stubGlobal('__CSSZYX_SZ_WARNINGS_IN_BROWSER__', true);
        vi.stubEnv('CSSZYX_QUIET_SZ_WARNINGS', '1');
        expect(szNodeWarningsUnmuted()).toBe(false);
    });
});

describe('withSzWarningsMuted', () => {
    it('mutes both gates inside a run, nested runs too, and only there', () => {
        expect([szNodeWarningsUnmuted(), szWarningsQuiet()]).toEqual([true, false]);
        const inside = withSzWarningsMuted(() => {
            const nested = withSzWarningsMuted(() => [szNodeWarningsUnmuted(), szWarningsQuiet()]);
            return [nested.result, [szNodeWarningsUnmuted(), szWarningsQuiet()]];
        });
        expect(inside.result).toEqual([
            [false, true],
            [false, true],
        ]);
        // Each gate asked inside counts as a warning held back, the nested
        // run's two included.
        expect(inside.held).toBe(4);
        expect([szNodeWarningsUnmuted(), szWarningsQuiet()]).toEqual([true, false]);
    });

    it('counts no held warning for a run that asks no gate', () => {
        expect(withSzWarningsMuted(() => 'quiet')).toEqual({ result: 'quiet', held: 0 });
    });

    it('unmutes again when the run throws', () => {
        expect(() =>
            withSzWarningsMuted(() => {
                throw new Error('trial');
            }),
        ).toThrow('trial');
        expect([szNodeWarningsUnmuted(), szWarningsQuiet()]).toEqual([true, false]);
    });
});
