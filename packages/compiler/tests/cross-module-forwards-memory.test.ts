/**
 * The forward extractor runs on every prescan, on every edit of a barrel in a
 * dev server, and on every Next loader call that resolves a provider. A parse
 * that keeps its memory after it returns grows the build process for as long
 * as it lives, so this pins that repeated extraction stays bounded.
 *
 * The ceiling is deliberately two orders of magnitude above the cost of the
 * work: it catches memory that is never returned, not a slower allocator.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const TSX = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));
const EXTRACTOR = fileURLToPath(new URL('../src/cross-module-extract.ts', import.meta.url));
const BARREL = fileURLToPath(new URL('../../runtime/src/index.ts', import.meta.url));

const PROBE = `
const { readFileSync } = await import('node:fs');
const { extractCrossModuleForwards } = await import(${JSON.stringify(EXTRACTOR)});
const source = readFileSync(${JSON.stringify(BARREL)}, 'utf8');
for (let i = 0; i < 50; i++) extractCrossModuleForwards(source, 'barrel.ts');
globalThis.gc();
const before = process.memoryUsage().rss;
let forwards = 0;
for (let i = 0; i < 1500; i++) forwards = extractCrossModuleForwards(source, 'barrel.ts').length;
globalThis.gc();
process.stdout.write(JSON.stringify({ forwards, grownMb: (process.memoryUsage().rss - before) / 1048576 }));
`;

describe('repeated forward extraction', () => {
    it.skipIf(!existsSync(TSX))('returns the memory of every parse', () => {
        // A file, not --eval: the probe needs top-level await, which the eval
        // form compiles as CommonJS and refuses.
        const dir = mkdtempSync(path.join(tmpdir(), 'csszyx-forwards-memory-'));
        const probe = path.join(dir, 'probe.mts');
        writeFileSync(probe, PROBE);
        const run = spawnSync(TSX, [probe], {
            encoding: 'utf8',
            env: { ...process.env, NODE_OPTIONS: '--expose-gc' },
            timeout: 120_000,
        });
        rmSync(dir, { recursive: true, force: true });
        expect(run.status, run.stderr).toBe(0);
        const { forwards, grownMb } = JSON.parse(run.stdout) as {
            forwards: number;
            grownMb: number;
        };

        expect(forwards).toBeGreaterThan(0);
        expect(grownMb).toBeLessThan(64);
    });
});
