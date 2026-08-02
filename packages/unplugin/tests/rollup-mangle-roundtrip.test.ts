import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type OutputAsset, type OutputChunk, type Plugin, rollup } from 'rollup';
import { afterEach, describe, expect, it } from 'vitest';

import { rollupPlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/**
 * Replace the transformed JSX with a stable class-bearing JavaScript sink.
 *
 * @returns Fixture Rollup transform plugin.
 */
function jsxLoweringPlugin(): Plugin {
    return {
        name: 'fixture-jsx-lowering',
        transform(code, id) {
            if (!id.endsWith('.jsx')) return null;
            expect(code).toContain('p-91');
            expect(code).toContain('m-92');
            return 'export const node = { className: "p-91 raw-rollup m-92" };';
        },
    };
}

/**
 * Emit CSS before csszyx's post-bundle hook observes the bundle.
 *
 * @returns Fixture Rollup asset plugin.
 */
function cssEmitterPlugin(): Plugin {
    return {
        name: 'fixture-css-emitter',
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: 'styles.css',
                source: '.p-91{padding:1rem}.m-92{margin:1rem}.raw-rollup{display:block}',
            });
        },
    };
}

/**
 * Select one emitted asset by filename.
 *
 * @param output Complete Rollup output.
 * @param fileName Requested asset filename.
 * @returns Emitted asset source.
 */
function assetSource(output: Array<OutputAsset | OutputChunk>, fileName: string): string {
    const asset = output.find(entry => entry.type === 'asset' && entry.fileName === fileName);
    if (asset?.type !== 'asset') throw new Error(`Missing Rollup asset: ${fileName}`);
    return asset.source.toString();
}

describe('pure Rollup production mangle round-trip', () => {
    it('rewrites JS and CSS with the emitted manifest while preserving shared raw classes', async () => {
        const root = mkdtempSync(join(realpathSync(tmpdir()), 'csszyx-rollup-mangle-'));
        tempDirs.push(root);
        const input = join(root, 'entry.jsx');
        writeFileSync(
            input,
            'export const App = <div className="p-91 raw-rollup" sz={{ p: 91, m: 92 }} />;',
        );

        const [prePlugin, postPlugin] = rollupPlugin({
            build: { cache: false, parser: 'oxc' },
            production: { mangle: true },
        });
        const build = await rollup({
            input,
            plugins: [prePlugin, jsxLoweringPlugin(), cssEmitterPlugin(), postPlugin],
        });
        const { output } = await build.generate({ format: 'es' });
        await build.close();

        const chunk = output.find(entry => entry.type === 'chunk');
        if (chunk?.type !== 'chunk') throw new Error('Missing Rollup JavaScript chunk');
        const manifest = JSON.parse(assetSource(output, 'csszyx-manifest.json')) as {
            mangleMap: Record<string, string>;
        };
        const token = manifest.mangleMap['m-92'];

        expect(token).toBeTruthy();
        expect(manifest.mangleMap['p-91']).toBeUndefined();
        expect(chunk.code).toContain(`p-91 raw-rollup ${token}`);
        expect(chunk.code).not.toContain('m-92');
        const css = assetSource(output, 'styles.css');
        expect(css).toContain('.p-91');
        expect(css).toContain(`.${token}`);
        expect(css).not.toContain('.m-92');
    }, 30_000);
});
