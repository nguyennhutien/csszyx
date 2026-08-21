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
        vi.spyOn(console, 'log').mockImplementation(() => {});
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

        const hasConfig = (): boolean =>
            existsSync(join(cwd, 'csszyx.config.ts')) || existsSync(join(cwd, 'csszyx.config.js'));

        process.argv = ['node', 'csszyx', 'init', '--yes', '--cwd', cwd];
        await import('../src/bin.js?scenario=init-yes');
        // Poll for the effect this test is about rather than sleeping a fixed
        // span: the action is async and loads its command module on demand.
        for (let waited = 0; waited < 10_000 && !hasConfig(); waited += 25) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        expect(hasConfig()).toBe(true);
        // --yes took the defaults rather than waiting on a prompt.
        expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toContain('.csszyx');
    }, 15000);
});
