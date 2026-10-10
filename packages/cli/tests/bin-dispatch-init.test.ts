/**
 * bin.ts init action end-to-end: dispatching `init --yes --cwd <dir>` through
 * cac scaffolds the named project without prompting.
 *
 * Package installation is mocked — what the dispatch has to prove is that the
 * options reach the command and it runs against the directory it was given,
 * not that npm works.
 *
 * One bin dispatch per file (see bin-dispatch-migrate.test.ts for why).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({
    execa: vi.fn(async () => ({ stdout: '', stderr: '' })),
}));

// The scaffold's last write lands well after the gitignore, the way it can on a
// loaded runner: a test that stops at the gitignore then removes the directory
// while the command is still writing into it (ENOTEMPTY on #347).
vi.mock('fs-extra', async importOriginal => {
    const actual = await importOriginal<typeof import('fs-extra')>();
    const writeFile = async (...args: Parameters<typeof actual.writeFile>): Promise<void> => {
        if (String(args[0]).endsWith('csszyx-env.d.ts')) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return actual.writeFile(...args);
    };
    return { ...actual, writeFile, default: { ...actual.default, writeFile } };
});

const ORIGINAL_ARGV = process.argv;
let cwd: string;

afterEach(() => {
    process.argv = ORIGINAL_ARGV;
    if (cwd) rmSync(cwd, { recursive: true, force: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('bin init dispatch (real command)', () => {
    it('scaffolds the project named by --cwd without prompting', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        cwd = mkdtempSync(join(tmpdir(), 'csszyx-bin-init-'));
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

        const hasConfig = (): boolean => existsSync(join(cwd, 'csszyx.config.mts'));

        process.argv = ['node', 'csszyx', 'init', '--yes', '--cwd', cwd];
        await import('../src/bin.js?scenario=init-yes');
        // Wait for the command to finish, not for an effect partway through:
        // it goes on writing after the config and the gitignore, and a test
        // that stops there removes the directory under those writes. Its last
        // line is printed once every file is on disk.
        const finished = (): boolean =>
            log.mock.calls.some(call => String(call[0]).includes('Check the docs'));
        for (let waited = 0; waited < 10_000 && !finished(); waited += 25) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        expect(finished()).toBe(true);
        expect(existsSync(join(cwd, 'csszyx-env.d.ts'))).toBe(true);
        expect(hasConfig()).toBe(true);
        // --yes took the defaults rather than waiting on a prompt.
        expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toContain('.csszyx');
    }, 15000);
});
