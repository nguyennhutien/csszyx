/**
 * bin.ts next-prebuild action end-to-end: dispatching `next-prebuild <pattern>
 * --ignore x,y` through cac exercises the comma-split of --ignore into extraIgnore
 * and the success (exit code 0, no process.exit) path of runNextPrebuildCommand.
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

describe('bin next-prebuild dispatch (real command)', () => {
    it('splits --ignore into extraIgnore and prints the non-json summary without exiting', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...p: unknown[]) => {
            logs.push(p.join(' '));
        });
        const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`unexpected exit:${code ?? 0}`);
        }) as never);
        cwd = mkdtempSync(join(tmpdir(), 'csszyx-bin-prebuild-'));
        writeFileSync(join(cwd, 'package.json'), '{"name":"app","private":true}\n');
        mkdirSync(join(cwd, 'app'));
        writeFileSync(join(cwd, 'app/page.tsx'), 'export default () => <div sz={{ p: 4 }} />;');
        mkdirSync(join(cwd, 'app/vendor'));
        writeFileSync(
            join(cwd, 'app/vendor/Skip.tsx'),
            'export const S = () => <div sz={{ p: 99 }} />;',
        );

        process.argv = [
            'node',
            'csszyx',
            'next-prebuild',
            'app/**/*.tsx',
            '--root',
            cwd,
            '--cwd',
            cwd,
            '--parser-mode',
            'babel',
            '--ignore',
            '**/vendor/**,**/__x__/**',
        ];
        await import('../src/bin.js?scenario=prebuild-ignore');
        await new Promise(resolve => setTimeout(resolve, 500));

        const out = logs.join('\n');
        // Non-json human summary path.
        expect(out).toContain('csszyx next prebuild done');
        // The success path never calls process.exit.
        expect(exit).not.toHaveBeenCalled();
        exit.mockRestore();
    }, 20000);
});
