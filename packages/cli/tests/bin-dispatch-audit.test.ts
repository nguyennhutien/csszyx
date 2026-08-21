/**
 * bin.ts audit action end-to-end: dispatching `audit --json --cwd <dir>`
 * through cac puts one parseable document on stdout for the named project.
 *
 * One bin dispatch per file (see bin-dispatch-migrate.test.ts for why).
 */
import { mkdtempSync, rmSync } from 'node:fs';
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

describe('bin audit dispatch (real command)', () => {
    it('honours --json, so the output parses instead of reading as prose', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
            logs.push(parts.join(' '));
        });
        cwd = mkdtempSync(join(tmpdir(), 'csszyx-bin-audit-'));

        process.argv = ['node', 'csszyx', 'audit', '--json', '--cwd', cwd];
        await import('../src/bin.js?scenario=audit-json');
        for (let waited = 0; waited < 10_000 && logs.length === 0; waited += 25) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        expect(JSON.parse(logs.join('\n'))).toHaveProperty('totalClasses');
    }, 15000);
});
