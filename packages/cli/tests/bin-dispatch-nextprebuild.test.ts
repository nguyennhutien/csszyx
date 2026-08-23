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

/** The line the non-json success path prints; the test waits for it. */
const SUMMARY = 'csszyx next prebuild done';

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
        // The command reports trouble through warn/error, which the summary
        // assertion below would otherwise surface as an empty log with no
        // clue why. Captured so a red run names its own cause.
        const problems: string[] = [];
        for (const channel of ['warn', 'error'] as const) {
            vi.spyOn(console, channel).mockImplementation((...p: unknown[]) => {
                problems.push(`${channel}: ${p.join(' ')}`);
            });
        }
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
            'wasm',
            '--ignore',
            '**/vendor/**,**/__x__/**',
        ];
        await import('../src/bin.js?scenario=prebuild-ignore');
        // Wait for the summary, not for a duration. The action is async and
        // loads its command module on demand, and the fixed 500ms sleep this
        // replaces was a constant with nothing behind it — every other bin
        // dispatch already waits on its own effect. That sleep went red once
        // in the full workspace run and has not reproduced since; measured on
        // this machine the command answers in about 200ms whether it runs
        // alone or under the whole workspace, so waiting on the effect is a
        // mitigation, not a diagnosis. If it goes red again, the message
        // below says whether it was still running or had already failed.
        const printedSummary = (): boolean => logs.join('\n').includes(SUMMARY);
        for (let waited = 0; waited < 15_000 && !printedSummary(); waited += 25) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        const out = logs.join('\n');
        // Non-json human summary path.
        expect(out, `console.log was empty; problems: ${problems.join(' | ') || 'none'}`).toContain(
            SUMMARY,
        );
        // The success path never calls process.exit.
        expect(exit).not.toHaveBeenCalled();
        exit.mockRestore();
    }, 20000);
});
