import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // Enable React strict mode for better development experience
    reactStrictMode: true,

    // Webpack configuration for csszyx integration
    webpack: (config, { isServer }) => {
        // Import csszyx webpack plugin dynamically
        // Note: We use require here because this file runs at build time
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const csszyxWebpack = require('@csszyx/unplugin/webpack').default;

        // Add csszyx webpack plugin
        config.plugins.push(
            csszyxWebpack({
                development: {
                    debug: true,
                },
                production: {
                    injectChecksum: true,
                    // Mangling is opt-in; the e2e suite asserts encoded classes
                    // and the hydration map, so this playground opts in.
                    mangle: true,
                    mangleVars: true,
                    // The mangle-map viewer component reads `window.__csszyx`.
                    mangleDebugGlobal: true,
                },
            }),
        );

        // Log which environment we're building for
        console.log(`[csszyx] Building for ${isServer ? 'server' : 'client'}`);

        return config;
    },
};

export default nextConfig;
