import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig([
    {
        failOnWarn: false,
        externals: ['esbuild', 'rollup', 'vite', 'webpack'],
        entries: [
            './src/index',
            './src/vite',
            './src/webpack',
            './src/css-mangler',
            './src/next-turbo-loader',
            './src/next-prebuild',
            './src/next-watcher',
            './src/next-config',
        ],
        declaration: 'node16',
        rollup: {
            emitCJS: true,
            output: {
                exports: 'named',
            },
        },
    },
    {
        // Built apart so its CommonJS file is `module.exports = plugin`: a
        // PostCSS config names the plugin by package, and both PostCSS and
        // Next then `require()` it and expect the function itself back, not
        // a namespace with a `default` key.
        failOnWarn: false,
        clean: false,
        entries: ['./src/postcss'],
        declaration: 'node16',
        rollup: {
            emitCJS: true,
            output: {
                exports: 'default',
            },
        },
    },
]);
