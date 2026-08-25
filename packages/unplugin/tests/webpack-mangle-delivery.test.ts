/**
 * Webpack lane: the runtime mangle map reaches the bundle as a real-file
 * registration module — never as an inline `<script>`.
 *
 * Webpack rejects `virtual:` specifiers (UnhandledSchemeError before any
 * resolve plugin runs), so this lane used to deliver the map through an
 * executable `dangerouslySetInnerHTML` installer in the root layout — the
 * one csszyx-owned inline script a strict CSP still refused after the vite
 * lanes went CSP-clean. The theme-groups registration already solved the same
 * constraint with a generated file under `.csszyx/`; the map takes the same
 * road.
 */
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import webpack from 'webpack';
import { MANGLE_RUNTIME_FILE_MARKER } from '../src/mangle-runtime-file.js';
import { webpackPlugin } from '../src/unplugin.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * An app whose classes come from an `szv` catalog (safelisted at build, so
 * the census is non-empty without any JSX for webpack to parse) and are
 * resolved at runtime through `szr`.
 *
 * @returns Absolute project root.
 */
function project(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-wp-mangle-')));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
        join(root, 'src/index.js'),
        [
            "import { szr, szv } from '@csszyx/runtime';",
            'export const card = szv({ base: { p: 4, m: 3 }, variants: { tone: { a: { mx: 0 }, b: { mx: 4 } } } });',
            "export const cls = szr(card({ tone: 'a' }));",
        ].join('\n'),
        'utf8',
    );
    return root;
}

/**
 * Run one production compilation to completion.
 *
 * @param root - Project root.
 * @returns The emitted bundle.
 */
async function buildOnce(root: string): Promise<string> {
    const compiler = webpack({
        mode: 'production',
        devtool: false,
        context: root,
        entry: './src/index.js',
        output: { path: join(root, 'dist'), filename: 'bundle.js' },
        optimization: { minimize: false },
        // The runtime stays external so the assertions read what csszyx
        // emitted, not the runtime's own contents.
        externals: [
            ({ request }, callback) =>
                request?.startsWith('@csszyx/runtime')
                    ? callback(undefined, `commonjs ${request}`)
                    : callback(),
        ],
        plugins: [webpackPlugin({ build: { cache: false }, production: { mangle: true } })],
    });
    await new Promise<void>((resolve, reject) => {
        compiler.run((error, stats) => {
            compiler.close(() => {
                if (error) reject(error);
                else if (stats?.hasErrors()) reject(new Error(stats.toString('errors-only')));
                else resolve();
            });
        });
    });
    return readFileSync(join(root, 'dist/bundle.js'), 'utf8');
}

describe('webpack production build with mangling', () => {
    it('registers the map from a generated file and emits no inline installer', async () => {
        const root = project();
        const bundle = await buildOnce(root);

        expect(existsSync(join(root, MANGLE_RUNTIME_FILE_MARKER))).toBe(true);
        // Not `installMangleRuntime(`: webpack rewrites the imported binding
        // into a namespace access, so the call reads `.installMangleRuntime)(`.
        expect(bundle).toContain('installMangleRuntime');
        // The final map, substituted after the mangle pass: original names as
        // keys, no placeholder left behind.
        expect(bundle).toMatch(/"mx-0":\s*"[A-Za-z][A-Za-z0-9]*"/);
        expect(bundle).not.toContain('___CSSZYX_');
        expect(bundle).not.toContain('window.__csszyx=');
        // Registered from the file, not from a virtual id this lane cannot take.
        expect(bundle).toContain(MANGLE_RUNTIME_FILE_MARKER);
        expect(bundle).not.toContain('virtual:csszyx/mangle-runtime');
    }, 60_000);

    it('still builds when the generated directory cannot be written', async () => {
        const root = project();
        // A FILE where `.csszyx/` belongs. Without the map the runtime helpers
        // fall back to original class names — visible in the page — which is
        // the right trade against failing a build over an unwritable directory.
        writeFileSync(join(root, '.csszyx'), 'not a directory', 'utf8');

        const bundle = await buildOnce(root);
        expect(bundle).not.toContain('installMangleRuntime');
        expect(bundle).not.toContain('window.__csszyx=');
    }, 60_000);
});
