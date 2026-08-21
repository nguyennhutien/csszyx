/**
 * bin.ts generate-types action end-to-end: dispatching `generate-types` with
 * the short `-c`/`-o` aliases through cac reaches the command with the config
 * to read and the file to write.
 *
 * One bin dispatch per file (see bin-dispatch-migrate.test.ts for why).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ARGV = process.argv;
let cwd: string;

afterEach(() => {
    process.argv = ORIGINAL_ARGV;
    if (cwd) rmSync(cwd, { recursive: true, force: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('bin generate-types dispatch (real command)', () => {
    it('reads the config -c names and writes the declarations to -o', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        cwd = mkdtempSync(join(tmpdir(), 'csszyx-bin-types-'));
        const config = join(cwd, 'tailwind.config.mjs');
        writeFileSync(
            config,
            'export default { theme: { extend: { colors: { brand: "#123456" } } } };',
        );
        const output = join(cwd, 'csszyx-theme.d.ts');

        process.argv = [
            'node',
            'csszyx',
            'generate-types',
            '-c',
            config,
            '-o',
            output,
            '--cwd',
            cwd,
        ];
        await import('../src/bin.js?scenario=generate-types-short-flags');
        // Poll for the effect this test is about rather than sleeping a fixed
        // span: the action is async and loads its command module on demand.
        for (let waited = 0; waited < 10_000 && !existsSync(output); waited += 25) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        expect(readFileSync(output, 'utf8')).toContain('brand');
    }, 15000);
});
