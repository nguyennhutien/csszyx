/**
 * The stylesheet a Vite build's Tailwind reads for an `@import` that is not a
 * path, asked of Vite's own resolver the way the integration asks it.
 *
 * Each case is a real resolved Vite config, and each expectation was measured
 * against a real `vite build` on Vite 8.3.1 with `@tailwindcss/vite` 4.3.3,
 * and with `@tailwindcss/postcss` 4.3.3 for the PostCSS cases: a fixture
 * whose `@theme` file the import names either sets its token in the built CSS
 * or fails the build. Asking Vite rather than re-implementing it is what makes
 * a function alias, an alias another plugin adds and tsconfig `paths` come out
 * as the build reads them.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import { walkProjectStylesheets } from '@csszyx/tailwind-oracle';
import { type InlineConfig, type Plugin, resolveConfig } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import {
    settledRead,
    type ViteTailwindIntegration,
    viteStylesheetResolver,
    viteTailwindIntegration,
} from '../src/vite-stylesheet-candidates.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A project with `src/gen/theme.css` and whatever a case adds.
 *
 * @param files - More files, relative to the root.
 * @returns The root.
 */
function project(files: Record<string, string> = {}): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-vite-css-')));
    roots.push(root);
    const all = { 'src/gen/theme.css': '@theme { --color-tok: red; }\n', ...files };
    for (const [file, content] of Object.entries(all)) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), content);
    }
    return root;
}

/**
 * The file one integration's Tailwind reads for a target written in
 * `src/app.css`.
 *
 * @param root - The project.
 * @param specifier - The target as written.
 * @param integration - How the build runs Tailwind.
 * @param config - The inline config, beside the root.
 * @returns The file, relative to the root, or null when the build reads none.
 */
async function resolvedFor(
    root: string,
    specifier: string,
    integration: ViteTailwindIntegration,
    config: Omit<InlineConfig, 'root'> = {},
): Promise<string | null> {
    const resolved = await resolveConfig(
        { root, configFile: false, logLevel: 'silent', ...config },
        'build',
    );
    const { candidates } = viteStylesheetResolver(resolved, integration);
    const answer = (await candidates.load?.(specifier, join(root, 'src'))) ?? [];
    // Vite's answer is final: a path that names no file is one the build
    // fails to read.
    const file = answer.find(candidate => existsSync(candidate));
    return file === undefined ? null : relative(root, file).split(sep).join('/');
}

const AT = (root: string) => [{ find: '@', replacement: join(root, 'src') }];

