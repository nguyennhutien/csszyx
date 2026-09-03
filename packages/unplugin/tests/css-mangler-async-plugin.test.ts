/**
 * The async mangleCSS entry and the standalone PostCSS plugin — the two
 * pipeline surfaces the sync-focused suite never ran — plus the debug logs.
 */
import postcss from 'postcss';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPostCSSPlugin, mangleCSS } from '../src/css-mangler';

const css = '.p-4 { padding: 1rem } .unknown { color: red } .hover\\:bg-red-500:hover { x: y }';
const map = { 'p-4': 'a', 'hover:bg-red-500': 'b' };

afterEach(() => vi.restoreAllMocks());

describe('mangleCSS (async)', () => {
    it('rewrites mapped selectors and reports both class lists', async () => {
        const result = await mangleCSS(css, map);
        expect(result.css).toContain('.a {');
        expect(result.css).toContain('.b:hover');
        expect(result.css).toContain('.unknown');
        expect(result.transformedCount).toBe(2);
        expect(result.mangledClasses.slice().sort()).toEqual(['hover:bg-red-500', 'p-4']);
        expect(result.unmangledClasses).toContain('unknown');
    });

    it('logs a summary under debug', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        await mangleCSS(css, map, { debug: true });
        expect(log).toHaveBeenCalledWith(expect.stringContaining('selectors transformed'));
    });

    it('returns the input untouched when the map matches nothing', async () => {
        const result = await mangleCSS('.only { a: b }', {});
        expect(result.transformedCount).toBe(0);
        expect(result.css).toContain('.only');
    });
});

describe('createPostCSSPlugin', () => {
    it('mangles through a real postcss pipeline', async () => {
        const result = await postcss([createPostCSSPlugin(map)]).process(css, {
            from: undefined,
        });
        expect(result.css).toContain('.a {');
        expect(result.css).toContain('.unknown');
    });

    it('reports the unique mangle count on exit under debug', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        await postcss([createPostCSSPlugin(map, { debug: true })]).process(css, {
            from: undefined,
        });
        expect(log).toHaveBeenCalledWith(expect.stringContaining('unique classes'));
    });
});

describe('debug and selector-error paths', () => {
    it('mangleCSSSync logs its summary under debug', async () => {
        const { mangleCSSSync } = await import('../src/css-mangler');
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        mangleCSSSync(css, map, { debug: true });
        expect(log).toHaveBeenCalledWith(expect.stringContaining('selectors transformed'));
    });

    it('warns but continues when a selector cannot be parsed', async () => {
        const { mangleCSSSync } = await import('../src/css-mangler');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // `.a]` parses as a CSS rule but trips the selector parser.
        const broken = '.a] { color: red } .p-4 { padding: 1rem }';
        const result = mangleCSSSync(broken, map, { debug: true });
        expect(result.css).toContain('.a]');
        expect(warn).toHaveBeenCalled();
        // The valid selector after it still mangles.
        expect(result.css).toContain('.a {');

        const asyncResult = await mangleCSS(broken, map, { debug: true });
        expect(asyncResult.css).toContain('.a]');

        const pluginResult = await postcss([createPostCSSPlugin(map, { debug: true })]).process(
            broken,
            { from: undefined },
        );
        expect(pluginResult.css).toContain('.a]');
    });

    it('recovers from the same selector in silence when debug is off', async () => {
        const { mangleCSSSync } = await import('../src/css-mangler');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = mangleCSSSync('.a] { color: red } .p-4 { padding: 1rem }', map);

        expect(warn).not.toHaveBeenCalled();
        expect(result.css).toContain('.a]');
        // The rule csszyx can read is still mangled, so one unreadable
        // selector costs that rule and nothing else.
        expect(result.css).toContain('.a {');
    });
});
