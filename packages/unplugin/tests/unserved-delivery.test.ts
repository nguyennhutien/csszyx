/**
 * Both delivery lanes carry the unserved-class list, or the class lands wrong.
 *
 * The list decides where `splitBox` puts a name: an app's own
 * `tab-items-wrapper` reads as a `tab-size` utility to `classify`, so without
 * the list it is placed by a rule instead of by the fallback. That makes the
 * delivery itself the behaviour, not a payload optimisation -- a lane that
 * drops it renders differently from one that does not.
 *
 * Every project root here carries a real `node_modules`. The plugin resolves
 * `tailwindcss` and `@csszyx/runtime` from the root's own `package.json`, and a
 * root with neither takes the guard that skips the whole feature -- silently
 * and correctly, which is why a fixture without them proves nothing.
 */
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import webpack from 'webpack';

import { vitePlugin, webpackPlugin } from '../src/unplugin.js';
import { RESOLVED_UNSERVED_VIRTUAL_ID, UNSERVED_PLACEHOLDER } from '../src/virtual-modules.js';

const REPO = resolve(import.meta.dirname, '../../..');

/**
 * Classes covering the three outcomes, so a stub answer cannot satisfy a case.
 *
 * `tab-items-wrapper` classifies (prefix `tab`) and Tailwind serves it nothing;
 * `card` classifies as nothing, so the fallback already places it; `p-4` is
 * served. Only the first belongs in the list.
 */
const AUTHORED = 'tab-items-wrapper card p-4';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A project the plugin can resolve both of its dependencies from.
 *
 * @param prefix - Temporary directory prefix, unique per suite.
 * @returns Absolute project root.
 */
function project(prefix: string): string {
    // realpath: macOS `tmpdir()` is a symlink and the plugin resolves through it.
    const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/theme.css'), '@import "tailwindcss";\n', 'utf8');

    // The real packages, reached the way an installed project reaches them.
    // Copying them instead would take a different `tailwindcss` than the one
    // the oracle's own tests measure against.
    const require_ = createRequire(join(REPO, 'package.json'));
    mkdirSync(join(root, 'node_modules/@csszyx'), { recursive: true });
    symlinkSync(
        resolve(dirname(require_.resolve('tailwindcss')), '..'),
        join(root, 'node_modules/tailwindcss'),
        'dir',
    );
    symlinkSync(join(REPO, 'packages/runtime'), join(root, 'node_modules/@csszyx/runtime'), 'dir');
    return root;
}

/**
 * Drive a plugin array through its hooks the way a bundler would.
 *
 * @param plugins - The plugin objects `vitePlugin` returned.
 * @returns Caller that invokes one hook by name and awaits its result.
 */
