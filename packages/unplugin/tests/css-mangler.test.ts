/**
 * CSS Mangler Test Suite - 50+ Edge Cases for Zero-Risk Delivery.
 *
 * Tests cover:
 * - Basic class selectors
 * - Pseudo-classes and pseudo-elements
 * - Combinators
 * - Media queries and @rules
 * - Tailwind-specific escapes
 * - Arbitrary values
 * - Multi-class selectors
 * - No-mangle scenarios (CSS variables, IDs, attributes)
 * - Edge cases and stress tests
 */

import { describe, expect, it } from 'vitest';

import { escapeCSSClassName, mangleCSSSync, unescapeTailwindClass } from '../src/css-mangler';

// Test mangle map - simulates real-world usage
const testMangleMap = {
    'p-4': 'a',
    'm-4': 'b',
    'bg-red-500': 'c',
    'text-white': 'd',
    'hover:bg-blue-500': 'e',
    'focus:ring-2': 'f',
    'dark:bg-gray-900': 'g',
    'md:p-8': 'h',
    'lg:flex': 'i',
    '2xl:p-12': 'j',
    'group-hover:opacity-100': 'k',
    'peer-focus:ring': 'l',
    'w-1/2': 'm',
    'p-0.5': 'n',
    'top-[117px]': 'o',
    'bg-[#123456]': 'p',
    'text-[14px]': 'q',
    '!p-4': 'r',
    flex: 's',
    hidden: 't',
    grid: 'u',
    'items-center': 'v',
    'justify-between': 'w',
    'space-x-4': 'x',
    'rounded-lg': 'y',
    'shadow-md': 'z',
    'transition-all': 'aa',
    'duration-300': 'ab',
    'ease-in-out': 'ac',
    'hover:scale-105': 'ad',
    'dark:hover:bg-gray-800': 'ae',
    'sm:hidden': 'af',
    'xl:grid-cols-4': 'ag',
    'min-w-0': 'ah',
    '-mt-4': 'ai',
    '-translate-x-1/2': 'aj',
    'bg-gradient-to-r': 'ak',
    'from-blue-500': 'al',
    'to-purple-600': 'am',
    'backdrop-blur-sm': 'an',
    'divide-y': 'ao',
    'divide-gray-200': 'ap',
    'first:mt-0': 'aq',
    'last:mb-0': 'ar',
    'odd:bg-gray-50': 'as',
    'even:bg-white': 'at',
    'placeholder:text-gray-400': 'au',
    'file:mr-4': 'av',
    'marker:text-blue-500': 'aw',
    'selection:bg-blue-200': 'ax',
    "before:content-['']": 'ay',
    'after:absolute': 'az',
};

// ============================================================================
// 1. Basic Class Selectors (5 tests)
// ============================================================================
describe('Basic Class Selectors', () => {
    it('should mangle a simple class selector', () => {
        const result = mangleCSSSync('.p-4 { padding: 1rem; }', testMangleMap);
        expect(result.css).toBe('.a { padding: 1rem; }');
        expect(result.transformedCount).toBe(1);
    });

    it('should mangle multiple rules', () => {
        const css = `.p-4 { padding: 1rem; }
.m-4 { margin: 1rem; }`;
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toContain('.a { padding: 1rem; }');
        expect(result.css).toContain('.b { margin: 1rem; }');
        expect(result.transformedCount).toBe(2);
    });

    it('should preserve classes not in mangle map', () => {
        const css = '.unknown-class { color: red; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.unknown-class { color: red; }');
        expect(result.transformedCount).toBe(0);
    });

    it('should handle empty CSS', () => {
        const result = mangleCSSSync('', testMangleMap);
        expect(result.css).toBe('');
        expect(result.transformedCount).toBe(0);
    });

    it('should handle CSS with only comments', () => {
        const css = '/* This is a comment */';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('/* This is a comment */');
        expect(result.transformedCount).toBe(0);
    });
});

