/**
 * bin.ts doctor action end-to-end: dispatching `doctor --verbose --cwd <dir>`
 * through cac reaches the command with both options against a real project.
 *
 * One bin dispatch per file (see bin-dispatch-migrate.test.ts for why).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

describe('bin doctor dispatch (real command)', () => {
    it('diagnoses the project named by --cwd, not the process working directory', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
            logs.push(parts.join(' '));
        });
        cwd = mkdtempSync(join(tmpdir(), 'csszyx-bin-doctor-'));
        // A project missing everything, so the report cannot be mistaken for
        // one produced against the repository this test runs in.
        writeFileSync(join(cwd, 'package.json'), '{}');

        process.argv = ['node', 'csszyx', 'doctor', '--verbose', '--cwd', cwd];
        await import('../src/bin.js?scenario=doctor-verbose');
        for (let waited = 0; waited < 10_000 && logs.length === 0; waited += 25) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        await new Promise(resolve => setTimeout(resolve, 100));

        const report = logs.join('\n');
        expect(report).toContain('issue(s)');
        expect(report).toContain('npm install -D tailwindcss');
    }, 15000);
});
