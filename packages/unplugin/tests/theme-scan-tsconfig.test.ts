/**
 * The theme scan writes `.csszyx/theme.d.ts` and says so once when the
 * project's tsconfig never mentions it, since TypeScript then types no theme
 * token. A solution-style root config (Vite's template: `files: []` and
 * `references`) includes nothing itself, so the configs it references are
 * the ones read.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { foldsCase } from '../src/path-case.js';
import { themeTypesTsconfigGap } from '../src/unplugin.js';

const tempDirs: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A project root with the given files.
 *
 * @param files - Relative path to content.
 * @returns The root.
 */
function project(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-theme-tsconfig-'));
    tempDirs.push(root);
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(join(root, file, '..'), { recursive: true });
        writeFileSync(join(root, file), content);
    }
    return root;
}

const VITE_ROOT = JSON.stringify({
    files: [],
    references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }],
});

/** The gap for a root `tsconfig.json` that does not mention `.csszyx`. */
const ROOT_GAP = { tsconfig: 'tsconfig.json', includePath: './.csszyx/theme.d.ts' };

describe('themeTypesTsconfigGap', () => {
    it('names the root tsconfig that does not mention `.csszyx`', () => {
        expect(
            themeTypesTsconfigGap(project({ 'tsconfig.json': '{ "include": ["src"] }' })),
        ).toEqual(ROOT_GAP);
    });

    it('is satisfied by a root tsconfig that mentions it', () => {
        const root = project({
            'tsconfig.json': '{ "include": ["src", "./.csszyx/theme.d.ts"] }',
        });
        expect(themeTypesTsconfigGap(root)).toBeNull();
    });

    it('follows the references of a solution-style root', () => {
        const root = project({
            'tsconfig.json': VITE_ROOT,
            'tsconfig.app.json': '{ "include": ["src", "./.csszyx/theme.d.ts"] }',
            'tsconfig.node.json': '{ "include": ["vite.config.ts"] }',
        });
        expect(themeTypesTsconfigGap(root)).toBeNull();
    });

    it('reads a reference to a directory as its tsconfig.json', () => {
        const root = project({
            'tsconfig.json': JSON.stringify({ files: [], references: [{ path: 'app' }] }),
            'app/tsconfig.json': '{ "include": ["../.csszyx/theme.d.ts"] }',
        });
        expect(themeTypesTsconfigGap(root)).toBeNull();
    });

    it('names the first referenced config when none of them mentions it', () => {
        const root = project({
            'tsconfig.json': VITE_ROOT,
            'tsconfig.app.json': '{ "include": ["src"] }',
            'tsconfig.node.json': '{ "include": ["vite.config.ts"] }',
        });
        expect(themeTypesTsconfigGap(root)).toEqual({
            tsconfig: 'tsconfig.app.json',
            includePath: './.csszyx/theme.d.ts',
        });
    });

    it('skips a reference it cannot read', () => {
        const root = project({
            'tsconfig.json': JSON.stringify({
                files: [],
                references: [{ path: './gone.json' }, { path: './tsconfig.app.json' }],
            }),
            'tsconfig.app.json': '{ "include": ["./.csszyx/theme.d.ts"] }',
        });
        expect(themeTypesTsconfigGap(root)).toBeNull();
    });

    it('names the root when none of its references can be read', () => {
        const root = project({
            'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './gone.json' }] }),
        });
        expect(themeTypesTsconfigGap(root)).toEqual(ROOT_GAP);
    });

    it('gives the include path from the referenced config, which resolves it', () => {
        // `include` is read relative to the config that holds it.
        const root = project({
            'tsconfig.json': JSON.stringify({
                files: [],
                references: [{ path: './packages/web' }],
            }),
            'packages/web/tsconfig.json': '{ "include": ["src"] }',
        });
        expect(themeTypesTsconfigGap(root)).toEqual({
            tsconfig: 'packages/web/tsconfig.json',
            includePath: '../../.csszyx/theme.d.ts',
        });
    });

    it('names a reference spelled with the root in another case as under the root, where the file system folds case', () => {
        // On macOS `/Users/me/App` and `/users/me/app` are one directory, so a
        // reference written in the other spelling is a config of this
        // project, named from its root and not by a walk out of it.
        const root = project({
            'tsconfig.json': '{}',
        });
        const other = join(dirname(root), basename(root).toUpperCase());
        tempDirs.push(other);
        mkdirSync(join(other, 'packages/web'), { recursive: true });
        writeFileSync(join(other, 'packages/web/tsconfig.json'), '{ "include": ["src"] }');
        writeFileSync(
            join(root, 'tsconfig.json'),
            JSON.stringify({ files: [], references: [{ path: join(other, 'packages/web') }] }),
        );
        // This file system does not fold case; the root's answer is kept, so
        // the one asked here is the one the gap reads.
        expect(foldsCase(root, { stat: () => ({ dev: 1, ino: 1 }) })).toBe(true);
        expect(themeTypesTsconfigGap(root)).toEqual({
            tsconfig: 'packages/web/tsconfig.json',
            includePath: '../../.csszyx/theme.d.ts',
        });
    });

    it('walks back into the root from a referenced config outside it', () => {
        const root = project({ 'tsconfig.json': '{}' });
        const shared = `${root}-shared`;
        tempDirs.push(shared);
        mkdirSync(shared);
        writeFileSync(join(shared, 'tsconfig.json'), '{ "include": ["src"] }');
        writeFileSync(
            join(root, 'tsconfig.json'),
            JSON.stringify({ files: [], references: [{ path: `../${basename(shared)}` }] }),
        );
        expect(themeTypesTsconfigGap(root)).toEqual({
            tsconfig: `../${basename(shared)}/tsconfig.json`,
            includePath: `../${basename(root)}/.csszyx/theme.d.ts`,
        });
    });

    it.each(['.nuxt', '.svelte-kit', '.astro'])(
        'names the root config over one the framework writes into `%s`',
        dir => {
            // The framework rewrites that file, so a line added there is lost.
            const root = project({
                'tsconfig.json': JSON.stringify({
                    files: [],
                    references: [{ path: `./${dir}/tsconfig.app.json` }],
                }),
                [`${dir}/tsconfig.app.json`]: '{ "include": ["../src"] }',
            });
            expect(themeTypesTsconfigGap(root)).toEqual(ROOT_GAP);
        },
    );

    it('falls back to tsconfig.app.json, and says nothing without a tsconfig', () => {
        expect(themeTypesTsconfigGap(project({ 'tsconfig.app.json': '{}' }))).toEqual({
            tsconfig: 'tsconfig.app.json',
            includePath: './.csszyx/theme.d.ts',
        });
        expect(themeTypesTsconfigGap(project({}))).toBeNull();
    });
});

