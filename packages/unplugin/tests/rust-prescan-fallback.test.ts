/**
 * What the prescan does when the batched native call fails outright.
 *
 * Batching is an optimization: one native call carries a whole set of files
 * instead of one call each. If that call throws — a native binding mismatch, a
 * payload the encoder cannot take — the files themselves are usually fine, and
 * running them one at a time still produces the right classes. Letting the
 * throw escape instead would fail a build over a batching detail, and the
 * failure would name none of the files responsible.
 *
 * The batch path only runs with more than one sz-authoring file, which is why
 * the fixture has two.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@csszyx/compiler', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler')>();
    return {
        ...actual,
        transformRustBatch: () => {
            throw new Error('simulated batch failure');
        },
    };
});

const { vitePlugin } = await import('../src/unplugin.js');

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('a native prescan batch that throws', () => {
    it('falls back to per-file transforms and still collects the classes', async () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-batchfail-')));
        roots.push(root);
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(
            join(root, 'src/A.tsx'),
            'export const A = () => <div sz={{ p: 7 }} />;\n',
            'utf8',
        );
        writeFileSync(
            join(root, 'src/B.tsx'),
            'export const B = () => <div sz={{ m: 9 }} />;\n',
            'utf8',
        );

        const plugins = vitePlugin({ build: { cache: false, parser: 'rust' } });
        const context = { warn() {}, error() {} };
        const call = async (name: string, ...args: unknown[]): Promise<unknown> => {
            const plugin = plugins.find(p => p && name in (p as Record<string, unknown>));
            if (!plugin) return undefined;
            const hook = (plugin as Record<string, unknown>)[name];
            const fn = (
                typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
            ) as ((...a: unknown[]) => unknown) | undefined;
            return fn ? await fn.apply(context, args) : undefined;
        };

        await call('configResolved', { root, command: 'build' });
        await expect(call('buildStart')).resolves.not.toThrow();

        // The classes are the point: a fallback that ran but collected nothing
        // would leave the safelist empty and the CSS missing, which is the
        // failure the batch path exists to avoid making worse.
        const safelist = join(root, 'csszyx-classes.html');
        const { readFileSync, existsSync } = await import('node:fs');
        expect(existsSync(safelist)).toBe(true);
        const written = readFileSync(safelist, 'utf8');
        expect(written).toContain('p-7');
        expect(written).toContain('m-9');
    }, 60_000);
});
