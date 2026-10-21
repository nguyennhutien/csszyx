/**
 * Where the development sz warnings may print: in Node, and in the browser
 * only under the development CDN bundle's build flag.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { szNodeWarningsUnmuted } from '../src/sz-dev-warnings.js';

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