function callHooks(
    plugins: Record<string, unknown>[],
): (hookName: string, ...args: unknown[]) => Promise<unknown> {
    const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    return async (hookName, ...args) => {
        const plugin = plugins.find(p => p && hookName in p);
        const hook = plugin?.[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(ctx, args) : undefined;
    };
}

describe('vite lane', () => {
    it('substitutes the names the project design system serves nothing for', async () => {
        const root = project('csszyx-unserved-vite-');
        const plugins = vitePlugin({ production: { mangle: false } }) as unknown as Record<
            string,
            unknown
        >[];
        const call = callHooks(plugins);

        await call('configResolved', { root, command: 'build' });
        await call(
            'transform',
            `export const A = () => <div className="${AUTHORED}" />;`,
            `${root}/src/A.tsx`,
        );
        const module_ = (await call('load', RESOLVED_UNSERVED_VIRTUAL_ID)) as string;
        expect(module_).toContain(UNSERVED_PLACEHOLDER);

        // The list is settled here, after every module is transformed and
        // before the first chunk is rendered.
        await call('renderStart');
        const rendered = (await call('renderChunk', module_)) as { code: string } | null;

        expect(rendered?.code).toContain('registerUnservedClasses(["tab-items-wrapper"])');
        expect(rendered?.code).not.toContain(UNSERVED_PLACEHOLDER);
    }, 60_000);

    it('registers nothing for a project with no design system to ask', async () => {
        const root = project('csszyx-unserved-nots-');
        // Plain CSS: no `@import "tailwindcss"`, so no design system compiles
        // and there is no answer. Registering an empty list is what keeps every
        // token at the placement it has today.
        writeFileSync(join(root, 'src/theme.css'), '.a { color: red; }\n', 'utf8');
        const plugins = vitePlugin({ production: { mangle: false } }) as unknown as Record<
            string,
            unknown
        >[];
        const call = callHooks(plugins);

        await call('configResolved', { root, command: 'build' });
        await call(
            'transform',
            `export const A = () => <div className="${AUTHORED}" />;`,
            `${root}/src/A.tsx`,
        );
        const module_ = (await call('load', RESOLVED_UNSERVED_VIRTUAL_ID)) as string;
        await call('renderStart');
        const rendered = (await call('renderChunk', module_)) as { code: string } | null;

        expect(rendered?.code).toContain('registerUnservedClasses([])');
    }, 60_000);

    it('hands a dev server the finished list, never the hole a build fills', async () => {
        const root = project('csszyx-unserved-serve-');
        // On disk, because the prescan reads the project from the filesystem at
        // `configResolved` -- which is what makes the answer available this
        // early on a lane that never renders a chunk.
        writeFileSync(
            join(root, 'src/A.tsx'),
            `export const A = () => <div className="${AUTHORED}" />;\n`,
            'utf8',
        );
        const plugins = vitePlugin({ production: { mangle: false } }) as unknown as Record<
            string,
            unknown
        >[];
        const call = callHooks(plugins);

        await call('configResolved', { root, command: 'serve' });
        const module_ = (await call('load', RESOLVED_UNSERVED_VIRTUAL_ID)) as string;

        // `renderChunk` is a Rollup OUTPUT hook and a dev server never renders
        // a chunk, so a placeholder here would reach the browser as an
        // undefined identifier: `ReferenceError: ___CSSZYX_UNSERVED___`.
        expect(module_).not.toContain(UNSERVED_PLACEHOLDER);
        expect(module_).toContain('registerUnservedClasses(["tab-items-wrapper"])');
    }, 60_000);
});

describe('webpack lane', () => {
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
            // External so the assertions read what csszyx emitted rather than
            // the runtime's own source.
            externals: [
                ({ request }, callback) =>
                    request?.startsWith('@csszyx/runtime')
                        ? callback(undefined, `commonjs ${request}`)
                        : callback(),
            ],
            plugins: [webpackPlugin({ build: { cache: false }, production: { mangle: false } })],
        });
        await new Promise<void>((res, rej) => {
            compiler.run((error, stats) => {
                compiler.close(() => {
                    if (error) rej(error);
                    else if (stats?.hasErrors()) rej(new Error(stats.toString('errors-only')));
                    else res();
                });
            });
        });
        return readFileSync(join(root, 'dist/bundle.js'), 'utf8');
    }

    it('registers the same names from a generated file', async () => {
        const root = project('csszyx-unserved-wp-');
        writeFileSync(
            join(root, 'src/index.js'),
            `export const props = { className: '${AUTHORED}' };\n`,
            'utf8',
        );

        const bundle = await buildOnce(root);

        // webpack parses the colon in `virtual:` as a URI scheme and fails
        // before any resolve plugin runs, so this lane needs a real file.
        expect(existsSync(join(root, '.csszyx/unserved-runtime.mjs'))).toBe(true);
        expect(bundle).toContain('registerUnservedClasses');
        expect(bundle).toContain('["tab-items-wrapper"]');
        expect(bundle).not.toContain(UNSERVED_PLACEHOLDER);
    }, 120_000);

    it('builds without the registration when the generated directory is a file', async () => {
        const root = project('csszyx-unserved-wp-nodir-');
        writeFileSync(
            join(root, 'src/index.js'),
            `export const props = { className: '${AUTHORED}' };\n`,
            'utf8',
        );
        // A FILE where `.csszyx/` belongs. Without the list every token keeps
        // the placement it had before this existed, which beats failing a
        // build over an unwritable directory.
        writeFileSync(join(root, '.csszyx'), 'not a directory', 'utf8');

        const bundle = await buildOnce(root);
        expect(bundle).not.toContain('registerUnservedClasses');
    }, 120_000);
});
