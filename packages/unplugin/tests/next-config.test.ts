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

    it('aliases @csszyx/runtime when resolvable, never clobbers a user alias', () => {
        // User-provided alias always wins.
        const withUser = csszyxTurbopack({
            resolveAlias: { '@csszyx/runtime': '/custom/runtime.js' },
        });
        expect(withUser.resolveAlias?.['@csszyx/runtime']).toBe('/custom/runtime.js');

        // Otherwise it is either a resolved path string or absent (best-effort).
        const auto = csszyxTurbopack();
        const alias = auto.resolveAlias?.['@csszyx/runtime'];
        expect(alias === undefined || typeof alias === 'string').toBe(true);
    });
});
