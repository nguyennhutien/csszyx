import { describe, expect, it } from 'vitest';

import { generateThemeDts } from '../src/theme-type-writer.js';

const EMPTY_THEME = {
    colors: [],
    spacings: [],
    fonts: [],
    radii: [],
    shadows: [],
    breakpoints: [],
};

describe('generateThemeDts', () => {
    it('produces valid module augmentation for a single category', () => {
        const output = generateThemeDts({
            outputPath: '/project/.csszyx/theme.d.ts',
            theme: { ...EMPTY_THEME, colors: ['brand', 'brand-dark'] },
            sourceFiles: ['src/styles/theme.css'],
        });

        expect(output).toContain("declare module '@csszyx/compiler'");
        expect(output).toContain('interface CustomTheme');
        expect(output).toContain("colors: 'brand' | 'brand-dark';");
        expect(output).toContain('export {};');
    });

    it('includes all non-empty categories', () => {
        const output = generateThemeDts({
            outputPath: '/project/.csszyx/theme.d.ts',
            theme: {
                colors: ['brand'],
                spacings: ['xl'],
                fonts: ['display'],
                radii: ['button'],
                shadows: ['card'],
                breakpoints: [],
            },
            sourceFiles: ['theme.css'],
        });

        expect(output).toContain("colors: 'brand';");
        expect(output).toContain("spacings: 'xl';");
        expect(output).toContain("fonts: 'display';");
        expect(output).toContain("radii: 'button';");
        expect(output).toContain("shadows: 'card';");
    });

    it('omits empty categories', () => {
        const output = generateThemeDts({
            outputPath: '/project/.csszyx/theme.d.ts',
            theme: { ...EMPTY_THEME, colors: ['brand'] },
            sourceFiles: ['theme.css'],
        });

        expect(output).not.toContain('spacings');
        expect(output).not.toContain('fonts');
        expect(output).not.toContain('radii');
        expect(output).not.toContain('shadows');
    });

    it('produces empty interface body for fully empty theme', () => {
        const output = generateThemeDts({
            outputPath: '/project/.csszyx/theme.d.ts',
            theme: EMPTY_THEME,
            sourceFiles: ['theme.css'],
        });

        expect(output).toContain('interface CustomTheme {');
        // The interface should have no properties
        expect(output).not.toContain('colors:');
        expect(output).not.toContain('spacings:');
    });

    it('includes DO NOT EDIT header comment', () => {
        const output = generateThemeDts({
            outputPath: '/p/.csszyx/theme.d.ts',
            theme: EMPTY_THEME,
            sourceFiles: ['s.css'],
        });

        expect(output).toContain('DO NOT EDIT');
    });

    it('includes source file attribution', () => {
        const output = generateThemeDts({
            outputPath: '/p/.csszyx/theme.d.ts',
            theme: EMPTY_THEME,
            sourceFiles: ['src/styles/a.css', 'src/styles/b.css'],
        });

        expect(output).toContain('src/styles/a.css');
        expect(output).toContain('src/styles/b.css');
    });

    it('generates correct union type for multiple tokens', () => {
        const output = generateThemeDts({
            outputPath: '/p/.csszyx/theme.d.ts',
            theme: { ...EMPTY_THEME, colors: ['a', 'b', 'c'] },
            sourceFiles: ['t.css'],
        });

        expect(output).toContain("colors: 'a' | 'b' | 'c';");
    });

    it('ends with a trailing newline', () => {
        const output = generateThemeDts({
            outputPath: '/p/.csszyx/theme.d.ts',
            theme: EMPTY_THEME,
            sourceFiles: ['t.css'],
        });

        expect(output.endsWith('\n')).toBe(true);
    });

    it('augments VariantModifiers with custom breakpoints', () => {
        const output = generateThemeDts({
            outputPath: '/p/.csszyx/theme.d.ts',
            theme: { ...EMPTY_THEME, breakpoints: ['tablet', 'desktop'] },
            sourceFiles: ['theme.css'],
        });

        expect(output).toContain('interface VariantModifiers {');
        expect(output).toContain('tablet?: SzPropsBase;');
        expect(output).toContain('desktop?: SzPropsBase;');
        // Both interfaces live in the same module augmentation block.
        expect(output).toContain("declare module '@csszyx/compiler'");
    });

    it('quotes breakpoint keys that are not bare identifiers', () => {
        const output = generateThemeDts({
            outputPath: '/p/.csszyx/theme.d.ts',
            theme: { ...EMPTY_THEME, breakpoints: ['3xl', 'tablet'] },
            sourceFiles: ['theme.css'],
        });

        expect(output).toContain("'3xl'?: SzPropsBase;");
        expect(output).toContain('tablet?: SzPropsBase;');
    });

    it('omits the VariantModifiers block when there are no breakpoints', () => {
        const output = generateThemeDts({
            outputPath: '/p/.csszyx/theme.d.ts',
            theme: { ...EMPTY_THEME, colors: ['brand'] },
            sourceFiles: ['theme.css'],
        });

        expect(output).not.toContain('VariantModifiers');
    });
});