describe('under `@tailwindcss/vite`', () => {
    it.each([
        ['a string alias', '@/gen/theme.css', AT],
        ['a string alias, extensionless', '@/gen/theme', AT],
        [
            'a RegExp alias',
            '~gen/theme.css',
            (root: string) => [{ find: /^~gen/, replacement: join(root, 'src/gen') }],
        ],
        [
            'an alias with a customResolver function',
            '@/gen/theme.css',
            (root: string) => [
                {
                    find: '@',
                    replacement: '@',
                    customResolver: (id: string) => id.replace(/^@/, join(root, 'src')),
                },
            ],
        ],
    ])('follows %s', async (_name, specifier, alias) => {
        const root = project();
        expect(
            await resolvedFor(root, specifier, 'vite', { resolve: { alias: alias(root) } }),
        ).toBe('src/gen/theme.css');
    });

    it('follows an alias another plugin adds in its config hook', async () => {
        const root = project();
        const plugin: Plugin = {
            name: 'adds-alias',
            config: () => ({ resolve: { alias: { '@': join(root, 'src') } } }),
        };
        expect(await resolvedFor(root, '@/gen/theme.css', 'vite', { plugins: [plugin] })).toBe(
            'src/gen/theme.css',
        );
    });

    it('does not follow a plugin that resolves in its own resolveId, as the build does not', async () => {
        // Vite's resolver runs its alias and resolve plugins only; the build
        // fails on this import (measured), so the walk must not read it.
        const root = project();
        const plugin: Plugin = {
            name: 'resolves-itself',
            resolveId: id => (id.startsWith('@/') ? join(root, 'src', id.slice(2)) : null),
        };
        expect(
            await resolvedFor(root, '@/gen/theme.css', 'vite', { plugins: [plugin] }),
        ).toBeNull();
    });

    it('tries a bare target against the importing folder first', async () => {
        const root = project();
        expect(await resolvedFor(root, 'gen/theme.css', 'vite')).toBe('src/gen/theme.css');
        expect(await resolvedFor(root, 'gen/theme', 'vite')).toBe('src/gen/theme.css');
    });

    it('reads tsconfig `paths` only with `resolve.tsconfigPaths`', async () => {
        const root = project({
            'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
        });
        expect(await resolvedFor(root, '@/gen/theme.css', 'vite')).toBeNull();
        expect(
            await resolvedFor(root, '@/gen/theme.css', 'vite', {
                resolve: { tsconfigPaths: true },
            }),
        ).toBe('src/gen/theme.css');
    });

    it('keeps no answer that is not a `.css` file, nor a folder', async () => {
        const root = project({
            'src/gen/theme.tw': '@theme { --color-tok: red; }\n',
            'src/dir/index.css': '',
        });
        const resolve = { alias: AT(root) };
        expect(await resolvedFor(root, '@/gen/theme.tw', 'vite', { resolve })).toBeNull();
        expect(await resolvedFor(root, '@/dir', 'vite', { resolve })).toBeNull();
    });

    it('takes a relative alias answer against the importing folder, where the build finds nothing', async () => {
        // `./src/gen/theme.css` from `src/` names `src/src/gen/theme.css`:
        // the build fails on it (measured), and the walk reads nothing.
        const root = project();
        const alias = [{ find: '@', replacement: './src' }];
        expect(
            await resolvedFor(root, '@/gen/theme.css', 'vite', { resolve: { alias } }),
        ).toBeNull();
        const nested = project({ 'src/src/gen/theme.css': '' });
        expect(await resolvedFor(nested, '@/gen/theme.css', 'vite', { resolve: { alias } })).toBe(
            'src/src/gen/theme.css',
        );
    });

    it('takes an answer that is still relative against the importing folder', async () => {
        // A customResolver may answer with a relative id; `@tailwindcss/vite`
        // takes one that starts with a dot against the importing stylesheet's
        // folder, and none that is still relative after that. (Vite drops a
        // leading `./` itself, so `../` is the dot that reaches it.)
        const root = project();
        const answering = (id: string) => [
            { find: '@', replacement: '@', customResolver: () => id },
        ];
        expect(
            await resolvedFor(root, '@/gen/theme.css', 'vite', {
                resolve: { alias: answering('../src/gen/theme.css') },
            }),
        ).toBe('src/gen/theme.css');
        expect(
            await resolvedFor(root, '@/gen/theme.css', 'vite', {
                resolve: { alias: answering('./gen/theme.css') },
            }),
        ).toBeNull();
    });

    it('asks with the SSR conditions for an SSR build', async () => {
        const root = project();
        expect(
            await resolvedFor(root, '@/gen/theme.css', 'vite', {
                resolve: { alias: AT(root) },
                build: { ssr: 'src/entry.ts' },
            }),
        ).toBe('src/gen/theme.css');
    });

    it('reads `@scope/pkg` as no `@` alias', async () => {
        const root = project({ 'src/@scope/theme.css': '' });
        expect(
            await resolvedFor(root, '@scope/theme.css', 'vite', { resolve: { alias: AT(root) } }),
        ).toBe('src/@scope/theme.css');
    });
});

describe('under `@tailwindcss/postcss`, which Vite inlines imports for', () => {
    it('follows an alias and a bare target', async () => {
        const root = project();
        expect(
            await resolvedFor(root, '@/gen/theme', 'postcss', { resolve: { alias: AT(root) } }),
        ).toBe('src/gen/theme.css');
        expect(await resolvedFor(root, 'gen/theme.css', 'postcss')).toBe('src/gen/theme.css');
    });

    it('reads no tsconfig `paths`, `resolve.tsconfigPaths` or not', async () => {
        const root = project({
            'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
        });
        expect(
            await resolvedFor(root, '@/gen/theme.css', 'postcss', {
                resolve: { tsconfigPaths: true },
            }),
        ).toBeNull();
    });

    it('inlines an aliased stylesheet of any extension', async () => {
        const root = project({ 'src/gen/theme.tw': '@theme { --color-tok: red; }\n' });
        expect(
            await resolvedFor(root, '@/gen/theme.tw', 'postcss', { resolve: { alias: AT(root) } }),
        ).toBe('src/gen/theme.tw');
    });
});

