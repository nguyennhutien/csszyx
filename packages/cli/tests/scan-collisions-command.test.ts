import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { scanCollisions } from '../src/commands/scan-collisions.js';

const dirs: string[] = [];

function projectWith(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-scan-coll-'));
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

describe('csszyx scan-collisions', () => {
    it('flags only short token-shaped class names and prints a paste-ready exclude', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = projectWith({
            'src/resizable.scss':
                '.resizable-v2-container { .draggable.y { top: 0 } .draggable.x { left: 0 } }\n.main-body { display: flex }\n.b7 { color: red }\n.icon { width: 1rem }',
        });

        await scanCollisions({ cwd });

        const out = log.mock.calls.map(c => c.join(' ')).join('\n');
        // Token-shaped (short, alphanumeric) → flagged.
        expect(out).toContain('.x');
        expect(out).toContain('.y');
        expect(out).toContain('.b7');
        // Has a hyphen / too long → can never collide with a token → ignored.
        expect(out).not.toContain('main-body');
        expect(out).not.toContain('.icon');
        // Paste-ready, sorted.
        expect(out).toContain('mangleExclude: ["b7","x","y"]');
        expect(process.exitCode).toBe(1);
    });

    it('passes cleanly when no class name can collide with a token', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = projectWith({
            'src/app.css': '.main-body { display: flex }\n.nav-item { color: blue }',
        });

        await scanCollisions({ cwd });

        expect(process.exitCode).not.toBe(1);
    });
});
