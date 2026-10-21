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

const prompted = vi.hoisted(() => ({ questions: [] as Array<{ name: string }> }));
vi.mock('prompts', () => ({
    default: vi.fn(async (questions: Array<{ name: string }>) => {
        prompted.questions.push(...questions);
        return {};
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
        expect(lines.join('\n')).toContain('Framework: Next.js (App Router) (from --framework)');
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
            expect(output).toContain(`Add csszyx to ${file}:`);
            expect(output).toContain("import tailwindcss from '@tailwindcss/vite';");
            expect(output).toContain(shape);
        },
    );
});
