import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
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
    ],
    declaration: 'node16',
    rollup: {
        emitCJS: true,
        output: {
            exports: 'named',
        },
    },
});