// ============================================================================
// 2. Pseudo-classes and Pseudo-elements (8 tests)
// ============================================================================
describe('Pseudo-classes and Pseudo-elements', () => {
    it.each([
        [':hover', '.p-4:hover { padding: 2rem; }', '.a:hover { padding: 2rem; }'],
        [':focus', '.p-4:focus { outline: none; }', '.a:focus { outline: none; }'],
        [':active', '.p-4:active { opacity: 0.8; }', '.a:active { opacity: 0.8; }'],
        ['::before', '.p-4::before { content: ""; }', '.a::before { content: ""; }'],
        ['::after', '.p-4::after { content: ""; }', '.a::after { content: ""; }'],
        [
            ':first-child',
            '.p-4:first-child { margin-top: 0; }',
            '.a:first-child { margin-top: 0; }',
        ],
        [
            ':nth-child()',
            '.p-4:nth-child(2n) { background: gray; }',
            '.a:nth-child(2n) { background: gray; }',
        ],
        [
            'multiple pseudos',
            '.p-4:hover:focus { transform: scale(1.05); }',
            '.a:hover:focus { transform: scale(1.05); }',
        ],
    ])('mangles %s selectors', (_label, css, expected) => {
        expect(mangleCSSSync(css, testMangleMap).css).toBe(expected);
    });
});

// ============================================================================
// 3. Combinators (6 tests)
// ============================================================================
describe('Combinators', () => {
    it.each([
        ['descendant', '.dark .p-4 { padding: 1rem; }', '.dark .a { padding: 1rem; }'],
        ['child', '.flex > .p-4 { padding: 1rem; }', '.s > .a { padding: 1rem; }'],
        [
            'adjacent sibling',
            '.p-4 + .m-4 { margin-left: 1rem; }',
            '.a + .b { margin-left: 1rem; }',
        ],
        [
            'general sibling',
            '.p-4 ~ .m-4 { margin-left: 0.5rem; }',
            '.a ~ .b { margin-left: 0.5rem; }',
        ],
        [
            'complex chain',
            '.dark .flex > .p-4:hover { opacity: 1; }',
            '.dark .s > .a:hover { opacity: 1; }',
        ],
        [
            'group-hover chain',
            '.group:hover .group-hover\\:opacity-100 { opacity: 1; }',
            '.group:hover .k { opacity: 1; }',
        ],
    ])('mangles a %s combinator', (_label, css, expected) => {
        expect(mangleCSSSync(css, testMangleMap).css).toBe(expected);
    });
});

// ============================================================================
// 4. Media Queries and @rules (6 tests)
// ============================================================================
describe('Media Queries and @rules', () => {
    it('should mangle classes inside media query', () => {
        const css = '@media (min-width: 768px) { .p-4 { padding: 2rem; } }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('@media (min-width: 768px) { .a { padding: 2rem; } }');
    });

    it('should mangle Tailwind responsive prefix class', () => {
        const css = '@media (min-width: 768px) { .md\\:p-8 { padding: 2rem; } }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('@media (min-width: 768px) { .h { padding: 2rem; } }');
    });

    it('should mangle classes inside @supports', () => {
        const css = '@supports (display: grid) { .grid { display: grid; } }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('@supports (display: grid) { .u { display: grid; } }');
    });

    it('should mangle classes inside @layer', () => {
        const css = '@layer utilities { .p-4 { padding: 1rem; } }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('@layer utilities { .a { padding: 1rem; } }');
    });

    it('should handle nested @rules', () => {
        const css = `@media (min-width: 1024px) {
            @supports (display: flex) {
                .flex { display: flex; }
            }
        }`;
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toContain('.s { display: flex; }');
    });

    it('should preserve @keyframes', () => {
        const css =
            '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe(css);
        expect(result.transformedCount).toBe(0);
    });
});

// ============================================================================
// 5. Tailwind-specific Escapes (10 tests)
// ============================================================================
describe('Tailwind-specific Escapes', () => {
    it('should mangle hover: variant class', () => {
        const css = '.hover\\:bg-blue-500:hover { background: blue; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.e:hover { background: blue; }');
    });

    it('should mangle focus: variant class', () => {
        const css = '.focus\\:ring-2:focus { ring-width: 2px; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.f:focus { ring-width: 2px; }');
    });

    it('should mangle dark: variant class', () => {
        const css = '.dark .dark\\:bg-gray-900 { background: #111827; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.dark .g { background: #111827; }');
    });

    it('should mangle md: responsive prefix', () => {
        const css = '@media (min-width: 768px) { .md\\:p-8 { padding: 2rem; } }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('@media (min-width: 768px) { .h { padding: 2rem; } }');
    });

    it('should mangle 2xl: responsive prefix with numeric escape', () => {
        const css = '@media (min-width: 1536px) { .\\32 xl\\:p-12 { padding: 3rem; } }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('@media (min-width: 1536px) { .j { padding: 3rem; } }');
    });

    it('should mangle class with forward slash (fractions)', () => {
        const css = '.w-1\\/2 { width: 50%; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.m { width: 50%; }');
    });

    it('should mangle class with dot (decimals)', () => {
        const css = '.p-0\\.5 { padding: 0.125rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.n { padding: 0.125rem; }');
    });

    it('should mangle important modifier class', () => {
        const css = '.\\!p-4 { padding: 1rem !important; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.r { padding: 1rem !important; }');
    });

    it('should mangle negative value class', () => {
        const css = '.-mt-4 { margin-top: -1rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.ai { margin-top: -1rem; }');
    });

    it('should mangle complex nested variant', () => {
        const css = '.dark .dark\\:hover\\:bg-gray-800:hover { background: #1f2937; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.dark .ae:hover { background: #1f2937; }');
    });
});

