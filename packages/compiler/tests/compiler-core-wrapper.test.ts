/**
 * The CsszyxCompiler WASM wrapper, __szColorVar, and the color-string
 * sanitizer — the compiler's small always-on helpers that had no direct suite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stripInvalidColorStrings } from '../src/color-validation.js';
import { __szColorVar } from '../src/color-var.js';
import { CsszyxCompiler } from '../src/compiler.js';

afterEach(() => vi.restoreAllMocks());

describe('__szColorVar', () => {
    it('treats missing/empty values as "no colour"', () => {
        expect(__szColorVar(undefined)).toBeUndefined();
        expect(__szColorVar(null)).toBeUndefined();
        expect(__szColorVar('')).toBeUndefined();
    });

    it('passes raw CSS colour values through unchanged', () => {
        expect(__szColorVar('#ff0000')).toBe('#ff0000');
        expect(__szColorVar('rgb(1 2 3)')).toBe('rgb(1 2 3)');
        expect(__szColorVar('hsl(120 50% 50%)')).toBe('hsl(120 50% 50%)');
        expect(__szColorVar('oklch(0.7 0.1 200)')).toBe('oklch(0.7 0.1 200)');
    });

    it('wraps custom properties in var()', () => {
        expect(__szColorVar('--brand')).toBe('var(--brand)');
    });

    it('leaves value-like strings with CSS punctuation as-is', () => {
        expect(__szColorVar('var(--x)')).toBe('var(--x)');
        expect(__szColorVar('a b')).toBe('a b');
    });

    it('maps Tailwind colour names onto the theme variable', () => {
        expect(__szColorVar('blue-500')).toBe('var(--color-blue-500)');
    });
});

describe('stripInvalidColorStrings', () => {
    it('keeps valid colours and non-colour keys untouched', () => {
        const result = stripInvalidColorStrings({ bg: 'blue-500', p: 4, flex: true });
        expect(result).toEqual({ bg: 'blue-500', p: 4, flex: true });
    });

    it('strips string slash opacity with a pointer to the object form', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = stripInvalidColorStrings({ bg: 'blue-500/50' });
        expect(result).toEqual({});
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('op: 50'));
    });

    it('strips unrecognized colour values with a warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = stripInvalidColorStrings({ color: 'definitely not a colour!' });
        expect(result).toEqual({});
        expect(warn).toHaveBeenCalled();
    });

    it('recurses into nested variant objects', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = stripInvalidColorStrings({
            hover: { bg: 'red-500/25', color: 'green-600' },
        });
        expect(result).toEqual({ hover: { color: 'green-600' } });
        expect(warn).toHaveBeenCalled();
    });
});

describe('CsszyxCompiler with the real WASM core', () => {
    it('is a singleton', () => {
        expect(CsszyxCompiler.getInstance()).toBe(CsszyxCompiler.getInstance());
    });

    it('transforms through the JS path before init', () => {
        const compiler = CsszyxCompiler.getInstance();
        expect(compiler.isWasmActive()).toBe(false);
        expect(compiler.transform({ p: 4 })).toContain('p-4');
    });

    it('activates WASM on init and keeps transform output identical', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const compiler = CsszyxCompiler.getInstance();
        await compiler.init();
        expect(compiler.isWasmActive()).toBe(true);
        expect(info).toHaveBeenCalled();
        expect(compiler.transform({ p: 4 })).toContain('p-4');
        // init is idempotent.
        await compiler.init();
        expect(compiler.isWasmActive()).toBe(true);
    });

    it('generates a deterministic recovery token', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const compiler = CsszyxCompiler.getInstance();
        const metadata = {
            component: 'Card',
            filePath: 'src/Card.tsx',
            line: 3,
            column: 7,
            mode: 'csr' as const,
            buildId: 'b1',
        };
        const first = compiler.generateRecoveryToken(metadata);
        expect(first).toHaveLength(12);
        expect(compiler.generateRecoveryToken(metadata)).toBe(first);
        warn.mockRestore();
    });
});

describe('sortStrings', () => {
    it('orders by UTF-16 code units, handling equal elements', async () => {
        const { sortStrings } = await import('../src/sort.js');
        expect(sortStrings(['b', 'a', 'b', '10', '9'])).toEqual(['10', '9', 'a', 'b', 'b']);
    });
});
