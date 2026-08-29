/**
 * What `CSSZYX_BENCH_TRACE=1` says about the prescan.
 *
 * One `prescan` total was the only number the trace gave, and it hid where
 * the time went: 8.9 s of parser time inside a 12.8 s prescan went unnoticed
 * for a release because nothing named it. The stages now report themselves,
 * with the counts that explain them, so the next regression is visible from
 * the trace a user can already turn on.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PrePlugin = {
    configResolved?: (c: { root: string; command: string }) => void;
};

const tempDirs: string[] = [];
let logged: string[] = [];

beforeEach(() => {
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        logged.push(parts.join(' '));
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * @param lines - Everything printed.
 * @param label - Trace label, exactly as printed after `[csszyx:bench]`.
 * @returns The first line carrying that label.
 */
function traceLine(lines: string[], label: string): string | undefined {
    return lines.find(line => line.startsWith(`[csszyx:bench] ${label} `));
}

describe('prescan trace labels', () => {
    it('reports each stage with the counts that size it', async () => {
        vi.stubEnv('CSSZYX_BENCH_TRACE', '1');
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-trace-')));
        tempDirs.push(root);
        fs.mkdirSync(path.join(root, 'src'));
        fs.writeFileSync(
            path.join(root, 'src/Card.tsx'),
            'export const Card = () => <div sz={{ p: 4 }} />;\n',
        );
        fs.writeFileSync(path.join(root, 'src/Plain.tsx'), 'export const Plain = () => <div />;\n');
        fs.writeFileSync(path.join(root, 'src/tokens.ts'), 'export const tokens = { p: 2 };\n');
        // The module constant that enables the trace is read at import time.
        const { vitePlugin } = await import('../src/unplugin.js');
        const [pre] = vitePlugin({ build: { cache: false } }) as unknown as [PrePlugin];

        pre.configResolved?.({ root, command: 'build' });

        expect(traceLine(logged, 'prescan:walk')).toMatch(
            /^\[csszyx:bench\] prescan:walk files=3 sz=1 [\d.]+ms /,
        );
        expect(traceLine(logged, 'prescan:demand')).toMatch(
            /^\[csszyx:bench\] prescan:demand providers=\d+ [\d.]+ms /,
        );
        expect(traceLine(logged, 'prescan:batch')).toMatch(
            /^\[csszyx:bench\] prescan:batch files=1 misses=1 [\d.]+ms /,
        );
        expect(traceLine(logged, 'prescan:safelist')).toMatch(
            /^\[csszyx:bench\] prescan:safelist classes=1 [\d.]+ms /,
        );
        // The total keeps its old shape: other benchmarks parse it.
        expect(traceLine(logged, 'prescan')).toMatch(/^\[csszyx:bench\] prescan [\d.]+ms /);
    });
});
