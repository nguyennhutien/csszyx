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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterEach, describe, expect, it } from 'vitest';
import webpack from 'webpack';

import { vitePlugin, webpackPlugin } from '../src/unplugin.js';
import {
    MERGE_SIGNATURES_PLACEHOLDER,
    RESOLVED_UNSERVED_VIRTUAL_ID,
    UNSERVED_PLACEHOLDER,
} from '../src/virtual-modules.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

/**
 * Classes covering the three outcomes, so a stub answer cannot satisfy a case.
 *
 * `tab-items-wrapper` classifies (prefix `tab`) and Tailwind serves it nothing;
 * `card` classifies as nothing, so the fallback already places it; `p-4` is
 * served. Only the first belongs in the list.
 */
const AUTHORED = 'tab-items-wrapper card p-4';

afterEach(removeTailwindProjects);

/**
 * A project the plugin can resolve both of its dependencies from.
 *
 * @param prefix - Temporary directory prefix, unique per suite.
 * @returns Absolute project root.
 */
function project(prefix: string): string {
    return tailwindProject(prefix, { 'src/theme.css': '@import "tailwindcss";\n' });
}

describe('vite lane', () => {
    it('preserves signature data inside a webpack eval wrapper', async () => {
        const root = project('csszyx-signature-eval-');
        const plugins = vitePlugin({ production: { mangle: false } }) as unknown as Record<
            string,
            unknown
        >[];
        const call = callHooks(plugins);
        await call('configResolved', { root, command: 'build' });
        await call(
            'transform',
            'export const A = () => <div className="p-4" />;',
            `${root}/src/A.tsx`,
        );
        const module = (await call('load', RESOLVED_UNSERVED_VIRTUAL_ID)) as string;
        await call('renderStart');
        const body = `${module.replace(/^import .*;$/m, '')}\n//# sourceURL=webpack-signatures`;
        const code = `eval(${JSON.stringify(body)});`;
        const rendered = (await call('renderChunk', code)) as { code: string };
        let received: unknown;
        runInNewContext(rendered.code, {
            registerUnservedClasses() {},
            registerMergeSignatures(value: unknown) {
                received = value;
            },
        });
        expect(received).toEqual([{ 'p-4': 0 }, [[0]]]);
    });

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
        expect(rendered?.code).toContain('registerMergeSignatures(');
        expect(rendered?.code).not.toContain(MERGE_SIGNATURES_PLACEHOLDER);
        expect(rendered?.code).not.toContain(UNSERVED_PLACEHOLDER);
    }, 60_000);

    it('asks a prefixed design system about the prefixed name', async () => {
        const root = project('csszyx-unserved-prefix-');
        // `prefix(tw)` serves `tw:p-4` and nothing for a bare `p-4`. The list
        // carries base names, so asking about the base would report every
        // utility the project does serve.
        writeFileSync(join(root, 'src/theme.css'), '@import "tailwindcss" prefix(tw);\n', 'utf8');
        const plugins = vitePlugin({ production: { mangle: false } }) as unknown as Record<
            string,
            unknown
        >[];
        const call = callHooks(plugins);

        await call('configResolved', { root, command: 'build' });
        await call(
            'transform',
            'export const A = () => <div className="tw:tab-items-wrapper tw:card tw:p-4" />;',
            `${root}/src/A.tsx`,
        );
        const module_ = (await call('load', RESOLVED_UNSERVED_VIRTUAL_ID)) as string;
        await call('renderStart');
        const rendered = (await call('renderChunk', module_)) as { code: string } | null;

        expect(rendered?.code).toContain('registerUnservedClasses(["tab-items-wrapper"])');
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
