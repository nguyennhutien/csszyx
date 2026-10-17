import { base, defineBuild } from '../../tsdown.base.mjs';

export default defineBuild({
    ...base,
    // ES modules only: every supported Node loads them with `require()` too,
    // and a second CommonJS copy of each class would make `instanceof`
    // disagree between a config that requires the plugin and one that
    // imports it.
    format: ['esm'],
    // Bundler plugins, the Next integration and the jest transform run in
    // Node only.
    platform: 'node',
    deps: { neverBundle: ['esbuild', 'rollup', 'vite', 'webpack'] },
    entry: {
        index: 'src/index.ts',
        vite: 'src/vite.ts',
        webpack: 'src/webpack.ts',
        'css-mangler': 'src/css-mangler.ts',
        'next-turbo-loader': 'src/next-turbo-loader.ts',
        'next-prebuild': 'src/next-prebuild.ts',
        diagnostics: 'src/diagnostics.ts',
        'next-watcher': 'src/next-watcher.ts',
        'next-config': 'src/next-config.ts',
        'jest-transform': 'src/jest-transform.ts',
        postcss: 'src/postcss.ts',
    },
});
