/**
 * bin.ts check action end-to-end: `csszyx check <dir>` reaches the command as
 * a directory instead of failing on an unused argument, the way
 * `migrate [dir]` already did. One bin dispatch per file (see
 * bin-dispatch-migrate.test.ts for why).
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

describe('bin check dispatch with a directory (real command)', () => {
    it('scans the directory given as a positional argument', async () => {
        const logs: string[] = [];
        const record = (...parts: unknown[]) => {
            logs.push(parts.join(' '));
        };
        vi.spyOn(console, 'log').mockImplementation(record);
        vi.spyOn(console, 'error').mockImplementation(record);
        cwd = mkdtempSync(join(tmpdir(), 'csszyx-bin-check-dir-'));
        mkdirSync(join(cwd, 'src'));
        mkdirSync(join(cwd, 'other'));
        writeFileSync(
            join(cwd, 'src/Bad.tsx'),
            'export const B = () => <div sz={{ pading: 4 }} />;',
        );
        // Flags too, but sits outside the directory the run was pointed at.
        writeFileSync(
            join(cwd, 'other/Also.tsx'),
            'export const A = () => <div sz={{ pading: 4 }} />;',
        );

        process.argv = ['node', 'csszyx', 'check', 'src', '--cwd', cwd];
        await import('../src/bin.js?scenario=check-dir-positional');
        // `process.exitCode` is reset in afterEach and set when the command
        // completes — see bin-dispatch-check.test.ts for why a fixed sleep is not.
        for (let waited = 0; waited < 10_000 && process.exitCode === undefined; waited += 25) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        const out = logs.join('\n');
        expect(out).not.toContain('Unused args');
        expect(out).toContain('Bad.tsx');
        expect(out).not.toContain('Also.tsx');
        expect(process.exitCode).toBe(1);
    }, 15000);
});
