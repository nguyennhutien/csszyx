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
    it.each([
        [
            'media queries',
            '@media (min-width: 768px) { .p-4 { padding: 2rem; } }',
            '@media (min-width: 768px) { .a { padding: 2rem; } }',
        ],
        [
            'responsive media classes',
            '@media (min-width: 768px) { .md\\:p-8 { padding: 2rem; } }',
            '@media (min-width: 768px) { .h { padding: 2rem; } }',
        ],
        [
            '@supports',
            '@supports (display: grid) { .grid { display: grid; } }',
            '@supports (display: grid) { .u { display: grid; } }',
        ],
        [
            '@layer',
            '@layer utilities { .p-4 { padding: 1rem; } }',
            '@layer utilities { .a { padding: 1rem; } }',
        ],
    ])('mangles classes inside %s', (_label, css, expected) => {
        expect(mangleCSSSync(css, testMangleMap).css).toBe(expected);
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
    it.each([
        [
            'hover: variant class',
            '.hover\\:bg-blue-500:hover { background: blue; }',
            '.e:hover { background: blue; }',
        ],
        [
            'focus: variant class',
            '.focus\\:ring-2:focus { ring-width: 2px; }',
            '.f:focus { ring-width: 2px; }',
        ],
        [
            'dark: variant class',
            '.dark .dark\\:bg-gray-900 { background: #111827; }',
            '.dark .g { background: #111827; }',
        ],
        [
            'md: responsive prefix',
            '@media (min-width: 768px) { .md\\:p-8 { padding: 2rem; } }',
            '@media (min-width: 768px) { .h { padding: 2rem; } }',
        ],
        [
            '2xl: responsive prefix with numeric escape',
            '@media (min-width: 1536px) { .\\32 xl\\:p-12 { padding: 3rem; } }',
            '@media (min-width: 1536px) { .j { padding: 3rem; } }',
        ],
        ['class with forward slash (fractions)', '.w-1\\/2 { width: 50%; }', '.m { width: 50%; }'],
        [
            'class with dot (decimals)',
            '.p-0\\.5 { padding: 0.125rem; }',
            '.n { padding: 0.125rem; }',
        ],
        [
            'important modifier class',
            '.\\!p-4 { padding: 1rem !important; }',
            '.r { padding: 1rem !important; }',
        ],
        ['negative value class', '.-mt-4 { margin-top: -1rem; }', '.ai { margin-top: -1rem; }'],
        [
            'complex nested variant',
            '.dark .dark\\:hover\\:bg-gray-800:hover { background: #1f2937; }',
            '.dark .ae:hover { background: #1f2937; }',
        ],
    ])('should mangle %s', (_name, css, expectedCSS) => {
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe(expectedCSS);
    });
});

