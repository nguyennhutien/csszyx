/**
 * `audit` once registered `--watch` and passed it into a command that never
 * read it, so the flag ran a plain audit and reported nothing about being
 * ignored. The option surface is what a user meets, so the proof the flag is
 * gone is cac rejecting it: a registered option dispatches the action, an
 * unregistered one raises CACError and the bin turns that into a message plus
 * help with exit code 1.
 *
 * One bin dispatch per file (see bin-dispatch-migrate.test.ts for why);
 * `--compare` has its own file for the same reason.
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

describe('bin audit option surface', () => {
    it('rejects --watch instead of accepting it and doing nothing', async () => {
        const errors: string[] = [];
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
            errors.push(parts.join(' '));
        });
        cwd = mkdtempSync(join(tmpdir(), 'csszyx-bin-audit-watch-'));

        process.argv = ['node', 'csszyx', 'audit', '--watch', '--cwd', cwd];
        await import('../src/bin.js?scenario=audit-watch');

        expect(errors.join('\n')).toContain('Unknown option `--watch`');
        expect(process.exitCode).toBe(1);
    }, 15000);
});
