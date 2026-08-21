import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '../src/commands/check.js';

const dirs: string[] = [];

function projectWith(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-cli-check-'));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
        const full = join(dir, rel);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, content);
    }
    return dir;
}

afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('csszyx check', () => {
    it('reports unknown and aliased sz keys with their file location and fails the run', async () => {
        // The report is printed through the terminal-ui helpers (console.log).
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = projectWith({
            'src/Bad.tsx':
                "export const Bad = () => <div sz={{ pading: 4, fontWeight: 'bold' }} />;",
            'src/Good.tsx': "export const Good = () => <div sz={{ p: 4, weight: 'bold' }} />;",
        });

        await check({ cwd });

        // The captured diagnostics are reported (not re-warned one-by-one) and the
        // run is failed so CI can gate on it.
        const reported = log.mock.calls.map(call => call.join(' ')).join('\n');
        expect(reported).toContain('Bad.tsx');
        expect(reported).toContain('pading');
        expect(reported).toContain('weight'); // suggestion for fontWeight
        expect(reported).not.toContain('Good.tsx');
        expect(process.exitCode).toBe(1);
    });

    it('passes cleanly when every sz key is canonical', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = projectWith({
            'src/Good.tsx': "export const Good = () => <div sz={{ p: 4, weight: 'bold' }} />;",
        });

        await check({ cwd });

        expect(process.exitCode).not.toBe(1);
    });
});

describe('csszyx check — when the file scan itself fails', () => {
    it('fails the run and says why, rather than reporting a clean empty scan', async () => {
        // `--cwd` pointing at a file instead of a directory. The scan throws
        // ENOTDIR, and the alternative to this branch is a run that found zero
        // files, printed "no issues found" and exited 0 — a gate reporting
        // success for a project it never opened.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = projectWith({ 'src/App.tsx': 'export const A = () => <div sz={{ p: 4 }} />;' });

        await check({ cwd: join(cwd, 'src/App.tsx') });

        expect(log.mock.calls.map(call => call.join(' ')).join('\n')).toContain(
            'Could not scan files',
        );
        expect(process.exitCode).toBe(1);
    });
});
