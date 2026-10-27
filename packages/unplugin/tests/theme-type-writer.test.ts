import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseThemeBlocks, THEME_CATEGORIES } from '../src/theme-scanner.js';
import { generateThemeDts } from '../src/theme-type-writer.js';

const EMPTY_THEME = parseThemeBlocks('');

describe('generateThemeDts', () => {
    it('writes every namespace the scanner reads, under the name it reads it by', () => {
        const theme = parseThemeBlocks(
            '@theme { --animate-wiggle: wiggle 1s; --ease-snappy: linear; --text-shadow-glow: 0 0 4px; --container-card: 24rem; }',
        );
        const content = generateThemeDts({ outputPath: '/out/theme.d.ts', theme, sourceFiles: [] });
        expect(content).toContain("        animations: 'wiggle';");
        expect(content).toContain("        easings: 'snappy';");
        expect(content).toContain("        textShadows: 'glow';");
        expect(content).toContain("        containers: 'card';");
    });

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
                textSizes: [],
                fontWeights: [],
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

describe('the categories the declaration writes', () => {
    // A category the declaration writes and no sz key's type reads reaches no
    // editor: `--container-sidebar` was written and `w: 'sidebar'` was not offered.
    it('each have a theme type in the compiler that a key reads', () => {
        const props = readFileSync(
            new URL('../../compiler/src/types/sz-props.ts', import.meta.url),
            'utf8',
        );
        const typed = [
            ...props.matchAll(/type (CT_\w+) = CustomTheme extends \{ (\w+): infer T \}/g),
        ];
        const read = typed
            .filter(([, alias]) =>
                new RegExp(`\\b${alias}\\b`).test(props.replace(/^type CT_.*$/gm, '')),
            )
            .map(([, , category]) => category);
        expect([...read].sort()).toEqual(
            THEME_CATEGORIES.filter(category => category !== 'breakpoints').sort(),
        );
    });
});
