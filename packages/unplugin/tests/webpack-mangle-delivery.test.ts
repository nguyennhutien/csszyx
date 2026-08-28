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
        // From the generated file, never the virtual id this lane cannot take.
        expect(bundle).not.toContain('virtual:csszyx/mangle-runtime');
        // A GLOBAL entry, so the registration is evaluated before the app code
        // that may call a runtime helper at module scope.
        expect(bundle.indexOf('installMangleRuntime')).toBeLessThan(bundle.indexOf('szv)('));
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

/**
 * An app whose runtime helpers are reached WITHOUT an `import … from
 * 'csszyx'` line: a CJS `require`, and a pre-compiled kit under
 * `node_modules` the plugin never processes.
 *
 * Both are invisible to the per-module import injection — the first because
 * the specifier is not in an import clause, the second because the plugin
 * skips `node_modules` — while the class map is non-empty either way. The
 * lane must register the map from the build itself, not from whichever module
 * happened to be transformed.
 *
 * @returns Absolute project root.
 */
function projectWithoutImportSyntax(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-wp-nolane-')));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'node_modules/ui-kit'), { recursive: true });
    writeFileSync(
        join(root, 'node_modules/ui-kit/package.json'),
        JSON.stringify({ name: 'ui-kit', version: '1.0.0', main: './index.js' }),
        'utf8',
    );
    writeFileSync(
        join(root, 'node_modules/ui-kit/index.js'),
        [
            "const { szr } = require('@csszyx/runtime');",
            'exports.kitClass = () => szr({ mx: 0 });',
        ].join('\n'),
        'utf8',
    );
    writeFileSync(
        join(root, 'src/index.js'),
        [
            "const { szv } = require('@csszyx/runtime');",
            "const { kitClass } = require('ui-kit');",
            'exports.card = szv({ base: { p: 4, m: 3 }, variants: { tone: { a: { mx: 0 }, b: { mx: 4 } } } });',
            'exports.cls = kitClass();',
        ].join('\n'),
        'utf8',
    );
    return root;
}

describe('webpack registers the map without a per-module import', () => {
    it('registers for a require() consumer and an unprocessed node_modules kit', async () => {
        const root = projectWithoutImportSyntax();
        const bundle = await buildOnce(root);

        // No module in this project carries `from '@csszyx/runtime'`, so the
        // per-module injection reaches nothing. The registration must still be
        // in the bundle, carrying the final map.
        expect(bundle).toContain('installMangleRuntime');
        expect(bundle).toMatch(/"mx-0":\s*"[A-Za-z][A-Za-z0-9]*"/);
        expect(bundle).not.toContain('___CSSZYX_');
    }, 60_000);
});