describe('a synchronous walk over Vite’s answers', () => {
    /**
     * A project whose app imports a gitignored theme through an alias, which
     * imports a second one through another.
     *
     * @returns The root and its resolved config.
     */
    async function chained() {
        const root = project({
            '.gitignore': 'src/gen/\n',
            'src/app.css': '@import "tailwindcss";\n@import "@/gen/theme.css";\n',
            'src/gen/theme.css': '@import "~more";\n@theme { --color-a: red; }\n',
            'src/gen/more.css': '@theme { --color-b: red; }\n',
        });
        const config = await resolveConfig(
            {
                root,
                configFile: false,
                logLevel: 'silent',
                resolve: {
                    alias: [
                        { find: '@', replacement: join(root, 'src') },
                        { find: /^~more$/, replacement: join(root, 'src/gen/more.css') },
                    ],
                },
            },
            'build',
        );
        return { root, config };
    }

    it('is run again until every aliased import it meets is answered', async () => {
        const { root, config } = await chained();
        const resolver = viteStylesheetResolver(config, 'vite');
        let reads = 0;
        const walk = await settledRead(resolver, () => {
            reads++;
            return walkProjectStylesheets([root], { importCandidates: resolver.candidates });
        });
        expect(walk.files.map(file => relative(root, file).split(sep).join('/'))).toEqual([
            'src/app.css',
            'src/gen/theme.css',
            'src/gen/more.css',
        ]);
        // One read per alias level; `tailwindcss` is never asked about.
        expect(reads).toBe(3);
        expect(resolver.candidates('tailwindcss/theme.css', join(root, 'src'))).toEqual([]);
        expect(await resolver.settle()).toBe(false);
    });

    it('reads once for a project whose only import is Tailwind', async () => {
        const root = project({ 'src/app.css': '@import "tailwindcss";\n' });
        const config = await resolveConfig(
            { root, configFile: false, logLevel: 'silent' },
            'build',
        );
        const resolver = viteStylesheetResolver(config, 'vite');
        let reads = 0;
        await settledRead(resolver, () => {
            reads++;
            return walkProjectStylesheets([root], { importCandidates: resolver.candidates });
        });
        expect(reads).toBe(1);
        expect(await resolver.candidates.load?.('tailwindcss', join(root, 'src'))).toEqual([]);
        // Every answer is known now: a walk reads them without asking again.
        expect(await resolver.settle()).toBe(false);
    });

    it('reads once without a resolver', async () => {
        let reads = 0;
        expect(await settledRead(undefined, () => ++reads)).toBe(1);
    });

    it('asks Vite about each target once, a miss included, as Vite caches one', async () => {
        const asked: string[] = [];
        const resolver = viteStylesheetResolver(
            {
                createResolver: () => async id => {
                    asked.push(id);
                    return id === 'found' ? '/p/found.css' : undefined;
                },
            },
            'postcss',
        );
        const read = () => [
            ...resolver.candidates('found', '/p'),
            ...resolver.candidates('missing', '/p'),
        ];
        expect(read()).toEqual([]);
        expect(await resolver.settle()).toBe(true);
        expect(read()).toEqual(['/p/found.css']);
        expect(await resolver.settle()).toBe(false);
        expect(await resolver.candidates.load?.('missing', '/p')).toEqual([]);
        expect(await resolver.candidates.load?.('found', '/p')).toEqual(['/p/found.css']);
        expect(asked).toEqual(['found', 'missing']);
        // A target the compile asked first is known to the walk.
        expect(await resolver.candidates.load?.('fresh', '/p')).toEqual([]);
        resolver.candidates('fresh', '/p');
        expect(await resolver.settle()).toBe(false);
        expect(asked).toEqual(['found', 'missing', 'fresh']);
    });

    it('keeps a found file and asks a new Vite resolver about a miss after forgetting misses', async () => {
        const asked: string[] = [];
        let resolvers = 0;
        let created = false;
        const resolver = viteStylesheetResolver(
            {
                createResolver: () => {
                    resolvers++;
                    return async id => {
                        asked.push(id);
                        if (id === 'found') return '/p/found.css';
                        return id === 'missing' && created ? '/p/missing.css' : undefined;
                    };
                },
            },
            'postcss',
        );
        const read = () => [
            ...resolver.candidates('found', '/p'),
            ...resolver.candidates('missing', '/p'),
        ];
        read();
        expect(await resolver.settle()).toBe(true);
        expect(read()).toEqual(['/p/found.css']);

        // The watcher reports `missing.css` created.
        created = true;
        resolver.forgetMisses();
        expect(resolvers).toBe(2);
        // The hit survives: a read knows it without asking; the miss is asked again.
        expect(read()).toEqual(['/p/found.css']);
        expect(await resolver.settle()).toBe(true);
        expect(read()).toEqual(['/p/found.css', '/p/missing.css']);
        expect(asked).toEqual(['found', 'missing', 'missing']);
    });
});

describe('which Tailwind integration a Vite build runs', () => {
    it.each([
        ['`@tailwindcss/vite`', [{ name: 'vite:css' }, { name: '@tailwindcss/vite:scan' }], 'vite'],
        ['no Tailwind plugin, so PostCSS', [{ name: 'vite:css' }], 'postcss'],
        ['a plugin list it cannot read', undefined, 'postcss'],
        ['entries it cannot read', [null, { name: 3 }], 'postcss'],
    ])('reads %s from the resolved plugins', (_name, plugins, expected) => {
        expect(viteTailwindIntegration(plugins)).toBe(expected);
    });

    it('is read from the config when the resolver is not told', async () => {
        const root = project({ 'src/gen/theme.tw': '' });
        const config = await resolveConfig(
            { root, configFile: false, logLevel: 'silent', resolve: { alias: AT(root) } },
            'build',
        );
        const answer = await viteStylesheetResolver(config).candidates.load?.(
            '@/gen/theme.tw',
            join(root, 'src'),
        );
        expect(answer).toEqual([join(root, 'src/gen/theme.tw')]);
    });
});
