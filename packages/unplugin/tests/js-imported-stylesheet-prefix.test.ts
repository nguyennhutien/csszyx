/**
 * A prefix set in a stylesheet the app reaches only from JavaScript.
 *
 * The app keeps no `.css` file of its own: `main.tsx` imports the design
 * system's stylesheet from a package, and that stylesheet sets
 * `prefix(tw)`. A walk over the project's `.css` files finds nothing, so the
 * build must learn the stylesheet from the import.
 */
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

describe('a stylesheet imported only from JavaScript', () => {
    it('reaches the style model, so its prefix is read', async () => {
        const main =
            'import \'@fixture/ui/globals.css\';\nexport const A = () => <div className="card" />;\n';
        const root = tailwindProject('csszyx-js-css-prefix-', {
            'src/main.tsx': main,
            'node_modules/@fixture/ui/package.json': JSON.stringify({
                name: '@fixture/ui',
                exports: { './globals.css': './globals.css' },
            }),
            'node_modules/@fixture/ui/globals.css': '@import "tailwindcss" prefix(tw);\n',
        });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const plugins = vitePlugin({ production: { mangle: false } }) as unknown as Record<
            string,
            unknown
        >[];
        const call = callHooks(plugins);

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
