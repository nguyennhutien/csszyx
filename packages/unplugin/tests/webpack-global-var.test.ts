import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import webpack, { type Configuration, type Stats } from 'webpack';

import { webpackPlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('webpack global variable aliases', () => {
    it('rewrites emitted CSS assets with explicit global variable aliases', async () => {
        const root = createFixture(':root{--brand-primary:red}.card{color:var(--brand-primary)}');

        await runWebpack(root);

        const css = readFileSync(join(root, 'dist/assets/style.css'), 'utf8');
        expect(css).toContain('---gz:var(--brand-primary)');
        expect(css).toContain('color:var(---gz)');
    });

    it('fails closed when explicit global variable aliases are missing CSS definitions', async () => {
        const root = createFixture('.card{color:red}');

        await expect(runWebpack(root)).rejects.toThrow(
            'Global variable token --brand-primary is not defined in scanned CSS',
        );
    });
});

/**
 * Creates a minimal Webpack project that emits CSS through built-in asset
 * modules, avoiding loader dependencies while still exercising processAssets.
 *
 * @param css CSS asset source.
 * @returns Temporary project root.
 */
function createFixture(css: string): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-webpack-global-var-'));
    tempDirs.push(root);
    const src = join(root, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'index.js'), "import './style.css';\n", 'utf8');
    writeFileSync(join(src, 'style.css'), css, 'utf8');
    return root;
}

/**
 * Runs Webpack with csszyx's real webpack adapter.
 *
 * @param root Temporary project root.
 */
async function runWebpack(root: string): Promise<void> {
    const config: Configuration = {
        mode: 'production',
        context: root,
        entry: './src/index.js',
        output: {
            path: join(root, 'dist'),
            filename: 'bundle.js',
            assetModuleFilename: 'assets/[name][ext]',
        },
        module: {
            rules: [
                {
                    test: /\.css$/,
                    type: 'asset/resource',
                },
            ],
        },
        plugins: [
            webpackPlugin({
                build: { cache: false },
                production: {
                    mangleGlobalVars: {
                        enabled: true,
                        tokens: ['--brand-primary'],
                    },
                },
            }) as webpack.WebpackPluginInstance,
        ],
    };

    await new Promise<void>((resolve, reject) => {
        webpack(config, (error: Error | null | undefined, stats: Stats | undefined) => {
            if (error) {
                reject(error);
                return;
            }
            if (stats?.hasErrors()) {
                reject(new Error(stats.toString({ all: false, errors: true })));
                return;
            }
            resolve();
        });
    });
}
