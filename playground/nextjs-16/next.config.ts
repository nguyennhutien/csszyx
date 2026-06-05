import type { NextConfig } from 'next';
import { join } from 'node:path';

const enableTurboLoaderProbe = process.env.CSSZYX_NEXT16_TURBO_LOADER === '1';
const enableTurboCsszyxLoader = process.env.CSSZYX_NEXT16_TURBO_CSSZYX === '1';

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

const nextConfig: NextConfig = {
    reactStrictMode: true,
    distDir:
        process.env.CSSZYX_NEXT16_TURBO_CSSZYX === '1'
            ? '.next-turbo-csszyx'
            : process.env.CSSZYX_NEXT16_TURBO_SOURCE === '1'
              ? '.next-turbo-source'
              : '.next',
    turbopack: enableTurboLoaderProbe || enableTurboCsszyxLoader
        ? {
              rules: turbopackRules,
          }
        : undefined,
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
