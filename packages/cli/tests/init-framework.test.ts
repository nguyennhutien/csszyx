/**
 * `csszyx init --framework`, the questions init asks, and what it installs for
 * a framework whose plugin lines it prints rather than writes.
 *
 * The flag was read by nobody: `--framework vite-vue` in a React repo set up
 * React, and a value no framework has ran the whole setup with the detected
 * one. Two prompts asked about switches nothing read. And for Nuxt, SvelteKit
 * and Astro init installed `@tailwindcss/postcss` while the lines it printed
 * imported `@tailwindcss/vite`, a package the project then did not have.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn(async () => ({ stdout: '', stderr: '' })) }));

const prompted = vi.hoisted(() => ({
    questions: [] as Array<{ name: string }>,
    answers: {} as Record<string, unknown>,
}));
vi.mock('prompts', () => ({
    default: vi.fn(async (questions: Array<{ name: string }>) => {
        prompted.questions.push(...questions);
        return prompted.answers;
    }),
}));

import { init } from '../src/commands/init.js';

const dirs: string[] = [];

/**
 * A project directory holding the given files.
 *
 * @param files - Paths and contents.
 * @returns The directory.
 */
function project(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-init-fw-'));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
        const full = join(dir, rel);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, content);
    }
    return dir;
}

/**
 * Capture everything init prints.
 *
 * @returns The printed lines, colour codes removed.
 */
function printed(): string[] {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        lines.push(stripVTControlCharacters(parts.join(' ')));
    });
    return lines;
}

/**
 * The arguments of every package-manager call init made.
 *
 * @returns One argument list per call, in order.
 */
function installs(): string[][] {
    return vi.mocked(execa).mock.calls.map(call => call[1] as string[]);
}

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    prompted.questions.length = 0;
    prompted.answers = {};
    process.exitCode = undefined;
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

const REACT_VITE = {
    'package.json': JSON.stringify({ dependencies: { react: '^19', vite: '^7' } }),
    'vite.config.ts':
        "import { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [] });\n",
};

describe('csszyx init --framework', () => {
    it('sets up the framework the flag names, not the detected one', async () => {
        const lines = printed();
        const cwd = project(REACT_VITE);

        await init({ yes: true, cwd, framework: 'nextjs-app' });

        // The Next.js setup: its packages, its next.config, no vite.config edit.
        expect(installs()).toContainEqual(['add', 'csszyx', '@csszyx/runtime', '@csszyx/unplugin']);
        expect(readFileSync(join(cwd, 'next.config.js'), 'utf8')).toContain('csszyxWebpack');
        expect(readFileSync(join(cwd, 'vite.config.ts'), 'utf8')).not.toContain('csszyx');
        // The flag chose it, so init does not claim to have detected it.
        expect(lines.join('\n')).not.toContain('Detected:');
        expect(lines.join('\n')).toContain('Framework: Next.js (App Router) (from `--framework`)');
    });

    it('refuses a framework it does not know before asking or installing anything', async () => {
        const lines = printed();
        const cwd = project(REACT_VITE);

        await init({ cwd, framework: 'vite-solid' });

        expect(lines.join('\n')).toContain(
            '✗ [csszyx] cli-option-invalid:\n' +
                '  `--framework vite-solid` is not a framework `csszyx init` knows, so the command did not run.\n' +
                '  help: pass `vite-react`, `vite-vue`, `vite-svelte`, `nextjs-app` or `nextjs-pages`, or leave it out for the detected one.\n' +
                '  note: `nuxt`, `sveltekit` and `astro` are accepted too; for them `csszyx init` prints the Vite plugin lines to add by hand.\n' +
                '  docs: https://csszyx.com/e/cli-option-invalid',
        );
        expect(process.exitCode).toBe(1);
        expect(prompted.questions).toEqual([]);
        expect(installs()).toEqual([]);
    });

    it('refuses `unknown`, which names no framework to set up', async () => {
        printed();
        await init({ yes: true, cwd: project(REACT_VITE), framework: 'unknown' });
        expect(process.exitCode).toBe(1);
        expect(installs()).toEqual([]);
    });
});

describe('csszyx init prompts', () => {
    it('asks only questions whose answer changes what init does', async () => {
        printed();
        await init({ cwd: project(REACT_VITE) });

        expect(prompted.questions.map(question => question.name)).toEqual([
            'installTailwind',
            'setupGitignore',
            'setupTsconfig',
        ]);
    });
});

