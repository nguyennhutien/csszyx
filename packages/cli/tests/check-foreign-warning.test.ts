/**
 * A warning something else prints while the scan runs is not a finding.
 *
 * The scan reads findings from the engine's result, not from `console.warn`.
 * It once redirected `console.warn` for the whole process to collect them, and
 * then reported a dependency's or Node's own warning as a diagnostic in
 * whichever file was being scanned. This pins that it does not again.
 *
 * Lives in its own file because the case is built by mocking the compiler, and
 * `vi.mock` applies to a whole module graph.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/** A warning with no `[csszyx]` prefix, emitted from inside the scan. */
const FOREIGN = 'DeprecationWarning: something else entirely is unhappy';

vi.mock('@csszyx/compiler/engine', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler/engine')>();
    return {
        ...actual,
        transformSource: (...args: Parameters<typeof actual.transformSource>) => {
            console.warn(FOREIGN);
            return actual.transformSource(...args);
        },
    };
});

const { check } = await import('../src/commands/check.js');

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('csszyx check — warnings that are not ours', () => {
    it('reports the compiler diagnostic and drops the unrelated warning', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-cli-foreign-'));
        dirs.push(dir);
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(
            join(dir, 'src/Bad.tsx'),
            'export const Bad = () => <div sz={{ pading: 4 }} />;',
        );

        await check({ cwd: dir });

        const printed = log.mock.calls.map(call => call.join(' ')).join('\n');
        expect(printed).toContain('pading');
        expect(printed).not.toContain('something else entirely');
        // The mocked compiler ran: the foreign line was printed, just not as a finding.
        expect(warn.mock.calls.flat()).toContain(FOREIGN);
    });
});
