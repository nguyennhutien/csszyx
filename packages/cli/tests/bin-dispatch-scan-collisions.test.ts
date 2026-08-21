/**
 * bin.ts scan-collisions action end-to-end: dispatching `scan-collisions` with
 * a single --ignore through cac exercises the ignore-normalization branch (a
 * lone --ignore string is wrapped into an array) against a real project.
 *
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

describe('bin scan-collisions dispatch (real command)', () => {
    it('wraps a single --ignore into an array and reports the rest', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
            logs.push(parts.join(' '));
        });
        cwd = mkdtempSync(join(tmpdir(), 'csszyx-bin-coll-'));
        mkdirSync(join(cwd, 'src'));
        mkdirSync(join(cwd, 'skipme'));
        // Token-shaped class names, which is what a mangled token can collide
        // with. One is scanned, the other excluded by --ignore.
        writeFileSync(join(cwd, 'src/app.css'), '.x { top: 0 }\n');
        writeFileSync(join(cwd, 'skipme/vendor.css'), '.q { top: 0 }\n');

        process.argv = [
            'node',
            'csszyx',
            'scan-collisions',
            '--cwd',
            cwd,
            '--ignore',
            '**/skipme/**',
        ];
        await import('../src/bin.js?scenario=scan-collisions-single-ignore');
        for (let waited = 0; waited < 10_000 && logs.length === 0; waited += 25) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        await new Promise(resolve => setTimeout(resolve, 100));

        const out = logs.join('\n');
        expect(out).toContain('mangleExclude: ["x"]');
        expect(out).not.toContain('vendor.css');
        expect(process.exitCode).toBe(1);
    }, 15000);
});