describe('csszyx init for a framework whose plugin lines it prints', () => {
    // Nuxt, SvelteKit and Astro all build through Vite, and Tailwind's own
    // guide for each adds `@tailwindcss/vite`: the package the printed lines
    // import is the one init installs.
    it.each([
        ['Nuxt 3', 'nuxt', 'nuxt.config.ts', 'vite: {'],
        ['SvelteKit', '@sveltejs/kit', 'vite.config.ts', 'sveltekit()'],
        ['Astro', 'astro', 'astro.config.mjs', 'vite: {'],
    ])(
        'installs the Vite Tailwind plugin for %s and prints its config lines',
        async (name, dependency, file, shape) => {
            const lines = printed();
            const cwd = project({
                'package.json': JSON.stringify({ dependencies: { [dependency]: '*' } }),
            });

            await init({ yes: true, cwd });

            expect(installs()).toContainEqual(['add', '-D', 'tailwindcss', '@tailwindcss/vite']);
            expect(installs().flat()).not.toContain('@tailwindcss/postcss');
            const output = lines.join('\n');
            expect(output).toContain(`Detected: ${name}`);
            expect(output).toContain(`Add csszyx to \`${file}\`:`);
            expect(output).toContain("import tailwindcss from '@tailwindcss/vite';");
            expect(output).toContain(shape);
        },
    );
});

describe('the config lines init prints for Nuxt, SvelteKit and Astro', () => {
    // Pasted as printed, each file must load: Nuxt auto-imports only
    // `defineNuxtConfig`, while Astro and SvelteKit import `defineConfig`
    // from their own module. The stylesheet init created is served only once
    // something imports it, so the lines say where.
    it.each([
        [
            'nuxt',
            'ℹ Add csszyx to `nuxt.config.ts`:\n' +
                '\n' +
                "  import csszyx from 'csszyx/vite';\n" +
                "  import tailwindcss from '@tailwindcss/vite';\n" +
                '\n' +
                '  export default defineNuxtConfig({\n' +
                '    // ...your existing options\n' +
                "    css: ['~~/src/index.css'],\n" +
                '    vite: {\n' +
                '      plugins: [\n' +
                '        ...csszyx(),      // csszyx MUST come before tailwindcss\n' +
                '        tailwindcss(),\n' +
                '      ],\n' +
                '    },\n' +
                '  });\n',
        ],
        [
            'astro',
            'ℹ Add csszyx to `astro.config.mjs`:\n' +
                '\n' +
                '  // @ts-check\n' +
                "  import { defineConfig } from 'astro/config';\n" +
                "  import csszyx from 'csszyx/vite';\n" +
                "  import tailwindcss from '@tailwindcss/vite';\n" +
                '\n' +
                '  export default defineConfig({\n' +
                '    // ...your existing options\n' +
                '    vite: {\n' +
                '      plugins: [\n' +
                '        ...csszyx(),      // csszyx MUST come before tailwindcss\n' +
                '        tailwindcss(),\n' +
                '      ],\n' +
                '    },\n' +
                '  });\n' +
                '\n' +
                "ℹ Import `src/index.css` in your root layout, for example `import '../index.css';` in the frontmatter of `src/layouts/Layout.astro`.",
        ],
        [
            '@sveltejs/kit',
            'ℹ Add csszyx to `vite.config.ts`:\n' +
                '\n' +
                "  import { sveltekit } from '@sveltejs/kit/vite';\n" +
                "  import { defineConfig } from 'vite';\n" +
                "  import csszyx from 'csszyx/vite';\n" +
                "  import tailwindcss from '@tailwindcss/vite';\n" +
                '\n' +
                '  export default defineConfig({\n' +
                '    plugins: [\n' +
                '      ...csszyx(),      // csszyx MUST come before tailwindcss\n' +
                '      tailwindcss(),\n' +
                '      sveltekit(),\n' +
                '    ],\n' +
                '  });\n' +
                '\n' +
                "ℹ Import `src/index.css` in `src/routes/+layout.svelte`: `import '../index.css';` in its `<script>`.",
        ],
    ])('prints lines for %s that load as pasted', async (dependency, expected) => {
        const lines = printed();
        const cwd = project({
            'package.json': JSON.stringify({ dependencies: { [dependency]: '*' } }),
        });

        await init({ yes: true, cwd });

        expect(lines.join('\n')).toContain(expected);
    });

    it('names the stylesheet init edited, by its path from the config', async () => {
        const lines = printed();
        const cwd = project({
            'package.json': JSON.stringify({ dependencies: { nuxt: '*' } }),
            'app/globals.css': 'body { margin: 0; }\n',
        });

        await init({ yes: true, cwd });

        expect(lines.join('\n')).toContain("    css: ['~~/app/globals.css'],\n");
    });

    it.each([
        ['nuxt', 'css: ['],
        ['astro', 'in your root layout'],
        ['@sveltejs/kit', '+layout.svelte'],
    ])(
        'leaves the stylesheet step out for %s when init did not touch a stylesheet',
        async (dependency, step) => {
            const lines = printed();
            const cwd = project({
                'package.json': JSON.stringify({
                    dependencies: { [dependency]: '*' },
                    devDependencies: { tailwindcss: '^4', '@tailwindcss/vite': '^4' },
                }),
            });

            await init({ yes: true, cwd });

            const output = lines.join('\n');
            expect(output).toContain('Add csszyx to');
            expect(output).not.toContain(step);
            expect(output).not.toContain('which this project does not list');
        },
    );

    it('says how to add `@tailwindcss/vite` when Tailwind is there without it', async () => {
        const lines = printed();
        const cwd = project({
            'package.json': JSON.stringify({
                dependencies: { astro: '*' },
                devDependencies: { tailwindcss: '^4', '@tailwindcss/postcss': '^4' },
            }),
            'pnpm-lock.yaml': '',
        });

        await init({ yes: true, cwd });

        expect(installs().flat()).not.toContain('@tailwindcss/vite');
        expect(lines.join('\n')).toContain(
            '  });\n' +
                '\n' +
                'ℹ The lines above import `@tailwindcss/vite`, which this project does not list: run `pnpm add -D @tailwindcss/vite`.',
        );
    });
});

