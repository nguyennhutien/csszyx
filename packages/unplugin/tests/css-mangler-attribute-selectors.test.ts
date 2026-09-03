/**
 * The CSS mangler reports every `[class …]` attribute selector it walks past.
 *
 * It never rewrites one — an attribute selector matches the class attribute's
 * TEXT, and a mangled token carries no trace of the name it replaced, so
 * there is nothing correct to rewrite it to. What the build can do is say
 * which of the classes it renamed such a selector was matching by name
 * (field-reported: a dark theme keyed on `[class*="bg-tag"]` lost its alpha
 * the day mangling went on, and the build said nothing).
 */
import { describe, expect, it } from 'vitest';

import { mangleCSS, mangleCSSSync } from '../src/css-mangler.js';

const MAP = { 'bg-tag-blue-bg': 'y4', 'p-4': 'a' };

describe('class attribute selectors are collected, not rewritten', () => {
    it('reports operator, value and case flag for a class attribute selector', () => {
        const css = '.tag[class*="bg-tag"] { --a: 1 } [class^=\'text-tag\' i] { --b: 2 }';
        const result = mangleCSSSync(css, MAP);

        expect(result.classAttributeSelectors).toEqual([
            { operator: '*=', value: 'bg-tag', insensitive: false },
            { operator: '^=', value: 'text-tag', insensitive: true },
        ]);
        // The selector text is untouched — the contract the no-mangle suite pins.
        expect(result.css).toBe(css);
    });

    it('dedupes a selector repeated across rules and media queries', () => {
        const css =
            '[class*="bg-tag"] { --a: 1 } @media (min-width: 1px) { [class*="bg-tag"] { --a: 2 } }';
        expect(mangleCSSSync(css, MAP).classAttributeSelectors).toHaveLength(1);
    });

    it('walks into :is(), :where() and :not() arguments', () => {
        const css = '.a:is([class~=x], .b):not([class|="c"]) { --a: 1 }';
        expect(mangleCSSSync(css, MAP).classAttributeSelectors).toEqual([
            { operator: '~=', value: 'x', insensitive: false },
            { operator: '|=', value: 'c', insensitive: false },
        ]);
    });

    it('reads the attribute name case-insensitively and the value unescaped', () => {
        const css = '[CLASS$="hover\\:bg-red"] { --a: 1 }';
        expect(mangleCSSSync(css, MAP).classAttributeSelectors).toEqual([
            { operator: '$=', value: 'hover:bg-red', insensitive: false },
        ]);
    });

    it('ignores presence checks, empty values, other attributes and namespaces', () => {
        const css =
            '[class] { --a: 1 } [class*=""] { --b: 1 } [data-tag*="bg-tag"] { --c: 1 } [svg|class*="x"] { --d: 1 }';
        expect(mangleCSSSync(css, MAP).classAttributeSelectors).toEqual([]);
    });

    it('is reported by the async entry point too', async () => {
        const result = await mangleCSS('[class="p-4 m-2"] { --a: 1 }', MAP);
        expect(result.classAttributeSelectors).toEqual([
            { operator: '=', value: 'p-4 m-2', insensitive: false },
        ]);
    });
});
