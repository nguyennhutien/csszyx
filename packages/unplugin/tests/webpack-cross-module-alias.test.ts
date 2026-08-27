/**
 * The alias table on the webpack lane, through a real compile.
 *
 * The vite build covers `resolve.alias`; neither covered webpack, and neither
 * covered the source that matters most in practice. Next.js maps `@/*` with a
 * resolver plugin rather than an alias table, so `resolve.alias` is EMPTY on
 * the framework where that specifier is the default scaffold — the alias has to
 * come from `tsconfig.json` or the whole project silently loses the imported
 * static sz optimization.
 *
 * What is asserted is the safelist rather than the bundle. csszyx's prescan
 * reads source files itself and writes the classes it found; whether webpack
 * can then parse the JSX is webpack's own business, and wiring a loader in
 * would test the loader, not the alias table.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import webpack, { type Configuration } from 'webpack';

import { webpackPlugin } from '../src/unplugin.js';

// A full webpack compile under a parallel turbo run exceeds vitest's default.
const WEBPACK_TEST_TIMEOUT_MS = 30_000;

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/**
 * Write a project whose only sz-authoring file names its provider through `@`.
 *
 * `p-7` is deliberately unusual: no other file in the fixture could have
 * produced it, so finding it in the safelist proves it came through the alias.
 *
 * @param tsconfig - Contents for `tsconfig.json`, or undefined to write none.
 * @returns Temporary project root.
 */
function createFixture(tsconfig?: string): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-webpack-alias-'));
    tempDirs.push(root);
    const src = join(root, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'index.js'), 'export const ready = true;\n', 'utf8');
    writeFileSync(
        join(src, 'styles.ts'),
        "export const cardSz = { p: 7, rounded: 'lg' };\n",
        'utf8',
    );
    writeFileSync(
        join(src, 'App.tsx'),
        "import { cardSz } from '@/styles';\nexport const App = () => <div sz={cardSz} />;\n",
        'utf8',
    );
    if (tsconfig !== undefined) writeFileSync(join(root, 'tsconfig.json'), tsconfig, 'utf8');
    return root;
}

/**
 * Run webpack with csszyx's real adapter and return the generated safelist.
 *
 * @param root - Project root.
 * @param alias - Value for `resolve.alias`.
 * @returns Contents of the safelist file, empty when none was written.
 */
async function runWebpack(root: string, alias?: Record<string, string>): Promise<string> {
    const config: Configuration = {
        mode: 'production',
        context: root,
        entry: './src/index.js',
        output: { path: join(root, 'dist'), filename: 'bundle.js' },
        resolve: alias === undefined ? undefined : { alias },
        plugins: [
            webpackPlugin({
                build: { cache: false, importedStaticSz: true },
            }) as webpack.WebpackPluginInstance,
        ],
    };
    await new Promise<void>((resolve, reject) => {
        webpack(config, (error, stats) => {
            if (error) return reject(error);
            if (stats?.hasErrors() === true) return reject(new Error(stats.toString()));
            resolve();
        });
    });
    try {
        return readFileSync(join(root, '.csszyx/csszyx-classes.txt'), 'utf8');
    } catch {
        // A build that safelisted nothing writes no file, which the assertions
        // read as "no classes" — the same thing it means.
        return '';
    }
}

describe('the webpack lane resolves an aliased provider', () => {
    it('reads the alias from resolve.alias', { timeout: WEBPACK_TEST_TIMEOUT_MS }, async () => {
        const root = createFixture();
        expect(await runWebpack(root, { '@': join(root, 'src') })).toContain('p-7');
    });

    it('reads the alias from tsconfig paths when resolve.alias has none', {
        timeout: WEBPACK_TEST_TIMEOUT_MS,
    }, async () => {
        // Next.js in one line: the specifier resolves for the build, and
        // the alias table webpack exposes says nothing about it.
        const root = createFixture(
            JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
        );
        expect(await runWebpack(root)).toContain('p-7');
    });

    it('leaves the runtime path alone when the project declares no alias', {
        timeout: WEBPACK_TEST_TIMEOUT_MS,
    }, async () => {
        // The negative half: without it, a test that always safelisted
        // `p-7` for some unrelated reason would look identical to one
        // proving the alias worked.
        expect(await runWebpack(createFixture())).not.toContain('p-7');
    });
});
