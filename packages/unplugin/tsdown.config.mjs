import { base, defineBuild } from '../../tsdown.base.mjs';

const shared = {
    ...base,
    format: ['esm', 'cjs'],
    // Bundler plugins, the Next integration and the jest transform run in
    // Node only.
    platform: 'node',
    deps: { neverBundle: ['esbuild', 'rollup', 'vite', 'webpack'] },
};

export default defineBuild([
    {
        ...shared,
        entry: {
            index: 'src/index.ts',
            vite: 'src/vite.ts',
            webpack: 'src/webpack.ts',
            'css-mangler': 'src/css-mangler.ts',
            'next-turbo-loader': 'src/next-turbo-loader.ts',
            'next-prebuild': 'src/next-prebuild.ts',
            'next-watcher': 'src/next-watcher.ts',
            'next-config': 'src/next-config.ts',
            'jest-transform': 'src/jest-transform.ts',
        },
        // `vite` and `webpack` export only a default: keep it on
        // `exports.default`, as `require('@csszyx/unplugin/vite').default`.
        cjsDefault: false,
    },
    {
        // Built apart so its CommonJS file is `module.exports = plugin`: a
        // PostCSS config names the plugin by package, and both PostCSS and
        // Next then `require()` it and expect the function itself back, not
        // a namespace with a `default` key.
        ...shared,
        clean: false,
        entry: { postcss: 'src/postcss.ts' },
        cjsDefault: true,
        hooks: {
            // The declaration plugin writes `export =` only when the default
            // is the sole export, and this entry also exports the options
            // type, so `postcss.d.cts` would describe a namespace that the
            // `.cjs` is not. Give it the shape unbuild shipped.
            async 'build:done'(ctx) {
                const fs = await import('node:fs/promises');
                const path = await import('node:path');
                const file = path.join(ctx.options.outDir, 'postcss.d.cts');
                const text = await fs.readFile(file, 'utf8');
                const from = 'export { csszyxPostcss as default };';
                if (!text.includes(from)) {
                    throw new Error(`${file}: expected \`${from}\` to rewrite as \`export =\``);
                }
                await fs.writeFile(
                    file,
                    text
                        .replace('export interface CsszyxPostcssOptions', 'interface CsszyxPostcssOptions')
                        .replace(from, 'export = csszyxPostcss;\nexport type { CsszyxPostcssOptions };'),
                );
            },
        },
    },
]);
