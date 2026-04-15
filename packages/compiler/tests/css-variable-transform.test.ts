import { describe, expect, it } from 'vitest';

import { transformSourceCode } from '../src/transform.js';

describe('CSS Variable Auto-Compile (transformSourceCode)', () => {
    describe('dynamic spacing values', () => {
        it('should compile dynamic p to CSS variable class + style', () => {
            const source = 'const App = () => <div sz={{ p: dynamicValue }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('p-(--_sz-p)');
            expect(result.code).toContain('style');
            expect(result.code).toContain('--_sz-p');
        });

        it('should compile dynamic margin to CSS variable', () => {
            const source = 'const App = () => <div sz={{ m: spacingVar }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('m-(--_sz-m)');
        });

        it('should compile dynamic gap', () => {
            const source = 'const App = () => <div sz={{ gap: gapSize }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('gap-(--_sz-gap)');
        });
    });

    describe('mixed static + dynamic', () => {
        it('should handle mixed static and dynamic props', () => {
            const source = 'const App = () => <div sz={{ p: dynamicValue, bg: \'blue-500\' }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('bg-blue-500');
            expect(result.code).toContain('p-(--_sz-p)');
        });

        it('should keep static boolean props static', () => {
            const source = 'const App = () => <div sz={{ flex: true, p: dynamicValue }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('flex');
            expect(result.code).toContain('p-(--_sz-p)');
        });

        it('should keep static number props static', () => {
            const source = 'const App = () => <div sz={{ p: 4, m: dynamicValue }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('m-(--_sz-m)');
        });
    });

    describe('dynamic color values', () => {
        it('should compile dynamic bg color', () => {
            const source = 'const App = () => <div sz={{ bg: colorVar }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('bg-(--_sz-bg)');
            expect(result.usesColorVar).toBe(true);
        });

        it('should compile dynamic text color', () => {
            const source = 'const App = () => <div sz={{ color: textColor }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('text-(--_sz-color)');
        });
    });

    describe('dynamic unitless values', () => {
        it('should compile dynamic opacity', () => {
            const source = 'const App = () => <div sz={{ opacity: level }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('opacity-(--_sz-opacity)');
        });

        it('should compile dynamic z-index', () => {
            const source = 'const App = () => <div sz={{ z: zLevel }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('z-(--_sz-z)');
        });
    });

    describe('spread fallback', () => {
        it('should fall back to _sz() for spread expressions', () => {
            const source = 'const App = () => <div sz={{ ...dynamicObj }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('_sz(');
            expect(result.usesRuntime).toBe(true);
        });
    });

    describe('static objects still work', () => {
        it('should compile fully static objects normally', () => {
            const source = 'const App = () => <div sz={{ p: 4, bg: \'blue-500\' }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('p-4 bg-blue-500');
            expect(result.code).not.toContain('style');
            expect(result.code).not.toContain('(--_sz');
        });

        it('should compile static string values normally', () => {
            const source = 'const App = () => <div sz="p-4 bg-blue-500" />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('className');
        });
    });

    describe('dynamic responsive variants', () => {
        it('should handle dynamic values in responsive variants', () => {
            const source = 'const App = () => <div sz={{ p: 4, md: { p: dynamicPad } }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('p-4');
            // The variant should produce a CSS variable class
            expect(result.code).toContain('(--_sz-');
        });
    });

    // =======================================================================
    // G2 — Edge Cases
    // =======================================================================

    describe('multiple dynamic props on same element', () => {
        it('should compile two dynamic spacing props', () => {
            const source = 'const App = () => <div sz={{ p: padVal, m: marVal }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('p-(--_sz-p)');
            expect(result.code).toContain('m-(--_sz-m)');
        });

        it('should compile three dynamic props of mixed categories', () => {
            const source = 'const App = () => <div sz={{ p: padVal, bg: colorVal, opacity: opVal }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('p-(--_sz-p)');
            expect(result.code).toContain('bg-(--_sz-bg)');
            expect(result.code).toContain('opacity-(--_sz-opacity)');
        });

        it('should generate separate style vars for each dynamic prop', () => {
            const source = 'const App = () => <div sz={{ w: widthVal, h: heightVal }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('--_sz-w');
            expect(result.code).toContain('--_sz-h');
        });
    });

    describe('mixed static + dynamic with variants', () => {
        it('should handle static variant + dynamic base', () => {
            const source = 'const App = () => <div sz={{ p: dynamicPad, hover: { bg: \'blue-500\' } }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('hover:bg-blue-500');
            expect(result.code).toContain('p-(--_sz-p)');
        });

        it('should handle all-static object (no CSS vars needed)', () => {
            const source = 'const App = () => <div sz={{ p: 4, m: 2, bg: \'red-500\' }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).not.toContain('(--_sz');
            expect(result.code).not.toContain('style');
        });

        it('should keep static hover + dynamic dark', () => {
            const source = 'const App = () => <div sz={{ hover: { bg: \'blue-500\' }, dark: { bg: darkBg } }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('hover:bg-blue-500');
        });
    });

    describe('dynamic color with special handling', () => {
        it('should flag usesColorVar for bg', () => {
            const source = 'const App = () => <div sz={{ bg: themeColor }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.usesColorVar).toBe(true);
        });

        it('should flag usesColorVar for borderColor', () => {
            const source = 'const App = () => <div sz={{ borderColor: borderVal }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.usesColorVar).toBe(true);
        });

        it('should NOT flag usesColorVar for spacing', () => {
            const source = 'const App = () => <div sz={{ p: padVal }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.usesColorVar).toBeFalsy();
        });

        it('should NOT flag usesColorVar for unitless', () => {
            const source = 'const App = () => <div sz={{ opacity: opVal }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.usesColorVar).toBeFalsy();
        });
    });

    describe('conditional and ternary expressions', () => {
        it('should handle ternary with literal branches at build time (no CSS var)', () => {
            // Both branches are static literals → compile each branch at build time.
            // No CSS variable or inline style needed — the ternary itself selects the class.
            const source = 'const App = () => <div sz={{ p: isLarge ? 8 : 4 }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('isLarge ? "p-8" : "p-4"');
            expect(result.code).not.toContain('(--_sz');
        });

        it('should still use CSS var when ternary branch is non-literal (dynamic)', () => {
            // One branch is an identifier (dynamic) → cannot compile statically → CSS variable
            const source = 'const App = () => <div sz={{ p: isLarge ? 8 : dynamicVal }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('(--_sz');
        });

        it('should handle identifier value as dynamic', () => {
            const source = 'const App = () => <div sz={{ gap: gapSize }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('gap-(--_sz-gap)');
        });

        it('should handle member expression as dynamic', () => {
            const source = 'const App = () => <div sz={{ p: theme.spacing.md }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('(--_sz');
        });
    });

    describe('no-transform cases', () => {
        it('should not transform non-sz JSX', () => {
            const source = 'const App = () => <div className="p-4" />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(false);
        });

        it('should not transform empty sz', () => {
            const source = 'const App = () => <div sz={{}} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('className=""');
        });

        it('should handle sz string passthrough', () => {
            const source = 'const App = () => <div sz="flex p-4" />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('className');
        });

        it('should handle dynamic width and height together', () => {
            const source = 'const App = () => <div sz={{ w: w, h: h, bg: \'blue-500\' }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('bg-blue-500');
            expect(result.code).toContain('(--_sz');
        });
    });
});
