import type { NextConfig } from 'next';
import { join } from 'node:path';

const enableTurboLoaderProbe = process.env.CSSZYX_NEXT16_TURBO_LOADER === '1';
const enableTurboCsszyxLoader = process.env.CSSZYX_NEXT16_TURBO_CSSZYX === '1';
// Broad-glob regression fixture (the csszyxTurbopack helper over a multi-file
// group). CSSZYX_NEXT16_TURBO_BROAD_AS re-adds `as` to prove the .tsx.tsx guard.
const enableTurboBroad = process.env.CSSZYX_NEXT16_TURBO_BROAD === '1';
const forceBroadAs = process.env.CSSZYX_NEXT16_TURBO_BROAD_AS === '1';

const turbopackRules: NonNullable<NextConfig['turbopack']>['rules'] = {};

if (enableTurboLoaderProbe) {
    turbopackRules['./app/turbo-loader-probe/page.tsx'] = {
        loaders: [
            {
                loader: join(process.cwd(), 'loaders/turbo-probe-loader.cjs'),
            },
        ],
        as: '*.tsx',
    };
    turbopackRules['./app/turbo-dependency-probe/page.tsx'] = {
        loaders: [
            {
                loader: join(process.cwd(), 'loaders/dependency-probe-loader.cjs'),
            },
        ],
        as: '*.tsx',
    };
}

if (enableTurboCsszyxLoader) {
    turbopackRules['./app/turbo-csszyx/page.tsx'] = {
        loaders: [
            {
                loader: '@csszyx/unplugin/next-turbo-loader',
                options: {
                    parserMode: 'rust',
                    safelistOutputFile: '.csszyx/next-loader-classes.html',
                    config: {
                        mangleVars: false,
                    },
                    // csszyxVersion / compilerVersion / nativeVersion / nextVersion are
                    // intentionally omitted so the loader resolves them from the
                    // installed @csszyx/unplugin and @csszyx/compiler package.json
                    // files at runtime. Hardcoding here would make the manifest's
                    // generation identity drift from the actual engine after any
                    // version bump and silently validate stale state as fresh.
                },
            },
        ],
        as: '*.tsx',
    };
}

let turbopack: NextConfig['turbopack'] =
    enableTurboLoaderProbe || enableTurboCsszyxLoader ? { rules: turbopackRules } : undefined;

if (enableTurboBroad) {
    // Use the published helper so the suite validates csszyxTurbopack end-to-end:
    // a multi-file group rule with NO `as` + the @csszyx/runtime resolveAlias.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { csszyxTurbopack } = require('@csszyx/unplugin/next');
    // Intentionally omit `config` so the suite exercises the helper's DEFAULT
    // (must match `csszyx next prebuild`'s hash — the 0.9.3 real-app failure).
    turbopack = csszyxTurbopack(turbopack ?? {}, {
        glob: './app/turbo-broad/*.tsx',
        safelistOutputFile: '.csszyx/next-loader-classes.html',
    });
    if (forceBroadAs && turbopack && turbopack.rules) {
        // Guard: reintroduce the bug. The .tsx.tsx self-match needs `as` to equal
        // the rule's own key glob (KLTN used key '*.tsx' + as '*.tsx'); a generic
        // `as: '*.tsx'` against a scoped key does not self-match.
        const broadRule = turbopack.rules['./app/turbo-broad/*.tsx'] as { as?: string };
        broadRule.as = './app/turbo-broad/*.tsx';
    }
}

const nextConfig: NextConfig = {
    reactStrictMode: true,
    distDir: enableTurboBroad
        ? '.next-turbo-broad'
        : process.env.CSSZYX_NEXT16_TURBO_CSSZYX === '1'
          ? '.next-turbo-csszyx'
          : process.env.CSSZYX_NEXT16_TURBO_SOURCE === '1'
            ? '.next-turbo-source'
            : '.next',
    turbopack,
    webpack: config => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const csszyxWebpack = require('@csszyx/unplugin/webpack').default;

        config.plugins.push(
            csszyxWebpack({
                development: {
                    debug: true,
                },
                production: {
                    injectChecksum: true,
                    mangleVars: true,
                },
            }),
        );

        return config;
    },
};

export default nextConfig;
