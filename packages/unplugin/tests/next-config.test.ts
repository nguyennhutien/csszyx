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
        const rule = csszyxTurbopack({ importedStaticSz: value }).rules?.['*.tsx'] as {
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
        const rule = csszyxTurbopack({
            safelistOutputFile: '.csszyx/x.html',
            config: { mangleVars: false },
        }).rules?.['*.tsx'] as { loaders: Array<{ options: Record<string, unknown> }> };
        expect(rule.loaders[0].options.safelistOutputFile).toBe('.csszyx/x.html');
        expect(rule.loaders[0].options.config).toEqual({ mangleVars: false });
    });

    it('forwards the stylesheets the app loads to the loader', () => {
        const rule = csszyxTurbopack({ tailwindStylesheet: ['app/globals.css'] }).rules?.[
            '*.tsx'
        ] as { loaders: Array<{ options: Record<string, unknown> }> };
        expect(rule.loaders[0].options.tailwindStylesheet).toEqual(['app/globals.css']);
    });

    it('omits tailwindStylesheet when nothing names one', () => {
        const rule = csszyxTurbopack().rules?.['*.tsx'] as {
            loaders: Array<{ options: Record<string, unknown> }>;
        };
        expect('tailwindStylesheet' in rule.loaders[0].options).toBe(false);
    });

    it('honors a custom glob', () => {
        const tp = csszyxTurbopack({ glob: 'app/**/*.tsx' });
        expect(tp.rules?.['app/**/*.tsx']).toBeDefined();
        expect(tp.rules?.['*.tsx']).toBeUndefined();
    });

    it('preserves the caller existing rules and resolveAlias', () => {
        const tp = csszyxTurbopack({
            turbopack: {
                rules: { '*.svg': { loaders: ['@svgr/webpack'] } },
                resolveAlias: { 'maplibre-gl': 'maplibre-gl/dist/maplibre-gl.js' },
            },
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
        expect(csszyxTurbopack({ turbopack: { resolveAlias: { x: 'y' } } }).resolveAlias).toEqual({
            x: 'y',
        });
    });

    it('keeps a loader option out of the config it returns', () => {
        // The shape this replaces took the config first and the options second,
        // so `csszyxTurbopack({ tailwindStylesheet })` type-checked, mixed the
        // option into the Turbopack config, and the loader never saw it.
        const tp = csszyxTurbopack({ tailwindStylesheet: 'app/globals.css' });
        const rule = tp.rules?.['*.tsx'] as {
            loaders: Array<{ options: Record<string, unknown> }>;
        };

        expect(rule.loaders[0].options.tailwindStylesheet).toBe('app/globals.css');
        expect('tailwindStylesheet' in tp).toBe(false);
    });

    it('stops on a call written for the two-argument shape', () => {
        // Silently dropping the second argument is the failure this change
        // exists to remove, so an upgrade that kept the old call says so.
        const call = csszyxTurbopack as unknown as (a: unknown, b: unknown) => unknown;

        expect(() => call({ resolveAlias: { x: 'y' } }, { glob: '*.tsx' })).toThrow(
            /takes one object.*turbopack:/s,
        );
    });

    it.each([
        { rules: { '*.svg': { loaders: ['@svgr/webpack'] } } },
        { resolveAlias: { react: 'preact/compat' } },
        { resolveExtensions: ['.tsx', '.ts', '.js'] },
        { root: '/app' },
        { futureTurbopackSetting: true },
        { constructor: 'not an option' },
        { parserMode: 'wasm', resolveAlias: { react: 'preact/compat' } },
    ])('rejects misplaced Turbopack settings in a single argument: %j', existing => {
        const call = csszyxTurbopack as (options: unknown) => unknown;
        expect(() => call(existing)).toThrow(/takes one object.*turbopack:/s);
    });

    it.each([1, 16, 256])('preserves %i settings inside the Turbopack config', count => {
        const settings = Object.freeze(
            Object.fromEntries(
                Array.from({ length: count }, (_, index) => [`setting${index}`, index]),
            ),
        );
        const options = Object.freeze({ turbopack: settings, parserMode: 'wasm' as const });
        const first = csszyxTurbopack(options);
        expect(first).toMatchObject(settings);
        expect(csszyxTurbopack(options)).toEqual(first);
        expect(Object.keys(settings)).toHaveLength(count);
    });
});
