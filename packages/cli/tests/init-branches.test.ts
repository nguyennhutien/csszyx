/**
 * Branch coverage for init()'s framework/config permutations: the Vite Tailwind
 * package choice, vite.config injection variants (missing config, already wired,
 * tailwindcss present), the Next.js postcss/next-config existing-file paths, the
 * unknown-framework manual-instructions branch, tsconfig.app.json fallback, and
 * the sz-types append path. execa is mocked so nothing is actually installed.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn(async () => ({ stdout: '', stderr: '' })) }));

import { init } from '../src/commands/init.js';

const dirs: string[] = [];
function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-init-br-'));
    dirs.push(dir);
    return dir;
}
function write(root: string, rel: string, content: string): void {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
}
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.clearAllMocks();
});
function mute(): void {
    vi.spyOn(console, 'log').mockImplementation(() => {});
}

describe('init Vite plugin injection', () => {
    it('installs the Vite Tailwind package and wires an empty vite.config', async () => {
        mute();
        const cwd = tempRoot();
        write(
            cwd,
            'package.json',
            JSON.stringify({ dependencies: { vue: '^3', vite: '^7' }, devDependencies: {} }),
        );
        write(cwd, 'tsconfig.json', JSON.stringify({ include: ['src'] }));
        write(
            cwd,
            'vite.config.ts',
            "import { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [] });\n",
        );
        await init({ yes: true, cwd });
        const config = readFileSync(join(cwd, 'vite.config.ts'), 'utf8');
        // csszyx injected before tailwindcss; tailwindcss import added (was absent).
        expect(config).toContain('...csszyx()');
        expect(config).toContain("import tailwindcss from '@tailwindcss/vite'");
        // tsconfig picked up the theme types.
        expect(readFileSync(join(cwd, 'tsconfig.json'), 'utf8')).toContain('.csszyx/theme.d.ts');
    });

    it('leaves a vite.config that already references csszyx untouched', async () => {
        mute();
        const cwd = tempRoot();
        write(
            cwd,
            'package.json',
            JSON.stringify({
                dependencies: { react: '^19', vite: '^7' },
                devDependencies: { tailwindcss: '^4' },
            }),
        );
        const original =
            "import csszyx from 'csszyx/vite';\nexport default { plugins: [...csszyx()] };\n";
        write(cwd, 'vite.config.ts', original);
        write(cwd, 'src/index.css', '@import "tailwindcss";\n');
        await init({ yes: true, cwd });
        expect(readFileSync(join(cwd, 'vite.config.ts'), 'utf8')).toBe(original);
    });

    it('prints manual instructions when no vite.config exists', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...p: unknown[]) => logs.push(p.join(' ')));
        const cwd = tempRoot();
        write(
            cwd,
            'package.json',
            JSON.stringify({
                dependencies: { react: '^19', vite: '^7' },
                devDependencies: { tailwindcss: '^4' },
            }),
        );
        write(cwd, 'src/index.css', '@import "tailwindcss";\n');
        await init({ yes: true, cwd });
        expect(logs.join('\n')).toContain('Could not auto-inject');
    });

    it('does not duplicate tailwindcss when the config already imports and uses it', async () => {
        mute();
        const cwd = tempRoot();
        write(
            cwd,
            'package.json',
            JSON.stringify({
                dependencies: { react: '^19', vite: '^7' },
                devDependencies: { tailwindcss: '^4' },
            }),
        );
        write(
            cwd,
            'vite.config.ts',
            [
                "import { defineConfig } from 'vite';",
                "import tailwindcss from '@tailwindcss/vite';",
                'export default defineConfig({ plugins: [tailwindcss()] });',
            ].join('\n'),
        );
        write(cwd, 'src/index.css', '@import "tailwindcss";\n');
        await init({ yes: true, cwd });
        const config = readFileSync(join(cwd, 'vite.config.ts'), 'utf8');
        // Exactly one tailwindcss import and one tailwindcss() call remain.
        expect(config.match(/@tailwindcss\/vite/g)).toHaveLength(1);
        expect(config.match(/tailwindcss\(\)/g)).toHaveLength(1);
        expect(config).toContain('...csszyx()');
    });
});

describe('init Next.js existing-config paths', () => {
    /**
     * Next reads `postcss` from package.json first, then `.postcssrc.json`,
     * `postcss.config.json`, `.postcssrc.js` and `postcss.config.{js,mjs,cjs}`.
     * A fresh `postcss.config.mjs` beside any of those would shadow or race
     * the author's file.
     */
    it.each([
        ['postcss.config.cjs', 'module.exports = { plugins: {} };\n'],
        ['.postcssrc.json', '{ "plugins": {} }\n'],
    ])(
        'keeps %s and prints the line to add instead of writing a new config',
        async (name, body) => {
            const logs: string[] = [];
            vi.spyOn(console, 'log').mockImplementation((...p: unknown[]) =>
                logs.push(p.join(' ')),
            );
            const cwd = tempRoot();
            write(
                cwd,
                'package.json',
                JSON.stringify({
                    dependencies: { next: '^16', react: '^19' },
                    devDependencies: {},
                }),
            );
            mkdirSync(join(cwd, 'app'));
            write(cwd, 'app/globals.css', '@import "tailwindcss";\n');
            write(cwd, name, body);
            await init({ yes: true, cwd });
            expect(readFileSync(join(cwd, name), 'utf8')).toBe(body);
            expect(existsSync(join(cwd, 'postcss.config.mjs'))).toBe(false);
            expect(logs.join('\n')).toContain("'@csszyx/unplugin/postcss': {}");
        },
    );

    it('treats a postcss key in package.json as the config Next will read', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...p: unknown[]) => logs.push(p.join(' ')));
        const cwd = tempRoot();
        write(
            cwd,
            'package.json',
            JSON.stringify({
                dependencies: { next: '^16', react: '^19' },
                devDependencies: {},
                postcss: { plugins: {} },
            }),
        );
        mkdirSync(join(cwd, 'app'));
        write(cwd, 'app/globals.css', '@import "tailwindcss";\n');
        await init({ yes: true, cwd });
        expect(existsSync(join(cwd, 'postcss.config.mjs'))).toBe(false);
        expect(logs.join('\n')).toContain("'@csszyx/unplugin/postcss': {}");
    });

    it('keeps an existing postcss config and warns when next.config lacks csszyx', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...p: unknown[]) => logs.push(p.join(' ')));
        const cwd = tempRoot();
        write(
            cwd,
            'package.json',
            JSON.stringify({ dependencies: { next: '^16', react: '^19' }, devDependencies: {} }),
        );
        mkdirSync(join(cwd, 'app'));
        write(cwd, 'app/globals.css', '@import "tailwindcss";\n');
        const postcss = 'export default { plugins: {} };\n';
        write(cwd, 'postcss.config.js', postcss);
        const nextCfg = 'module.exports = { reactStrictMode: true };\n';
        write(cwd, 'next.config.js', nextCfg);
        await init({ yes: true, cwd });
        // Existing postcss kept, no postcss.config.mjs created, and the one
        // line the author has to add is spelled out.
        expect(readFileSync(join(cwd, 'postcss.config.js'), 'utf8')).toBe(postcss);
        expect(existsSync(join(cwd, 'postcss.config.mjs'))).toBe(false);
        expect(logs.join('\n')).toContain("'@csszyx/unplugin/postcss': {}");
        // next.config left alone (too risky) and the manual warning printed.
        expect(readFileSync(join(cwd, 'next.config.js'), 'utf8')).toBe(nextCfg);
        expect(logs.join('\n')).toContain('Could not auto-inject');
    });
});

