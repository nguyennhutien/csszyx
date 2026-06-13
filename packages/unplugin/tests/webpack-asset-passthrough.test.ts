/**
 * Binary asset modules must pass through a csszyx webpack build untouched.
 *
 * unplugin registers the load loader for every module a plugin's load hook
 * could serve; without a loadInclude gate that rule (typed
 * `javascript/auto`, non-raw) captured binary assets and round-tripped them
 * through utf-8, corrupting images and fonts. Next.js webpack builds failed
 * on otherwise-valid images ("not a valid image file" / "Module parse
 * failed") — found by a real-app integration test.
 */
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

// A 1x1 RGB PNG. The signature (0x89, 0x50, ...) and zlib payload corrupt
// under a utf-8 string round-trip, so byte equality proves binary safety.
const PNG_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVQIHWP8z8AAxAAFCAEB' +
        '2Z4PnAAAAABJRU5ErkJggg==',
    'base64',
);

describe('webpack binary asset passthrough', () => {
    it('emits asset/resource modules byte-identical to their source', async () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-webpack-asset-'));
        tempDirs.push(root);
        const src = join(root, 'src');
        mkdirSync(src, { recursive: true });
        writeFileSync(
            join(src, 'index.js'),
            "import pixel from './pixel.png';\nconsole.log(pixel);\n",
            'utf8',
        );
        writeFileSync(join(src, 'pixel.png'), PNG_BYTES);

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
                        test: /\.png$/,
                        type: 'asset/resource',
                    },
                ],
            },
            plugins: [
                webpackPlugin({
                    build: { cache: false },
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

        const emitted = readFileSync(join(root, 'dist/assets/pixel.png'));
        expect(emitted.equals(PNG_BYTES)).toBe(true);
    });
});
