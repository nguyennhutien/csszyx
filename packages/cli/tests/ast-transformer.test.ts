import { describe, expect, it } from 'vitest';

import { transformSourceSimple } from '../src/migrate/ast-transformer.js';
import { generateSzExpression } from '../src/migrate/sz-codegen.js';

describe('sz-codegen', () => {
    it('simple object', () => {
        const result = generateSzExpression({ p: 4, bg: 'blue-500' });
        expect(result).toBe("{{ p: 4, bg: 'blue-500' }}");
    });

    it('boolean values', () => {
        const result = generateSzExpression({ display: 'flex', position: 'relative' });
        expect(result).toBe("{{ display: 'flex', position: 'relative' }}");
    });

    it('nested variant', () => {
        const result = generateSzExpression({
            hover: { bg: 'blue-600' },
        });
        expect(result).toContain('hover');
        expect(result).toContain("bg: 'blue-600'");
    });

    it('quoted keys for @ prefix', () => {
        const result = generateSzExpression({ '@md': { display: 'flex' } });
        expect(result).toContain("'@md'");
    });

    it('color+opacity object', () => {
        const result = generateSzExpression({
            bg: { color: 'blue-500', op: 50 },
        });
        expect(result).toContain("color: 'blue-500'");
        expect(result).toContain('op: 50');
    });

    it('gradient object', () => {
        const result = generateSzExpression({
            bgImg: { gradient: 'linear', dir: 'to-r' },
        });
        expect(result).toContain("gradient: 'linear'");
        expect(result).toContain("dir: 'to-r'");
    });

    it('gradient with numeric dir', () => {
        const result = generateSzExpression({
            bgImg: { gradient: 'linear', dir: 45 },
        });
        expect(result).toContain('dir: 45');
    });

    it('gradient with color interpolation', () => {
        const result = generateSzExpression({
            bgImg: { gradient: 'linear', dir: 'to-r', in: 'hsl' },
        });
        expect(result).toContain("in: 'hsl'");
    });

    it('deep nesting uses multi-line', () => {
        const result = generateSzExpression({
            p: 4,
            bg: 'blue-500',
            hover: { bg: 'blue-600' },
        });
        // Should have newlines for >2 entries with nesting
        expect(result).toContain('\n');
    });

    it('number values stay as numbers', () => {
        const result = generateSzExpression({ p: 4, opacity: 50 });
        expect(result).toContain('p: 4');
        expect(result).toContain('opacity: 50');
    });

    it('negative numbers', () => {
        const result = generateSzExpression({ mt: -4 });
        expect(result).toContain('mt: -4');
    });

    it('keys with hyphens get quoted', () => {
        const result = generateSzExpression({ 'display:grid': { display: 'flex' } });
        expect(result).toContain("'display:grid'");
    });
});

describe('ast-transformer (simple)', () => {
    it.each([
        {
            label: 'a static className',
            source: '<div className="p-4 bg-blue-500" />',
            changed: true,
            contains: ['sz=', 'p: 4', "bg: 'blue-500'"],
            excludes: ['className='],
        },
        {
            label: 'a variant',
            source: '<div className="p-4 hover:bg-blue-600" />',
            changed: true,
            contains: ['hover', "bg: 'blue-600'"],
        },
        {
            label: 'an unrecognized class',
            source: '<div className="p-4 my-custom-class" />',
            changed: true,
            contains: ['className="my-custom-class"', 'sz='],
        },
        { label: 'an empty className', source: '<div className="" />', changed: false },
        {
            label: 'multiple elements',
            source: '<div className="p-4 bg-blue-500"><span className="text-white font-bold">Hello</span></div>',
            changed: true,
            stats: { classNamesTransformed: 2 },
        },
        {
            label: 'a single-quoted className',
            source: "<div className='p-4 bg-blue-500' />",
            changed: true,
            contains: ['sz='],
        },
        {
            label: 'one transformed className',
            source: '<div className="p-4 flex" />',
            stats: { classNamesTransformed: 1 },
        },
        {
            label: 'a component className',
            source: '<div className="p-4"><Card className="m-2" /></div>',
            contains: ['<Card className="m-2"'],
            stats: {
                classNamesTransformed: 1,
                classNamesSkipped: 0,
                classNamesSkippedComponent: 1,
            },
        },
        {
            label: 'an unrecognized class in a skipped template',
            source: 'const A = () => <div className={`text-sm sport-neon ${color(x)}`} />;',
            changed: false,
            unrecognized: ['sport-neon'],
        },
        {
            label: 'conflicting display classes',
            source: '<div className="flex relative hidden" />',
            changed: true,
            contains: ['className="flex hidden"', "position: 'relative'"],
        },
        {
            label: 'non-className attributes',
            source: '<div id="test" className="p-4" data-foo="bar" />',
            contains: ['id="test"', 'data-foo="bar"'],
        },
        {
            label: 'responsive state variants',
            source: '<div className="md:hover:bg-blue-600" />',
            changed: true,
            contains: ['md', 'hover'],
        },
    ])('handles $label', ({ source, changed, contains, excludes, stats, unrecognized }) => {
        const result = transformSourceSimple(source, 'test.tsx');
        if (changed !== undefined) expect(result.changed).toBe(changed);
        for (const fragment of contains ?? []) expect(result.code).toContain(fragment);
        for (const fragment of excludes ?? []) expect(result.code).not.toContain(fragment);
        if (stats) expect(result.stats).toMatchObject(stats);
        for (const className of unrecognized ?? []) {
            expect(result.stats.classesUnrecognized).toContain(className);
        }
    });

    it('does not transform dynamic classNames', () => {
        // This regex approach only handles string literals
        const source = '<div className={someVar} />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(false);
    });

    it.each([
        ['color opacity', '<div className="bg-blue-500/50" />', ["color: 'blue-500'", 'op: 50']],
        [
            'gradients',
            '<div className="bg-linear-to-r from-blue-500 to-red-500" />',
            ["gradient: 'linear'", "dir: 'to-r'"],
        ],
        ['important modifiers', '<div className="p-4!" />', ["'4!'"]],
        [
            'a complex component',
            '<button className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">Click me</button>',
            ['px: 4', 'py: 2', "bg: 'blue-500'", "color: 'white'"],
        ],
        ['container queries', '<div className="@md:flex @lg:grid" />', ["'@md'", "'@lg'"]],
        ['data attributes', '<div className="data-[active]:bg-blue-500" />', ['data', 'active']],
        ['negative values', '<div className="-mt-4 -rotate-45" />', ['mt: -4', 'rotate: -45']],
        ['arbitrary values', '<div className="w-[200px] p-[10px]" />', ["w: '200px'", "p: '10px'"]],
        ['CSS variable sugar', '<div className="p-(--spacing)" />', ["p: '--spacing'"]],
        ['fractions', '<div className="w-1/2 h-1/3" />', ["w: '1/2'", "h: '1/3'"]],
        [
            'multi-part prefixes',
            '<div className="col-span-3 grid-cols-12 place-content-center" />',
            ['colSpan: 3', 'gridCols: 12', "placeContent: 'center'"],
        ],
    ])('handles %s', (_label, source, expectedCode) => {
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        for (const fragment of expectedCode) expect(result.code).toContain(fragment);
    });
});
