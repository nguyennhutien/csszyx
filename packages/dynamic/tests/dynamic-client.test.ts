// @vitest-environment jsdom
/**
 * The browser injection path of dynamic(): with a DOM present `isServer` is
 * false, so it looks up the manifest and injects a CSS rule per unknown class.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, dynamic } from '../src/index.js';

afterEach(() => cleanup());

describe('dynamic() in the browser', () => {
    it('injects a rule for an unknown class and returns it', () => {
        const cls = dynamic({ p: 4, bg: 'blue-500' });
        expect(cls).toContain('p-4');
        expect(cls).toContain('bg-blue-500');
    });
});