// ============================================================================
// 6. Arbitrary Values (6 tests)
// ============================================================================
describe('Arbitrary Values', () => {
    it('should mangle arbitrary pixel value', () => {
        const css = '.top-\\[117px\\] { top: 117px; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.o { top: 117px; }');
    });

    it('should mangle arbitrary hex color', () => {
        const css = '.bg-\\[\\#123456\\] { background: #123456; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.p { background: #123456; }');
    });

    it('should mangle arbitrary font size', () => {
        const css = '.text-\\[14px\\] { font-size: 14px; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.q { font-size: 14px; }');
    });

    it('should mangle before:content empty string class (before:content)', () => {
        // Build the selector from the class name so we don't have to hand-write the escaping
        const selector = `.${escapeCSSClassName("before:content-['']")}::before`;
        const css = `${selector} { content: ''; }`;
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toContain('.ay::before');
    });

    it('should mangle negative arbitrary value', () => {
        const css = '.-translate-x-1\\/2 { transform: translateX(-50%); }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.aj { transform: translateX(-50%); }');
    });

    it('should preserve unmatched arbitrary value class', () => {
        const css = '.bg-\\[rgba\\(255\\,0\\,0\\,0\\.5\\)\\] { background: rgba(255,0,0,0.5); }';
        const result = mangleCSSSync(css, testMangleMap);
        // Should not be mangled since it's not in the map
        expect(result.transformedCount).toBe(0);
    });
});

// ============================================================================
// 7. Multi-class Selectors (5 tests)
// ============================================================================
describe('Multi-class Selectors', () => {
    it('should mangle multiple classes on same element', () => {
        const css = '.p-4.m-4 { padding: 1rem; margin: 1rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.a.b { padding: 1rem; margin: 1rem; }');
    });

    it('should mangle three classes on same element', () => {
        const css = '.flex.items-center.justify-between { display: flex; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.s.v.w { display: flex; }');
    });

    it('should mangle comma-separated selectors', () => {
        const css = '.p-4, .m-4 { box-sizing: border-box; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.a, .b { box-sizing: border-box; }');
    });

    it('should handle mixed known and unknown classes', () => {
        const css = '.p-4.custom-class { padding: 1rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.a.custom-class { padding: 1rem; }');
    });

    it('should mangle complex multi-class with pseudo', () => {
        const css = '.flex.items-center:hover { opacity: 1; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.s.v:hover { opacity: 1; }');
    });
});

// ============================================================================
// 8. No-mangle Scenarios (8 tests)
// ============================================================================
describe('No-mangle Scenarios', () => {
    it('should NOT mangle CSS variables in values', () => {
        const css = '.p-4 { padding: var(--p-4); }';
        const result = mangleCSSSync(css, testMangleMap);
        // Class should be mangled but variable should not
        expect(result.css).toBe('.a { padding: var(--p-4); }');
    });

    it('should NOT mangle CSS variable definitions', () => {
        const css = ':root { --p-4: 1rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe(':root { --p-4: 1rem; }');
    });

    it('should NOT mangle ID selectors', () => {
        const css = '#p-4 { padding: 1rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('#p-4 { padding: 1rem; }');
    });

    it('should NOT mangle attribute selectors', () => {
        const css = '[class="p-4"] { padding: 1rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('[class="p-4"] { padding: 1rem; }');
    });

    it('should NOT mangle element selectors', () => {
        const css = 'div { padding: 1rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('div { padding: 1rem; }');
    });

    it('should NOT mangle * universal selector', () => {
        const css = '* { box-sizing: border-box; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('* { box-sizing: border-box; }');
    });

    it('should NOT mangle data attributes', () => {
        const css = '[data-p-4] { padding: 1rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('[data-p-4] { padding: 1rem; }');
    });

    it('should NOT mangle partial class matches', () => {
        // .p-40 should NOT become .a0 because p-4 maps to a
        const css = '.p-40 { padding: 10rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.p-40 { padding: 10rem; }');
        expect(result.transformedCount).toBe(0);
    });
});

