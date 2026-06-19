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
        const result = generateSzExpression({ '@md': { flex: true } });
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
        const result = generateSzExpression({ 'display:grid': { flex: true } });
        expect(result).toContain("'display:grid'");
    });
});

describe('ast-transformer (simple)', () => {
    it('transforms static className', () => {
        const source = '<div className="p-4 bg-blue-500" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('sz=');
        expect(result.code).not.toContain('className=');
        expect(result.code).toContain('p: 4');
        expect(result.code).toContain("bg: 'blue-500'");
    });

    it('transforms with variant', () => {
        const source = '<div className="p-4 hover:bg-blue-600" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('hover');
        expect(result.code).toContain("bg: 'blue-600'");
    });

    it('preserves unrecognized classes in className', () => {
        const source = '<div className="p-4 my-custom-class" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('className="my-custom-class"');
        expect(result.code).toContain('sz=');
    });

    it('skips empty className', () => {
        const source = '<div className="" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(false);
    });

    it('handles multiple elements', () => {
        const source = `
<div className="p-4 bg-blue-500">
  <span className="text-white font-bold">Hello</span>
</div>`;
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.stats.classNamesTransformed).toBe(2);
    });

    it('handles single-quoted className', () => {
        const source = "<div className='p-4 bg-blue-500' />";
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('sz=');
    });

    it('reports stats correctly', () => {
        const source = '<div className="p-4 flex" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.stats.classNamesTransformed).toBe(1);
    });

    it('counts component classNames separately from dynamic skips', () => {
        const source = '<div className="p-4"><Card className="m-2" /></div>';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.stats.classNamesTransformed).toBe(1);
        expect(result.stats.classNamesSkipped).toBe(0);
        expect(result.stats.classNamesSkippedComponent).toBe(1);
        // The component className is intentionally left untouched.
        expect(result.code).toContain('<Card className="m-2"');
    });

    it('reports unrecognized classes inside a skipped template literal', () => {
        // The template literal is skipped (arbitrary call), but its static
        // custom class must still surface in the report instead of being hidden.
        const source = 'const A = () => <div className={`text-sm sport-neon ${color(x)}`} />;';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(false);
        expect(result.stats.classesUnrecognized).toContain('sport-neon');
    });

    it('keeps conflicting display classes in className', () => {
        const source = '<div className="flex relative hidden" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('className="flex hidden"');
        expect(result.code).toContain("position: 'relative'");
    });

    it('preserves non-className content', () => {
        const source = '<div id="test" className="p-4" data-foo="bar" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.code).toContain('id="test"');
        expect(result.code).toContain('data-foo="bar"');
    });

    it('handles responsive + state variants', () => {
        const source = '<div className="md:hover:bg-blue-600" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('md');
        expect(result.code).toContain('hover');
    });

    it('does not transform dynamic classNames', () => {
        // This regex approach only handles string literals
        const source = '<div className={someVar} />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(false);
    });

    it('handles color with opacity', () => {
        const source = '<div className="bg-blue-500/50" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain("color: 'blue-500'");
        expect(result.code).toContain('op: 50');
    });

    it('handles gradient classes', () => {
        const source = '<div className="bg-linear-to-r from-blue-500 to-red-500" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain("gradient: 'linear'");
        expect(result.code).toContain("dir: 'to-r'");
    });

    it('handles important modifier', () => {
        const source = '<div className="p-4!" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain("'4!'");
    });

    it('handles complex real-world component', () => {
        const source = `
<button className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">
  Click me
</button>`;
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.stats.classNamesTransformed).toBe(1);
        expect(result.code).toContain('px: 4');
        expect(result.code).toContain('py: 2');
        expect(result.code).toContain("bg: 'blue-500'");
        expect(result.code).toContain("color: 'white'");
    });

    it('handles container query variants', () => {
        const source = '<div className="@md:flex @lg:grid" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain("'@md'");
        expect(result.code).toContain("'@lg'");
    });

    it('handles data attributes', () => {
        const source = '<div className="data-[active]:bg-blue-500" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('data');
        expect(result.code).toContain('active');
    });

    it('handles negative values', () => {
        const source = '<div className="-mt-4 -rotate-45" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('mt: -4');
        expect(result.code).toContain('rotate: -45');
    });

    it('handles arbitrary values', () => {
        const source = '<div className="w-[200px] p-[10px]" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain("w: '200px'");
        expect(result.code).toContain("p: '10px'");
    });

    it('handles CSS variable sugar', () => {
        const source = '<div className="p-(--spacing)" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain("p: '--spacing'");
    });

    it('handles fractions', () => {
        const source = '<div className="w-1/2 h-1/3" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain("w: '1/2'");
        expect(result.code).toContain("h: '1/3'");
    });

    it('handles multi-part prefix classes', () => {
        const source = '<div className="col-span-3 grid-cols-12 place-content-center" />';
        const result = transformSourceSimple(source, 'test.tsx');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('colSpan: 3');
        expect(result.code).toContain('gridCols: 12');
        expect(result.code).toContain("placeContent: 'center'");
    });
});
