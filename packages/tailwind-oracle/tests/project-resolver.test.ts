/**
 * Where the project's Tailwind resolver comes from, and what the oracle does
 * without one.
 */
import * as fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createEmittedClassOracle, type TailwindLoader } from '../src/emitted-class-oracle.js';
import { expandAlias, projectResolver } from '../src/project-resolver.js';

const REPO = path.resolve(import.meta.dirname, '../../..');
const repoRequire = createRequire(path.join(REPO, 'package.json'));
const TAILWIND_ROOT = path.dirname(repoRequire.resolve('tailwindcss/package.json'));
const TAILWIND_NODE_ROOT = path.resolve(
    path.dirname(repoRequire.resolve('@tailwindcss/node')),
    '..',
);

const created: string[] = [];
afterEach(() => {
    for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A project outside the repository, so nothing resolves by walking up into it.
 *
 * @param files - Relative path to file content.
 * @returns The project directory.
 */
function isolatedProject(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-resolver-'));
    created.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'proj' }));
    for (const [relative, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
        fs.writeFileSync(path.join(root, relative), content);
    }
    return root;
}

/**
 * The repository's Tailwind, handed to a project that has none of its own.
 *
 * @returns The installation the oracle compiles with.
 */
const repoTailwind: TailwindLoader = async () => {
    const entry = await import(repoRequire.resolve('tailwindcss'));
    return {
        version: JSON.parse(fs.readFileSync(path.join(TAILWIND_ROOT, 'package.json'), 'utf8'))
            .version,
        root: TAILWIND_ROOT,
        loadDesignSystem:
            entry.__unstable__loadDesignSystem ?? entry.default?.__unstable__loadDesignSystem,
    };
};

describe('expandAlias', () => {
    it('expands a prefix alias and keeps the rest of the specifier', () => {
        expect(
            expandAlias('@ui/theme.css', [
                { find: '@ui/', replacement: '/p/src/ui/', exact: false },
            ]),
        ).toBe('/p/src/ui/theme.css');
    });

    it('expands an exact alias only for the exact specifier', () => {
        const aliases = [{ find: 'theme', replacement: '/p/theme.css', exact: true }];
        expect(expandAlias('theme', aliases)).toBe('/p/theme.css');
        expect(expandAlias('theme/dark.css', aliases)).toBeNull();
    });
});

describe('projectResolver', () => {
    it('answers null for a project that carries no Tailwind integration', async () => {
        expect(await projectResolver(isolatedProject({}))).toBeNull();
    });

    it('reaches @tailwindcss/node through an integration when the layout does not hoist it', async () => {
        const root = isolatedProject({
            'node_modules/@tailwindcss/vite/package.json': JSON.stringify({
                name: '@tailwindcss/vite',
                main: 'index.js',
            }),
            'node_modules/@tailwindcss/vite/index.js': 'module.exports = {};\n',
            'node_modules/@fixture/style-only/package.json': JSON.stringify({
                name: '@fixture/style-only',
                exports: { '.': { style: './theme.css' } },
            }),
            'node_modules/@fixture/style-only/theme.css': '@theme {}',
        });
        const nested = path.join(root, 'node_modules/@tailwindcss/vite/node_modules/@tailwindcss');
        fs.mkdirSync(nested, { recursive: true });
        fs.symlinkSync(TAILWIND_NODE_ROOT, path.join(nested, 'node'), 'dir');

        const resolver = await projectResolver(root);

        expect(resolver).not.toBeNull();
        expect(resolver?.resolveStylesheet('@fixture/style-only', root)).toBe(
            path.join(fs.realpathSync(root), 'node_modules/@fixture/style-only/theme.css'),
        );
    });
});

describe('projectResolver — integrations it cannot use', () => {
    it('answers null when @tailwindcss/node resolves but throws on import', async () => {
        const root = isolatedProject({
            'node_modules/@tailwindcss/node/package.json': JSON.stringify({
                name: '@tailwindcss/node',
                main: 'index.js',
            }),
            'node_modules/@tailwindcss/node/index.js': "throw new Error('broken install');\n",
        });
        expect(await projectResolver(root)).toBeNull();
    });

    it('answers null when @tailwindcss/node carries no module loader', async () => {
        const root = isolatedProject({
            'node_modules/@tailwindcss/node/package.json': JSON.stringify({
                name: '@tailwindcss/node',
                main: 'index.js',
            }),
            'node_modules/@tailwindcss/node/index.js': 'module.exports = {};\n',
        });
        fs.symlinkSync(
            path.dirname(repoRequire.resolve('enhanced-resolve/package.json')),
            path.join(root, 'node_modules/enhanced-resolve'),
            'dir',
        );
        expect(await projectResolver(root)).toBeNull();
    });
});

describe('the oracle without a project resolver', () => {
    it('still reads a sibling file and loads a plugin through the loaders every host has', async () => {
        const root = isolatedProject({
            'theme.css': '@theme { --color-no-resolver: #111111; }',
            'plugin.mjs':
                "export default function plugin({ addUtilities }) { addUtilities({ '.no-resolver-plugin': { color: 'red' } }); }\n",
            'app.css': '@import "tailwindcss";\n@import "theme.css";\n@plugin "./plugin.mjs";',
        });
        const oracle = await createEmittedClassOracle(
            {
                resolveFrom: root,
                css: await readFile(path.join(root, 'app.css'), 'utf8'),
                cssBase: root,
            },
            repoTailwind,
        );

        if (!oracle.ok) throw new Error(`expected a ready oracle, got skip: ${oracle.reason}`);
        expect(oracle.findDead(['bg-no-resolver', 'no-resolver-plugin', 'zz-probe'])).toEqual([
            'zz-probe',
        ]);
    });
});
