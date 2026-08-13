/**
 * Engine-boundary edges of `csszyx check`.
 *
 * The scan runs the real engine over every file, so two things must hold that
 * the happy-path suite never exercises: a diagnostic that is not a `[csszyx]`
 * key issue (the runtime-fallback notes) must not be reported as a check
 * failure, and a file the engine cannot process at all must be skipped rather
 * than abort the whole project scan.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '../src/commands/check.js';

vi.mock('@csszyx/compiler', async importActual => {
    const actual = await importActual<typeof import('@csszyx/compiler')>();
    return {
        ...actual,
        transformSource: (source: string, file?: string, options?: unknown) => {
            if (file?.includes('Explodes')) {
                throw new Error('engine rejected this module');
            }
            return actual.transformSource(
                source,
                file,
                options as Parameters<typeof actual.transformSource>[2],
            );
        },
    };
});

const dirs: string[] = [];

function projectWith(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-cli-check-edge-'));
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

describe('csszyx check engine edges', () => {
    it('does not fail the run on a runtime-fallback diagnostic', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        // An imported binding produces a fallback note ("sz fallback at ..."),
        // which is advice about the runtime path, not a broken key — check
        // only gates on `[csszyx]` key issues.
        const cwd = projectWith({
            'src/Fallback.tsx':
                "import { cardSz } from './styles'; export const C = () => <div sz={cardSz} />;",
        });

        await check({ cwd });

        expect(process.exitCode).not.toBe(1);
    });

    it('skips a file the engine throws on and still checks the rest', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = projectWith({
            'src/Explodes.tsx': 'export const E = () => <div sz={{ p: 4 }} />;',
            'src/Bad.tsx': 'export const Bad = () => <div sz={{ pading: 4 }} />;',
        });

        await check({ cwd });

        const reported = log.mock.calls.map(call => call.join(' ')).join('\n');
        expect(reported).toContain('pading');
        expect(reported).not.toContain('Explodes');
        expect(process.exitCode).toBe(1);
    });
});
