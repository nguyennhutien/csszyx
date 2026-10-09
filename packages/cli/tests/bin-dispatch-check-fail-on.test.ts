/**
 * bin.ts passes `--fail-on` through to `check`: a project whose only finding
 * is an `info` note passes by default and fails under `--fail-on info`.
 * One bin dispatch per file (see bin-dispatch-migrate.test.ts for why).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

describe('bin check dispatch --fail-on', () => {
    it('fails the run on an info finding when told to', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...p: unknown[]) => {
            logs.push(p.join(' '));
        });
        cwd = mkdtempSync(join(tmpdir(), 'csszyx-bin-check-fail-on-'));
        mkdirSync(join(cwd, 'src'));
        writeFileSync(
            join(cwd, 'src/A.tsx'),
            'export const A = (props) => <div className={props.className} sz={{ p: 4 }} />;',
        );

        process.argv = ['node', 'csszyx', 'check', '--cwd', cwd, '--fail-on', 'info'];
        await import('../src/bin.js?scenario=check-fail-on');
        // Done when the exit code is set; see bin-dispatch-check.test.ts.
        for (let waited = 0; waited < 10_000 && process.exitCode === undefined; waited += 25) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        expect(logs.join('\n')).toContain('(info)');
        expect(process.exitCode).toBe(1);
    }, 15000);
});
