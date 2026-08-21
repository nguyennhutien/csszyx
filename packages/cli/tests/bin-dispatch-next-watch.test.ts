/**
 * bin.ts next-watch action end-to-end: dispatching `next-watch --cwd <dir>`
 * through cac reaches the command, and its exit code becomes the process's.
 *
 * The no-match case is the one a dispatch test can assert on: it returns
 * instead of starting a file watcher, so the command is exercised end to end
 * without leaving one running past the test.
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

describe('bin next-watch dispatch (real command)', () => {
    it('carries the command exit code out to the process', async () => {
        const errors: string[] = [];
        vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
            errors.push(parts.join(' '));
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        // A project with nothing to watch: the command fails rather than
        // starting a watcher, so the dispatch is exercised and nothing is left
        // running afterwards.
        cwd = mkdtempSync(join(tmpdir(), 'csszyx-bin-nw-'));

        process.argv = ['node', 'csszyx', 'next-watch', '--cwd', cwd];
        await import('../src/bin.js?scenario=next-watch-no-match');
        // Poll for the effect this test is about rather than sleeping a fixed
        // span: the action is async and loads its command module on demand.
        for (let waited = 0; waited < 10_000 && process.exitCode === undefined; waited += 25) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        expect(errors.join('\n')).toContain('No source files matched');
        expect(process.exitCode).toBe(1);
    }, 15000);
});
