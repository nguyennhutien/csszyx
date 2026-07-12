/**
 * The nextWatch command wrapper: its no-match failure, the ready banner, and
 * the SIGINT-driven clean shutdown that the session-level suite skips.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextWatch } from '../src/commands/next-watch.js';

const tempDirs: string[] = [];
function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-nw-'));
    tempDirs.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('nextWatch command lifecycle', () => {
    it('fails with exit code 1 when no sources match', async () => {
        const errors: string[] = [];
        vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
            errors.push(parts.join(' '));
        });
        const code = await nextWatch({ cwd: tempRoot(), silent: true });
        expect(code).toBe(1);
        expect(errors.join('\n')).toContain('No source files matched');
    });

    it('starts, prints the banner, and shuts down cleanly on SIGINT', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
            logs.push(parts.join(' '));
        });
        const cwd = tempRoot();
        mkdirSync(join(cwd, 'app'));
        writeFileSync(join(cwd, 'app/page.tsx'), 'export default () => <div sz={{ p: 4 }} />;');

        const running = nextWatch({ cwd, parserMode: 'babel', debounceMs: 5 });
        // Give the watcher a moment to reach ready, then signal shutdown.
        await new Promise(resolve => setTimeout(resolve, 400));
        process.emit('SIGINT');
        const code = await running;
        expect(code).toBe(0);
        expect(logs.join('\n')).toContain('next watch ready');
    }, 20000);
});
