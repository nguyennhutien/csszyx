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

vi.mock('fast-glob', () => ({
    default: () => Promise.reject('a bare string, not an Error'),
}));

import { check } from '../src/commands/check.js';

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('csszyx check — a scan that rejects with a non-Error', () => {
    it('reports what was thrown instead of an undefined message', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = mkdtempSync(join(tmpdir(), 'csszyx-scan-throw-'));
        dirs.push(cwd);

        await check({ cwd });

        const report = log.mock.calls.map(call => call.join(' ')).join('\n');
        expect(report).toContain('a bare string, not an Error');
        expect(report).not.toContain('undefined');
        expect(process.exitCode).toBe(1);
    });
});