describe('csszyx init for a Vite project on Tailwind without `@tailwindcss/vite`', () => {
    // A project already on Tailwind through PostCSS does not have the plugin
    // the edited config or the printed lines import, and init installs nothing
    // for Tailwind when Tailwind is there.
    const POSTCSS_TAILWIND = { tailwindcss: '^4', '@tailwindcss/postcss': '^4' };

    it('says how to add it after writing its import into `vite.config.ts`', async () => {
        const lines = printed();
        const cwd = project({
            ...REACT_VITE,
            'package.json': JSON.stringify({
                dependencies: { react: '^19', vite: '^7' },
                devDependencies: POSTCSS_TAILWIND,
            }),
            'pnpm-lock.yaml': '',
        });

        await init({ yes: true, cwd });

        expect(readFileSync(join(cwd, 'vite.config.ts'), 'utf8')).toContain(
            "import tailwindcss from '@tailwindcss/vite';",
        );
        expect(lines.join('\n')).toContain(
            'ℹ Injected csszyx plugin into vite.config.ts\n' +
                'ℹ `vite.config.ts` now imports `@tailwindcss/vite`, which this project does not list: run `pnpm add -D @tailwindcss/vite`.',
        );
    });

    it('says nothing when the config already imported it', async () => {
        const lines = printed();
        const cwd = project({
            'package.json': JSON.stringify({
                dependencies: { react: '^19', vite: '^7' },
                devDependencies: POSTCSS_TAILWIND,
            }),
            'vite.config.ts':
                "import { defineConfig } from 'vite';\nimport tailwindcss from '@tailwindcss/vite';\nexport default defineConfig({ plugins: [tailwindcss()] });\n",
        });

        await init({ yes: true, cwd });

        expect(lines.join('\n')).toContain('Injected csszyx plugin into vite.config.ts');
        expect(lines.join('\n')).not.toContain('which this project does not list');
    });

    it('says how to add it under the lines it prints when it cannot edit the config', async () => {
        const lines = printed();
        const cwd = project({
            'package.json': JSON.stringify({
                dependencies: { vue: '^3', vite: '^7' },
                devDependencies: POSTCSS_TAILWIND,
            }),
        });

        await init({ yes: true, cwd });

        expect(lines.join('\n')).toContain(
            '  });\n' +
                '\n' +
                'ℹ The lines above import `@tailwindcss/vite`, which this project does not list: run `npm add -D @tailwindcss/vite`.',
        );
    });

    it.each(['vite-react', 'astro'] as const)(
        'finishes for a project with no package.json that `--framework %s` names',
        async framework => {
            // Declining Tailwind leaves the plugin to the project, and a project
            // with no package.json lists nothing: there is nothing to read.
            const lines = printed();
            prompted.answers = { installTailwind: false };
            const cwd = project({});

            await init({ cwd, framework });

            const output = lines.join('\n');
            expect(output).toContain(
                'ℹ The lines above import `@tailwindcss/vite`, which this project does not list: run `npm add -D @tailwindcss/vite`.',
            );
            expect(output).toContain('All done!');
        },
    );
});

describe('the vite.config lines init prints when it edits none', () => {
    // Pasted as printed, the file must load: `defineConfig` is Vite's, and an
    // unimported name is a ReferenceError when Vite loads the config.
    const LINES =
        "  import { defineConfig } from 'vite';\n" +
        "  import csszyx from 'csszyx/vite';\n" +
        "  import tailwindcss from '@tailwindcss/vite';\n" +
        '\n' +
        '  export default defineConfig({\n' +
        '    plugins: [\n' +
        '      ...csszyx(),      // csszyx MUST come before tailwindcss\n' +
        '      tailwindcss(),\n' +
        '      // ...your other plugins\n' +
        '    ],\n' +
        '  });\n';

    const VUE_VITE = JSON.stringify({ dependencies: { vue: '^3', vite: '^7' } });

    it.each([
        ['an unknown framework', { 'package.json': JSON.stringify({ name: 'plain' }) }],
        ['a Vite project without a vite.config', { 'package.json': VUE_VITE }],
        [
            'a vite.config with no `plugins` list to add to',
            {
                'package.json': VUE_VITE,
                'vite.config.ts':
                    "import { defineConfig } from 'vite';\nexport default defineConfig({});\n",
            },
        ],
    ])('import `defineConfig` for %s', async (_name, files) => {
        const lines = printed();
        const cwd = project(files);

        await init({ yes: true, cwd });

        expect(lines.join('\n')).toContain(`:\n\n${LINES}`);
    });
});
