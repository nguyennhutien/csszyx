/**
 * bin.ts check action end-to-end: dispatching `check` with a single --ignore and a
 * --pattern through cac exercises the ignore-normalization branch (a lone
 * --ignore string is wrapped into an array) and the pattern passthrough.
 * One bin dispatch per file (see bin-dispatch-migrate.test.ts for why).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

describe('bin check dispatch (real command)', () => {
    it('wraps a single --ignore into an array and honours --pattern', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...p: unknown[]) => {
            logs.push(p.join(' '));
        });
        cwd = mkdtempSync(join(tmpdir(), 'csszyx-bin-check-'));
        mkdirSync(join(cwd, 'src'));
        mkdirSync(join(cwd, 'skipme'));
        // A bad sz key that check must flag under the pattern.
        writeFileSync(
            join(cwd, 'src/Bad.tsx'),
            'export const B = () => <div sz={{ pading: 4 }} />;',
        );
        // A file that would flag too, but is excluded by --ignore.
        writeFileSync(
            join(cwd, 'skipme/Also.tsx'),
            'export const A = () => <div sz={{ pading: 4 }} />;',
        );

        process.argv = [
            'node',
            'csszyx',
            'check',
            '--cwd',
            cwd,
            '--pattern',
            '**/*.tsx',
            '--ignore',
            '**/skipme/**',
        ];
        await import('../src/bin.js?scenario=check-single-ignore');
        // Poll rather than sleep a fixed span: the action is async and now
        // loads its command module on demand, so any constant is a race that
        // passes alone and fails under a loaded suite.
        for (let waited = 0; waited < 10_000 && logs.length === 0; waited += 25) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        await new Promise(resolve => setTimeout(resolve, 100));

        const out = logs.join('\n');
        expect(out).toContain('Bad.tsx');
        expect(out).toContain('pading');
        // The ignored file is not scanned.
        expect(out).not.toContain('Also.tsx');
        expect(process.exitCode).toBe(1);
    }, 15000);
});