describe('the theme scan line', () => {
    it('is `theme-scan-without-typescript`, once per process', async () => {
        vi.resetModules();
        const { vitePlugin } = await import('../src/unplugin.js');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const files = {
            'tsconfig.json': VITE_ROOT,
            'tsconfig.app.json': '{ "include": ["src"] }',
            'src/theme.css': '@theme { --color-brand: #f00; }',
        };
        for (let run = 0; run < 2; run++) {
            const [pre] = vitePlugin({
                build: { scanCss: 'src/theme.css', parser: 'wasm', cache: false },
            }) as unknown as [{ configResolved(config: { root: string }): Promise<void> }];
            await pre.configResolved({ root: project(files) });
        }
        expect(
            warn.mock.calls
                .map(call => String(call[0]))
                .filter(line => line.includes('theme-scan-without-typescript')),
        ).toEqual([
            '[csszyx] theme-scan-without-typescript:\n' +
                '  `tsconfig.app.json` does not mention `.csszyx`, so TypeScript does not see the theme types the scan wrote to `.csszyx/theme.d.ts`.\n' +
                '  help: add `"./.csszyx/theme.d.ts"` to its `include` array.\n' +
                '  docs: https://csszyx.com/e/theme-scan-without-typescript',
        ]);
    });

    it('gives the path to include from the config it names', async () => {
        vi.resetModules();
        const { vitePlugin } = await import('../src/unplugin.js');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const [pre] = vitePlugin({
            build: { scanCss: 'src/theme.css', parser: 'wasm', cache: false },
        }) as unknown as [{ configResolved(config: { root: string }): Promise<void> }];
        await pre.configResolved({
            root: project({
                'tsconfig.json': JSON.stringify({
                    files: [],
                    references: [{ path: 'packages/web' }],
                }),
                'packages/web/tsconfig.json': '{ "include": ["src"] }',
                'src/theme.css': '@theme { --color-brand: #f00; }',
            }),
        });
        expect(warn.mock.calls.map(call => String(call[0])).join('\n')).toContain(
            '  `packages/web/tsconfig.json` does not mention `.csszyx`, so TypeScript does not see the theme types the scan wrote to `.csszyx/theme.d.ts`.\n' +
                '  help: add `"../../.csszyx/theme.d.ts"` to its `include` array.\n',
        );
    });

    it('says nothing for a Vite root whose app config mentions it', async () => {
        vi.resetModules();
        const { vitePlugin } = await import('../src/unplugin.js');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const [pre] = vitePlugin({
            build: { scanCss: 'src/theme.css', parser: 'wasm', cache: false },
        }) as unknown as [{ configResolved(config: { root: string }): Promise<void> }];
        await pre.configResolved({
            root: project({
                'tsconfig.json': VITE_ROOT,
                'tsconfig.app.json': '{ "include": ["src", "./.csszyx/theme.d.ts"] }',
                'tsconfig.node.json': '{ "include": ["vite.config.ts"] }',
                'src/theme.css': '@theme { --color-brand: #f00; }',
            }),
        });
        expect(warn.mock.calls.map(call => String(call[0])).join('\n')).not.toMatch(
            /theme-scan-without-typescript|TypeScript isn't configured/,
        );
    });
});
