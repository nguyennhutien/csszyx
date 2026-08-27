import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateThemeDts, type ThemeTypeWriterOptions } from '../src/theme-type-writer.js';

const emptyTheme = {
    colors: [],
    spacings: [],
    fonts: [],
    textSizes: [],
    fontWeights: [],
    radii: [],
    shadows: [],
    breakpoints: [],
};

function dts(theme: Partial<typeof emptyTheme>): string {
    const opts: ThemeTypeWriterOptions = {
        outputPath: resolve('test-fixtures/theme.d.ts'),
        sourceFiles: ['app.css'],
        theme: { ...emptyTheme, ...theme },
    };
    return generateThemeDts(opts);
}

describe('generateThemeDts emitter escaping (F2)', () => {
    it('emits valid tokens byte-identically', () => {
        const out = dts({ colors: ['brand', 'brand-dark'] });
        expect(out).toContain("colors: 'brand' | 'brand-dark';");
    });

    it('quotes non-identifier breakpoint keys as today', () => {
        const out = dts({ breakpoints: ['tablet', '3xl'] });
        expect(out).toContain('tablet?: SzPropsBase;');
        expect(out).toContain("'3xl'?: SzPropsBase;");
    });

    it('escapes a hostile token so it cannot break the string literal', () => {
        const out = dts({ colors: ["ev'il"] });
        expect(out).toContain("'ev\\'il'");
        expect(out).not.toContain("'ev'il'");
    });

    it('escapes a hostile breakpoint key (quoteKey path) and a newline', () => {
        const out = dts({ breakpoints: ["a'b", 'c\nd'] });
        expect(out).toContain("'a\\'b'?: SzPropsBase;");
        expect(out).toContain("'c\\nd'?: SzPropsBase;");
        // no real newline injected into the generated declaration
        expect(out).not.toContain('c\nd');
    });
});
