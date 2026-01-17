import { describe, expect, it } from 'vitest';

import { type SzObject, transform } from '../src/transform.js';

describe('Color Opacity Object Form', () => {
    describe('static color object', () => {
        it('should transform bg with color only', () => {
            const result = transform({ bg: { color: 'blue-500' } } as SzObject);
            expect(result.className).toBe('bg-blue-500');
        });

        it('should transform bg with color and integer opacity', () => {
            const result = transform({ bg: { color: 'blue-500', op: 50 } } as SzObject);
            expect(result.className).toBe('bg-blue-500/50');
        });

        it('should transform bg with opacity 0', () => {
            const result = transform({ bg: { color: 'red-500', op: 0 } } as SzObject);
            expect(result.className).toBe('bg-red-500/0');
        });

        it('should transform bg with opacity 100', () => {
            const result = transform({ bg: { color: 'red-500', op: 100 } } as SzObject);
            expect(result.className).toBe('bg-red-500/100');
        });

        it('should transform bg with half-step decimal opacity', () => {
            const result = transform({ bg: { color: 'black', op: 75.5 } } as SzObject);
            expect(result.className).toBe('bg-black/75.5');
        });

        it('should transform text color with opacity', () => {
            const result = transform({ color: { color: 'blue-500', op: 50 } } as SzObject);
            expect(result.className).toBe('text-blue-500/50');
        });

        it('should transform borderColor with opacity', () => {
            const result = transform({ borderColor: { color: 'red-500', op: 50 } } as SzObject);
            expect(result.className).toBe('border-red-500/50');
        });

        it('should transform divideColor with opacity', () => {
            const result = transform({ divideColor: { color: 'red-500', op: 50 } } as SzObject);
            expect(result.className).toBe('divide-red-500/50');
        });

        it('should transform outlineColor with opacity', () => {
            const result = transform({ outlineColor: { color: 'green-600', op: 30 } } as SzObject);
            expect(result.className).toBe('outline-green-600/30');
        });

        it('should transform ringColor with opacity', () => {
            const result = transform({ ringColor: { color: 'blue-400', op: 70 } } as SzObject);
            expect(result.className).toBe('ring-blue-400/70');
        });

        it('should transform shadowColor with opacity', () => {
            const result = transform({ shadowColor: { color: 'black', op: 25 } } as SzObject);
            expect(result.className).toBe('shadow-black/25');
        });

        it('should transform fill with opacity', () => {
            const result = transform({ fill: { color: 'red-500', op: 50 } } as SzObject);
            expect(result.className).toBe('fill-red-500/50');
        });

        it('should transform stroke with opacity', () => {
            const result = transform({ stroke: { color: 'blue-600', op: 75 } } as SzObject);
            expect(result.className).toBe('stroke-blue-600/75');
        });

        it('should transform gradient stops with opacity', () => {
            const result = transform({ from: { color: 'blue-500', op: 50 } } as SzObject);
            expect(result.className).toBe('from-blue-500/50');
        });
    });

    describe('CSS variable opacity', () => {
        it('should use () syntax for CSS variable opacity', () => {
            const result = transform({ bg: { color: 'blue-500', op: '--alpha' } } as SzObject);
            expect(result.className).toBe('bg-blue-500/(--alpha)');
        });
    });

    describe('string opacity (arbitrary)', () => {
        it('should use [] syntax for percentage opacity', () => {
            const result = transform({ bg: { color: 'blue-500', op: '73%' } } as SzObject);
            expect(result.className).toBe('bg-blue-500/[73%]');
        });

        it('should use [] syntax for leading dot opacity', () => {
            const result = transform({ bg: { color: 'pink-500', op: '.5' } } as SzObject);
            expect(result.className).toBe('bg-pink-500/[.5]');
        });

        it('should use [] syntax for non-half-step decimal', () => {
            const result = transform({ bg: { color: 'pink-500', op: '70.8' } } as SzObject);
            expect(result.className).toBe('bg-pink-500/[70.8]');
        });
    });

    describe('color object in variants', () => {
        it('should work with hover variant', () => {
            const result = transform({
                hover: { bg: { color: 'blue-600', op: 80 } },
            } as SzObject);
            expect(result.className).toBe('hover:bg-blue-600/80');
        });

        it('should work with responsive variant', () => {
            const result = transform({
                md: { bg: { color: 'red-500', op: 40 } },
            } as SzObject);
            expect(result.className).toBe('md:bg-red-500/40');
        });

        it('should work mixed with other properties', () => {
            const result = transform({
                p: 4,
                bg: { color: 'blue-500', op: 50 },
                hover: { bg: { color: 'blue-600', op: 80 } },
            } as SzObject);
            expect(result.className).toContain('p-4');
            expect(result.className).toContain('bg-blue-500/50');
            expect(result.className).toContain('hover:bg-blue-600/80');
        });
    });

    describe('special color values', () => {
        it('should handle inherit', () => {
            const result = transform({ bg: { color: 'inherit' } } as SzObject);
            expect(result.className).toBe('bg-inherit');
        });

        it('should handle current with opacity', () => {
            const result = transform({ text: { color: 'current', op: 50 } } as SzObject);
            expect(result.className).toBe('text-current/50');
        });

        it('should handle transparent', () => {
            const result = transform({ bg: { color: 'transparent' } } as SzObject);
            expect(result.className).toBe('bg-transparent');
        });
    });
});
