/**
 * The scan redirects `console.warn` for the whole process, not just for itself.
 *
 * It has to: the compiler reports unknown and aliased `sz` keys by warning, and
 * there is no other channel to read them from. But anything else running while
 * that redirect is in place warns into the same function — a dependency, a
 * framework, Node itself — and a captured line is reported to the user as a
 * diagnostic in whichever file happened to be under the cursor at the time.
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

vi.mock('@csszyx/compiler', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler')>();
    return {
        ...actual,
        transformSourceCode: (...args: Parameters<typeof actual.transformSourceCode>) => {
            console.warn(FOREIGN);
            return actual.transformSourceCode(...args);
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
    });
});