describe('init unknown framework', () => {
    it('prints bundler-agnostic manual instructions', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...p: unknown[]) => logs.push(p.join(' ')));
        const cwd = tempRoot();
        write(cwd, 'package.json', JSON.stringify({ name: 'plain', dependencies: {} }));
        await init({ yes: true, cwd });
        expect(logs.join('\n')).toContain('Add csszyx plugin to your bundler config');
    });
});

describe('init tsconfig and sz-types edge paths', () => {
    it('falls back to tsconfig.app.json when tsconfig.json is absent', async () => {
        mute();
        const cwd = tempRoot();
        write(
            cwd,
            'package.json',
            JSON.stringify({
                dependencies: { react: '^19', vite: '^7' },
                devDependencies: { tailwindcss: '^4' },
            }),
        );
        // hasTypeScript is satisfied by jsconfig.json; tsconfig.json is missing.
        write(cwd, 'jsconfig.json', '{}');
        write(cwd, 'tsconfig.app.json', '{\n  "include": ["src"]\n}\n');
        write(cwd, 'vite.config.ts', 'export default { plugins: [] };');
        write(cwd, 'src/index.css', '@import "tailwindcss";\n');
        await init({ yes: true, cwd });
        // The theme types landed in the fallback tsconfig.app.json.
        expect(readFileSync(join(cwd, 'tsconfig.app.json'), 'utf8')).toContain('.csszyx');
    });

    it('is a no-op on a tsconfig already referencing .csszyx and appends only the missing sz reference', async () => {
        mute();
        const cwd = tempRoot();
        write(
            cwd,
            'package.json',
            JSON.stringify({
                dependencies: { react: '^19', vite: '^7' },
                devDependencies: { tailwindcss: '^4' },
            }),
        );
        // tsconfig already mentions .csszyx AND already includes csszyx-env.d.ts.
        write(
            cwd,
            'tsconfig.json',
            JSON.stringify({ include: ['src', './.csszyx/theme.d.ts', 'csszyx-env.d.ts'] }),
        );
        // An existing env file without the jsx reference → append path.
        write(cwd, 'csszyx-env.d.ts', '// pre-existing header\n');
        write(cwd, 'vite.config.ts', 'export default { plugins: [] };');
        write(cwd, 'src/index.css', '@import "tailwindcss";\n');
        await init({ yes: true, cwd });
        const env = readFileSync(join(cwd, 'csszyx-env.d.ts'), 'utf8');
        expect(env).toContain('pre-existing header');
        expect(env).toContain('@csszyx/types/jsx');
    });
});

