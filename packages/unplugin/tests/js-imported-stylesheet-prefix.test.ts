/**
 * A prefix set in a stylesheet the app reaches only from JavaScript.
 *
 * The app keeps no `.css` file of its own: `main.tsx` imports the design
 * system's stylesheet from a package, and that stylesheet sets
 * `prefix(tw)`. A walk over the project's `.css` files finds nothing, so the
 * build must learn the stylesheet from the import.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const REPO = resolve(import.meta.dirname, '../../..');
const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('a stylesheet imported only from JavaScript', () => {
    it('reaches the style model, so its prefix is read', async () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-js-css-prefix-')));
        roots.push(root);
        const main =
            'import \'@fixture/ui/globals.css\';\nexport const A = () => <div className="card" />;\n';
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src/main.tsx'), main);
        const ui = join(root, 'node_modules/@fixture/ui');
        mkdirSync(ui, { recursive: true });
        writeFileSync(
            join(ui, 'package.json'),
            JSON.stringify({ name: '@fixture/ui', exports: { './globals.css': './globals.css' } }),
        );
        writeFileSync(join(ui, 'globals.css'), '@import "tailwindcss" prefix(tw);\n');
        const require_ = createRequire(join(REPO, 'package.json'));
        symlinkSync(
            resolve(dirname(require_.resolve('tailwindcss')), '..'),
            join(root, 'node_modules/tailwindcss'),
            'dir',
        );
        mkdirSync(join(root, 'node_modules/@csszyx'), { recursive: true });
        symlinkSync(
            join(REPO, 'packages/runtime'),
            join(root, 'node_modules/@csszyx/runtime'),
            'dir',
        );

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const plugins = vitePlugin({ production: { mangle: false } }) as unknown as Record<
            string,
            unknown
        >[];
        const call = async (hookName: string, ...args: unknown[]) => {
            const plugin = plugins.find(p => p && hookName in p);
            const hook = plugin?.[hookName];
            const fn = (
                typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
            ) as ((...a: unknown[]) => unknown) | undefined;
            return fn
                ? await fn.apply({ warn() {}, error() {}, emitFile() {}, addWatchFile() {} }, args)
                : undefined;
        };

        await call('configResolved', { root, command: 'build' });
        await call('transform', main, join(root, 'src/main.tsx'));
        await call('renderStart');

        expect(warn.mock.calls.map(args => args.join(' ')).join('\n')).toContain('prefix(tw)');
    }, 60_000);

    it('reads the prefix when the JavaScript specifier escapes its dot', async () => {
        const main = String.raw`import '@fixture/ui/globals\u002ecss';
export const A = () => <div sz={{ p: 4 }} />;
`;
        const root = tailwindProject('csszyx-js-escaped-css-prefix-', {
            'src/main.tsx': main,
            'node_modules/@fixture/ui/package.json': JSON.stringify({
                name: '@fixture/ui',
                exports: { './globals.css': './globals.css' },
            }),
            'node_modules/@fixture/ui/globals.css': '@import "tailwindcss" prefix(tw);\n',
        });
        const call = callHooks(
            vitePlugin({ production: { mangle: false } }) as unknown as Record<string, unknown>[],
        );

        await call('configResolved', { root, command: 'build' });
        const result = (await call('transform', main, join(root, 'src/main.tsx'))) as {
            code: string;
        };

        expect(result.code).toContain('tw:p-4');
    }, 60_000);
});
