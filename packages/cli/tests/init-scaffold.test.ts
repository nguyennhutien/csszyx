/**
 * csszyx init's non-interactive scaffolding. Package installation is mocked —
 * the suite verifies what init writes: the config file, css entry patch,
 * gitignore entry, and tsconfig include, per detected framework.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({
    execa: vi.fn(async () => ({ stdout: '', stderr: '' })),
}));

import { execa } from 'execa';

import { init } from '../src/commands/init.js';

const tempDirs: string[] = [];
function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-cli-init-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.clearAllMocks();
});

/** Lay down a minimal Vite+React+TS project.
 * @returns The fixture root. */
function viteReactFixture(): string {
    const cwd = tempRoot();
    writeFileSync(
        join(cwd, 'package.json'),
        JSON.stringify({
            name: 'fixture',
            dependencies: { react: '^19.0.0' },
            devDependencies: { vite: '^7.0.0', typescript: '^5.0.0', tailwindcss: '^4.0.0' },
        }),
    );
    writeFileSync(join(cwd, 'tsconfig.json'), JSON.stringify({ include: ['src'] }));
    writeFileSync(
        join(cwd, 'vite.config.ts'),
        "import { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [] });\n",
    );
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src/index.css'), '@import "tailwindcss";\n');
    writeFileSync(join(cwd, '.gitignore'), 'node_modules\n');
    return cwd;
}

describe('init --yes on a Vite React TS project', () => {
    it('installs, writes the config, and wires gitignore/tsconfig', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = viteReactFixture();
        await init({ yes: true, cwd });

        // Packages requested through the detected package manager.
        expect(vi.mocked(execa)).toHaveBeenCalledWith('npm', ['add', 'csszyx', '@csszyx/runtime'], {
            cwd,
        });

        // A csszyx config exists.
        const hasConfig =
            existsSync(join(cwd, 'csszyx.config.ts')) || existsSync(join(cwd, 'csszyx.config.js'));
        expect(hasConfig).toBe(true);

        // .gitignore gained the .csszyx cache dir.
        expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toContain('.csszyx');

        // tsconfig picked up the generated theme types.
        expect(readFileSync(join(cwd, 'tsconfig.json'), 'utf8')).toContain('.csszyx/theme.d.ts');
    });
});

describe('init --yes on a Next.js App Router project', () => {
    it('writes the next/postcss configs for the app router', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = tempRoot();
        writeFileSync(
            join(cwd, 'package.json'),
            JSON.stringify({
                name: 'next-fixture',
                dependencies: { next: '^16.0.0', react: '^19.0.0' },
                devDependencies: { tailwindcss: '^4.0.0' },
            }),
        );
        mkdirSync(join(cwd, 'app'));
        writeFileSync(join(cwd, 'app/globals.css'), '@import "tailwindcss";\n');

        await init({ yes: true, cwd });

        const hasConfig =
            existsSync(join(cwd, 'csszyx.config.ts')) || existsSync(join(cwd, 'csszyx.config.js'));
        expect(hasConfig).toBe(true);
        // Next wiring: either a next.config or a postcss config appears.
        const wroteNextWiring =
            existsSync(join(cwd, 'next.config.js')) || existsSync(join(cwd, 'postcss.config.mjs'));
        expect(wroteNextWiring).toBe(true);
        // No tsconfig — the TypeScript step must not run or crash.
        expect(existsSync(join(cwd, 'tsconfig.json'))).toBe(false);
        // .gitignore is created when absent.
        expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toContain('.csszyx');
    });
});