describe('init interactive prompts and default cwd', () => {
    it('runs the prompt path (no --yes) using the current working directory', async () => {
        mute();
        vi.doMock('prompts', () => ({
            default: vi.fn(async () => ({
                enableSSR: true,
                enableRecovery: true,
                setupGitignore: true,
                setupTsconfig: true,
            })),
        }));
        vi.resetModules();
        const { init: interactiveInit } = await import('../src/commands/init.js');
        const cwd = tempRoot();
        // hasTailwind true → the install-tailwind prompt is skipped (type: null);
        // hasTypeScript true → the tsconfig prompt is shown.
        write(
            cwd,
            'package.json',
            JSON.stringify({
                dependencies: { react: '^19', vite: '^7' },
                devDependencies: { tailwindcss: '^4' },
            }),
        );
        write(cwd, 'tsconfig.json', JSON.stringify({ include: ['src'] }));
        write(cwd, 'vite.config.ts', 'export default { plugins: [] };');
        write(cwd, 'src/index.css', '@import "tailwindcss";\n');
        const prev = process.cwd();
        try {
            process.chdir(cwd);
            await interactiveInit({}); // no cwd → process.cwd()
        } finally {
            process.chdir(prev);
        }
        expect(readFileSync(join(cwd, 'csszyx.config.ts'), 'utf8')).toContain(
            'injectChecksum: true',
        );
        vi.doUnmock('prompts');
    });
});
