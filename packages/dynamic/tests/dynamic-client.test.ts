// @vitest-environment jsdom
/**
 * The browser injection path of dynamic(): with a DOM present `isServer` is
 * false, so it looks up the manifest and injects a CSS rule per unknown class.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanup, dynamic, preloadManifest } from '../src/index.js';
import { isInjected } from '../src/injector.js';

afterEach(() => cleanup());

describe('dynamic() in the browser', () => {
    it('injects a rule for an unknown class and returns it', () => {
        const cls = dynamic({ p: 4, bg: 'blue-500' });
        expect(cls).toContain('p-4');
        expect(cls).toContain('bg-blue-500');
    });

    it('skips injection for a class already present in the pre-built manifest', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        version: '1.0.0',
                        buildId: 'test',
                        classes: ['p-4'],
                    }),
            }),
        );
        await preloadManifest('/csszyx-manifest.json');

        const cls = dynamic({ p: 4 });

        expect(cls).toBe('p-4');
        // The manifest already had it built — no runtime CSSOM injection needed.
        expect(isInjected('p-4')).toBe(false);

        vi.unstubAllGlobals();
    });
});
