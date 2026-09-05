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

        // The configs below name `@csszyx/unplugin/...` by package, and a
        // strict package manager (pnpm, Yarn PnP) only resolves a package
        // the project lists itself, not one `csszyx` depends on.
        expect(vi.mocked(execa)).toHaveBeenCalledWith(
            'npm',
            ['add', 'csszyx', '@csszyx/runtime', '@csszyx/unplugin'],
            expect.anything(),
        );
        // The config written below names `@tailwindcss/postcss`; the fixture
        // has `tailwindcss` but not the adapter, and a config that names a
        // package the project lacks fails `next dev` on the first run.
        expect(vi.mocked(execa)).toHaveBeenCalledWith(
            'npm',
            ['add', '-D', '@tailwindcss/postcss'],
            expect.anything(),
        );
        const hasConfig =
            existsSync(join(cwd, 'csszyx.config.ts')) || existsSync(join(cwd, 'csszyx.config.js'));
        expect(hasConfig).toBe(true);
        // Next wiring: either a next.config or a postcss config appears.
        const wroteNextWiring =
            existsSync(join(cwd, 'next.config.js')) || existsSync(join(cwd, 'postcss.config.mjs'));
        expect(wroteNextWiring).toBe(true);
        // The PostCSS config points Tailwind at csszyx's safelist, and does so
        // BEFORE Tailwind runs: `@tailwindcss/postcss` compiles in its own
        // `Once`, so a plugin listed after it is too late.
        const postcssConfig = readFileSync(join(cwd, 'postcss.config.mjs'), 'utf8');
        const csszyxAt = postcssConfig.indexOf("'@csszyx/unplugin/postcss': {}");
        const tailwindAt = postcssConfig.indexOf("'@tailwindcss/postcss': {}");
        expect(csszyxAt).toBeGreaterThanOrEqual(0);
        expect(tailwindAt).toBeGreaterThan(csszyxAt);
        // No tsconfig — the TypeScript step must not run or crash.
        expect(existsSync(join(cwd, 'tsconfig.json'))).toBe(false);
        // .gitignore is created when absent.
        expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toContain('.csszyx');
    });
});

describe('init interactive path with mocked prompts', () => {
    it('honours the answers instead of the defaults', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.doMock('prompts', () => ({
            default: vi.fn(async () => ({
                installTailwind: false,
                enableSSR: false,
                enableRecovery: false,
                setupGitignore: false,
                setupTsconfig: false,
            })),
        }));
        vi.resetModules();
        const { init: interactiveInit } = await import('../src/commands/init.js');
        const cwd = viteReactFixture();
        await interactiveInit({ cwd });

        // Config written with the answered (disabled) flags. It no longer
        // scaffolds a `production` block: the one key it used to write was
        // `injectChecksum`, which nothing read — so a project started here
        // carried a switch that never moved anything.
        const config = (readFileSync(join(cwd, 'csszyx.config.ts'), 'utf8') as string) ?? '';
        expect(config).not.toContain('injectChecksum');
        expect(config).toContain('debug: true');
        // gitignore was declined — .csszyx not appended.
        expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).not.toContain('.csszyx');
        vi.doUnmock('prompts');
    });
});

describe('init CSS entry handling', () => {
    it('creates src/index.css when no entry exists, and prepends the import when missing', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        // No CSS at all → created.
        const bare = tempRoot();
        writeFileSync(
            join(bare, 'package.json'),
            JSON.stringify({ dependencies: { react: '^19' }, devDependencies: { vite: '^7' } }),
        );
        writeFileSync(join(bare, 'vite.config.ts'), 'export default {};');
        await init({ yes: true, cwd: bare });
        expect(readFileSync(join(bare, 'src/index.css'), 'utf8')).toContain('tailwindcss');

        // Entry exists but lacks the import → prepended, content kept.
        const partial = tempRoot();
        writeFileSync(
            join(partial, 'package.json'),
            JSON.stringify({ dependencies: { react: '^19' }, devDependencies: { vite: '^7' } }),
        );
        writeFileSync(join(partial, 'vite.config.ts'), 'export default {};');
        mkdirSync(join(partial, 'src'));
        writeFileSync(join(partial, 'src/index.css'), '.custom { color: red }\n');
        await init({ yes: true, cwd: partial });
        const css = readFileSync(join(partial, 'src/index.css'), 'utf8');
        expect(css).toContain('tailwindcss');
        expect(css).toContain('.custom');
    });
});