// ============================================================================
// 9. Edge Cases and Stress Tests (10 tests)
// ============================================================================
describe('Edge Cases and Stress Tests', () => {
    it('should handle selector with multiple escapes', () => {
        const css = '.\\32 xl\\:p-12:hover { padding: 3rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.j:hover { padding: 3rem; }');
    });

    it('should handle empty mangle map', () => {
        const css = '.p-4 { padding: 1rem; }';
        const result = mangleCSSSync(css, {});
        expect(result.css).toBe('.p-4 { padding: 1rem; }');
        expect(result.transformedCount).toBe(0);
    });

    it('should handle very long selector', () => {
        const css =
            '.dark .group:hover .flex > .items-center.justify-between:first-child .p-4 { opacity: 1; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.dark .group:hover .s > .v.w:first-child .a { opacity: 1; }');
    });

    it('should preserve CSS structure and formatting', () => {
        const css = `.p-4 {
    padding: 1rem;
    margin: 0;
}`;
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toContain('.a {');
        expect(result.css).toContain('padding: 1rem;');
    });

    it('should handle special Tailwind peer selector', () => {
        const css = '.peer:focus ~ .peer-focus\\:ring { ring-width: 2px; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.peer:focus ~ .l { ring-width: 2px; }');
    });

    it('should handle first/last/odd/even variants', () => {
        const css = '.first\\:mt-0:first-child { margin-top: 0; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.aq:first-child { margin-top: 0; }');
    });

    it('should handle placeholder variant', () => {
        const css = '.placeholder\\:text-gray-400::placeholder { color: #9ca3af; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.au::placeholder { color: #9ca3af; }');
    });

    it('should handle file input variant', () => {
        const css = '.file\\:mr-4::file-selector-button { margin-right: 1rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.av::file-selector-button { margin-right: 1rem; }');
    });

    it('should handle marker variant', () => {
        const css = '.marker\\:text-blue-500::marker { color: #3b82f6; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.aw::marker { color: #3b82f6; }');
    });

    it('should handle selection variant', () => {
        const css = '.selection\\:bg-blue-200::selection { background: #bfdbfe; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe('.ax::selection { background: #bfdbfe; }');
    });
});

// ============================================================================
// 10. Unescape/Escape Functions (5 tests)
// ============================================================================
describe('Unescape/Escape Functions', () => {
    it('should unescape simple backslash', () => {
        expect(unescapeTailwindClass('hover\\:bg-blue-500')).toBe('hover:bg-blue-500');
    });

    it('should unescape numeric hex code', () => {
        expect(unescapeTailwindClass('\\32 xl\\:p-12')).toBe('2xl:p-12');
    });

    it('should unescape forward slash', () => {
        expect(unescapeTailwindClass('w-1\\/2')).toBe('w-1/2');
    });

    it('should unescape dot', () => {
        expect(unescapeTailwindClass('p-0\\.5')).toBe('p-0.5');
    });

    it('should escape class name for CSS', () => {
        expect(escapeCSSClassName('hover:bg-blue-500')).toBe('hover\\:bg-blue-500');
    });
});

// ============================================================================
// 11. Additional Coverage for 50+ Tests
// ============================================================================
describe('Additional Coverage', () => {
    it('should handle gradient classes', () => {
        const css =
            '.bg-gradient-to-r { background-image: linear-gradient(to right, var(--tw-gradient-stops)); }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toContain('.ak {');
    });

    it('should handle backdrop filter classes', () => {
        const css = '.backdrop-blur-sm { backdrop-filter: blur(4px); }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toContain('.an {');
    });

    it('should handle divide utilities', () => {
        const css = '.divide-y > :not([hidden]) ~ :not([hidden]) { border-top-width: 1px; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toContain('.ao >');
    });

    it('should handle space utilities', () => {
        const css = '.space-x-4 > :not([hidden]) ~ :not([hidden]) { margin-left: 1rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toContain('.x >');
    });

    it('should return correct mangledClasses list', () => {
        const css = '.p-4 { padding: 1rem; } .m-4 { margin: 1rem; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.mangledClasses).toContain('p-4');
        expect(result.mangledClasses).toContain('m-4');
    });

    it('should return correct unmangledClasses list', () => {
        const css = '.custom-class { color: red; }';
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.unmangledClasses).toContain('custom-class');
    });
});
