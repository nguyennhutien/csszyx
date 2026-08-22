/**
 * A `--pattern` typed the Windows way must reach the same files as the
 * posix spelling.
 *
 * fast-glob reads `\` as an escape character, so `src\**\*.tsx` used to
 * become the literal `src***.tsx`, match nothing, and let a command report
 * zero files as a clean result. `check` was fixed first; these pin the same
 * door for the commands that share it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../src/commands/migrate.js';
import { scanCollisions } from '../src/commands/scan-collisions.js';

let cwd = '';

afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    if (cwd) rmSync(cwd, { recursive: true, force: true });
});

function project(): string {
    cwd = mkdtempSync(join(tmpdir(), 'csszyx-winpat-'));
    mkdirSync(join(cwd, 'src'));
    mkdirSync(join(cwd, 'styles'));
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'fixture' }));
    writeFileSync(
        join(cwd, 'src/App.tsx'),
        'export const App = () => <div className="p-4 bg-blue-500">hi</div>;\n',
    );
    writeFileSync(join(cwd, 'styles/a.css'), '.x { color: red }\n');
    return cwd;
}

describe('a Windows-style --pattern', () => {
    it('reaches the same files in migrate', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const root = project();

        await migrate({ cwd: root, pattern: 'src\\**\\*.tsx' });

        expect(readFileSync(join(root, 'src/App.tsx'), 'utf8')).toContain('sz={{');
    });

    it('reaches the same files in scan-collisions', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const root = project();

        await scanCollisions({ cwd: root, pattern: 'styles\\**\\*.css' });

        const out = log.mock.calls.map(c => c.join(' ')).join('\n');
        // `.x` is token-shaped, so a scan that actually read the file reports it.
        expect(out).toContain('mangleExclude: ["x"]');
    });
});
