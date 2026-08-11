import { describe, expect, it } from 'vitest';

import { csszyxTurbopack } from '../src/next-config.js';

describe('csszyxTurbopack', () => {
    it('adds a *.tsx loader rule WITHOUT an `as` field (same-type transform)', () => {
        const tp = csszyxTurbopack();
        const rule = tp.rules?.['*.tsx'] as {
            loaders: Array<{ loader: string; options: Record<string, unknown> }>;
            as?: unknown;
        };
        expect(rule.loaders[0].loader).toBe('@csszyx/unplugin/next-turbo-loader');
        // The whole point: `as` must NOT be present (it causes ./X.tsx.tsx).
        expect('as' in rule).toBe(false);
    });

    it('defaults parserMode to rust', () => {
        const rule = csszyxTurbopack().rules?.['*.tsx'] as {
            loaders: Array<{ options: { parserMode: string } }>;
        };
        expect(rule.loaders[0].options.parserMode).toBe('rust');
    });

    it.each([true, false])('forwards an explicit importedStaticSz of %s', value => {
        // Forwarded only when set, so an unconfigured project keeps whatever
        // the loader resolves as the default. Both values have to travel: with
        // the default on, `false` is the one that carries information, and
        // dropping it would leave the loader compiling what the prebuild does
        // not safelist.
        const rule = csszyxTurbopack({}, { importedStaticSz: value }).rules?.['*.tsx'] as {
            loaders: Array<{ options: Record<string, unknown> }>;
        };
        expect(rule.loaders[0].options.importedStaticSz).toBe(value);
    });

    it('omits importedStaticSz when nothing configures it', () => {
        const rule = csszyxTurbopack().rules?.['*.tsx'] as {
            loaders: Array<{ options: Record<string, unknown> }>;
        };
        expect('importedStaticSz' in rule.loaders[0].options).toBe(false);
    });

    it('forwards safelistOutputFile and config to the loader', () => {
        const rule = csszyxTurbopack(
            {},
            { safelistOutputFile: '.csszyx/x.html', config: { mangleVars: false } },
        ).rules?.['*.tsx'] as { loaders: Array<{ options: Record<string, unknown> }> };
        expect(rule.loaders[0].options.safelistOutputFile).toBe('.csszyx/x.html');
        expect(rule.loaders[0].options.config).toEqual({ mangleVars: false });
    });

    it('honors a custom glob', () => {
        const tp = csszyxTurbopack({}, { glob: 'app/**/*.tsx' });
        expect(tp.rules?.['app/**/*.tsx']).toBeDefined();
        expect(tp.rules?.['*.tsx']).toBeUndefined();
    });

    it('preserves the caller existing rules and resolveAlias', () => {
        const tp = csszyxTurbopack({
            rules: { '*.svg': { loaders: ['@svgr/webpack'] } },
            resolveAlias: { 'maplibre-gl': 'maplibre-gl/dist/maplibre-gl.js' },
        });
        expect(tp.rules?.['*.svg']).toEqual({ loaders: ['@svgr/webpack'] });
        expect(tp.rules?.['*.tsx']).toBeDefined();
        expect(tp.resolveAlias?.['maplibre-gl']).toBe('maplibre-gl/dist/maplibre-gl.js');
    });

    it('defaults config to { mangleVars: false } to match the prebuild hash', () => {
        const rule = csszyxTurbopack().rules?.['*.tsx'] as {
            loaders: Array<{ options: { config: unknown } }>;
        };
        expect(rule.loaders[0].options.config).toEqual({ mangleVars: false });
    });

    it('does NOT auto-add a @csszyx/runtime alias (must be a direct dep)', () => {
        // A raw absolute resolveAlias breaks Turbopack (treated as relative), so
        // the helper adds no @csszyx/runtime alias — only the caller's own.
        expect(csszyxTurbopack().resolveAlias?.['@csszyx/runtime']).toBeUndefined();
        expect(csszyxTurbopack({ resolveAlias: { x: 'y' } }).resolveAlias).toEqual({ x: 'y' });
    });
});
