/**
 * `csszyx check` when the file scan rejects with something that is not an Error.
 *
 * The scan is third-party code reached through a promise, and a rejected
 * promise can carry anything — a string, a plain object, a value from a native
 * binding. Reading `.message` off one of those puts `undefined` in the report
 * and leaves the user with a failed run that explains nothing, which is worse
 * than the failure itself: it looks like a bug in this command.
 *
 * Mocked rather than provoked, because there is no input that makes fast-glob
 * reject with a non-Error — the real ENOTDIR case is covered against the real
 * library in `check-command.test.ts`. Its own file so the mock reaches only
 * this case.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const rejected = vi.hoisted(() => ({ reason: 'a bare string, not an Error' as unknown }));
vi.mock('fast-glob', () => ({ default: () => Promise.reject(rejected.reason) }));

import { check } from '../src/commands/check.js';
import { migrate } from '../src/commands/migrate.js';
import { nextPrebuild } from '../src/commands/next-prebuild.js';
import { nextWatch } from '../src/commands/next-watch.js';
import { scanCollisions } from '../src/commands/scan-collisions.js';

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
    rejected.reason = 'a bare string, not an Error';
});

describe('csszyx check — a scan that rejects with a non-Error', () => {
    it('reports the message of a stylesheet scan Error', async () => {
        rejected.reason = new Error('EACCES: stylesheet directory denied');
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        await scanCollisions();
        expect(log.mock.calls.flat().join(' ')).toContain('EACCES: stylesheet directory denied');
        expect(process.exitCode).toBe(1);
    });
    it.each([nextPrebuild, nextWatch])(
        'returns a failure status for a Next scan rejection',
        async command => {
            const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
            const log = vi.spyOn(console, 'log').mockImplementation(() => {});
            const cwd = mkdtempSync(join(tmpdir(), 'csszyx-next-scan-throw-'));
            dirs.push(cwd);
            vi.spyOn(process, 'cwd').mockReturnValue(cwd);
            expect(await command()).toBe(1);
            expect([...errors.mock.calls, ...log.mock.calls].flat().join(' ')).toContain(
                'a bare string, not an Error',
            );
        },
    );
    it.each([
        [scanCollisions, 1],
        [migrate, undefined],
    ] as const)(
        'reports scan failure without losing the thrown value',
        async (command, exitCode) => {
            const log = vi.spyOn(console, 'log').mockImplementation(() => {});
            vi.spyOn(console, 'info').mockImplementation(() => {});
            const cwd = mkdtempSync(join(tmpdir(), 'csszyx-scan-throw-'));
            dirs.push(cwd);
            vi.spyOn(process, 'cwd').mockReturnValue(cwd);
            await command();
            expect(log.mock.calls.flat().join(' ')).toContain('a bare string, not an Error');
            expect(process.exitCode).toBe(exitCode);
        },
    );
    it('reports what was thrown instead of an undefined message', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = mkdtempSync(join(tmpdir(), 'csszyx-scan-throw-'));
        dirs.push(cwd);

        // A `--pattern` run lists its files through fast-glob; a default run
        // walks the project itself (ADR 0033).
        await check({ cwd, pattern: '**/*.tsx' });

        const report = log.mock.calls.map(call => call.join(' ')).join('\n');
        expect(report).toContain('a bare string, not an Error');
        expect(report).not.toContain('undefined');
        expect(process.exitCode).toBe(1);
    });
});