// ============================================================================
// 6. Arbitrary Values (6 tests)
// ============================================================================
describe('Arbitrary Values', () => {
    it.each([
        ['arbitrary pixel value', '.top-\\[117px\\] { top: 117px; }', '.o { top: 117px; }'],
        [
            'arbitrary hex color',
            '.bg-\\[\\#123456\\] { background: #123456; }',
            '.p { background: #123456; }',
        ],
        ['arbitrary font size', '.text-\\[14px\\] { font-size: 14px; }', '.q { font-size: 14px; }'],
        [
            'negative arbitrary value',
            '.-translate-x-1\\/2 { transform: translateX(-50%); }',
            '.aj { transform: translateX(-50%); }',
        ],
    ])('should mangle %s', (_name, css, expectedCSS) => {
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe(expectedCSS);
    });

    it('should mangle before:content empty string class (before:content)', () => {
        // Build the selector from the class name so we don't have to hand-write the escaping
        const selector = `.${escapeCSSClassName("before:content-['']")}::before`;
        const css = `${selector} { content: ''; }`;
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toContain('.ay::before');
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
    it.each([
        [
            'multiple classes on the same element',
            '.p-4.m-4 { padding: 1rem; margin: 1rem; }',
            '.a.b { padding: 1rem; margin: 1rem; }',
        ],
        [
            'three classes on the same element',
            '.flex.items-center.justify-between { display: flex; }',
            '.s.v.w { display: flex; }',
        ],
        [
            'comma-separated selectors',
            '.p-4, .m-4 { box-sizing: border-box; }',
            '.a, .b { box-sizing: border-box; }',
        ],
        [
            'mixed known and unknown classes',
            '.p-4.custom-class { padding: 1rem; }',
            '.a.custom-class { padding: 1rem; }',
        ],
        [
            'a complex multi-class selector with a pseudo-class',
            '.flex.items-center:hover { opacity: 1; }',
            '.s.v:hover { opacity: 1; }',
        ],
    ])('should mangle %s', (_name, css, expectedCSS) => {
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe(expectedCSS);
    });
});

// ============================================================================
// 8. No-mangle Scenarios (8 tests)
// ============================================================================
describe('No-mangle Scenarios', () => {
    it.each([
        ['CSS variables in values', '.p-4 { padding: var(--p-4); }', '.a { padding: var(--p-4); }'],
        ['CSS variable definitions', ':root { --p-4: 1rem; }', ':root { --p-4: 1rem; }'],
        ['ID selectors', '#p-4 { padding: 1rem; }', '#p-4 { padding: 1rem; }'],
        [
            'attribute selectors',
            '[class="p-4"] { padding: 1rem; }',
            '[class="p-4"] { padding: 1rem; }',
        ],
        ['element selectors', 'div { padding: 1rem; }', 'div { padding: 1rem; }'],
        [
            'the universal selector',
            '* { box-sizing: border-box; }',
            '* { box-sizing: border-box; }',
        ],
        ['data attributes', '[data-p-4] { padding: 1rem; }', '[data-p-4] { padding: 1rem; }'],
    ])('should not mangle %s', (_name, css, expectedCSS) => {
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe(expectedCSS);
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
    it.each([
        [
            'a selector with multiple escapes',
            '.\\32 xl\\:p-12:hover { padding: 3rem; }',
            '.j:hover { padding: 3rem; }',
        ],
        [
            'a very long selector',
            '.dark .group:hover .flex > .items-center.justify-between:first-child .p-4 { opacity: 1; }',
            '.dark .group:hover .s > .v.w:first-child .a { opacity: 1; }',
        ],
        [
            'the Tailwind peer selector',
            '.peer:focus ~ .peer-focus\\:ring { ring-width: 2px; }',
            '.peer:focus ~ .l { ring-width: 2px; }',
        ],
        [
            'the first variant',
            '.first\\:mt-0:first-child { margin-top: 0; }',
            '.aq:first-child { margin-top: 0; }',
        ],
        [
            'the placeholder variant',
            '.placeholder\\:text-gray-400::placeholder { color: #9ca3af; }',
            '.au::placeholder { color: #9ca3af; }',
        ],
        [
            'the file input variant',
            '.file\\:mr-4::file-selector-button { margin-right: 1rem; }',
            '.av::file-selector-button { margin-right: 1rem; }',
        ],
        [
            'the marker variant',
            '.marker\\:text-blue-500::marker { color: #3b82f6; }',
            '.aw::marker { color: #3b82f6; }',
        ],
        [
            'the selection variant',
            '.selection\\:bg-blue-200::selection { background: #bfdbfe; }',
            '.ax::selection { background: #bfdbfe; }',
        ],
    ])('should handle %s', (_name, css, expectedCSS) => {
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toBe(expectedCSS);
    });

    it('should handle empty mangle map', () => {
        const css = '.p-4 { padding: 1rem; }';
        const result = mangleCSSSync(css, {});
        expect(result.css).toBe('.p-4 { padding: 1rem; }');
        expect(result.transformedCount).toBe(0);
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
    it.each([
        [
            'gradient classes',
            '.bg-gradient-to-r { background-image: linear-gradient(to right, var(--tw-gradient-stops)); }',
            '.ak {',
        ],
        ['backdrop filter classes', '.backdrop-blur-sm { backdrop-filter: blur(4px); }', '.an {'],
        [
            'divide utilities',
            '.divide-y > :not([hidden]) ~ :not([hidden]) { border-top-width: 1px; }',
            '.ao >',
        ],
        [
            'space utilities',
            '.space-x-4 > :not([hidden]) ~ :not([hidden]) { margin-left: 1rem; }',
            '.x >',
        ],
    ])('should handle %s', (_name, css, expectedCSS) => {
        const result = mangleCSSSync(css, testMangleMap);
        expect(result.css).toContain(expectedCSS);
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
