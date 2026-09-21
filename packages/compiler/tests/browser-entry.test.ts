import { describe, expect, it } from 'vitest';

import * as browser from '../src/transform-core.js';

describe('compiler browser entry', () => {
    it('keeps the recursive transform helper private', () => {
        expect(browser).not.toHaveProperty('transformNested');
    });

    it('applies public options to nested values', () => {
        expect(
            browser.transform(
                { p: 4, hover: { p: 2 } },
                { prefix: 'md:', mangleMap: { 'md:p-4': 'a', 'md:hover:p-2': 'b' } },
            ),
        ).toEqual({ className: 'a b' });
    });
});
