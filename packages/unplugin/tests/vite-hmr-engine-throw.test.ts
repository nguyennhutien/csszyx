/**
 * A hot update must survive an engine that throws.
 *
 * `transformConfiguredSource` calls `ensureRustTransformAvailable()`, which
 * throws when the native addon cannot be loaded — a corrupt install, a
 * platform package removed while the dev server runs. Letting that escape
 * `handleHotUpdate` takes HMR down for the rest of the session, so the hook
 * catches it and records the file as producing no classes.
 *
 * Nothing else in the suite can reach that branch: the engine reports a parse
 * failure as an untransformed result rather than by throwing, so the only way
 * to exercise the guard is to make the availability probe fail on demand.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({ throws: false }));

vi.mock('@csszyx/compiler', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler')>();
    return {
        ...actual,
        ensureRustTransformAvailable: (): void => {
            if (engine.throws) {
                throw new Error('native addon vanished mid-session');
            }
        },
    };
});

const tempDirs: string[] = [];
afterEach(() => {
    engine.throws = false;
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('handleHotUpdate when the engine throws', () => {
    it('records the file and keeps the dev server alive', async () => {
        const { vitePlugin } = await import('../src/unplugin.js');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-hmr-throw-'));
        tempDirs.push(root);
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });

        const plugins = vitePlugin({});
        const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
        const call = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
            const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
            const hook = (plugin as Record<string, unknown> | undefined)?.[hookName];
            const fn = (
                typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
            ) as ((...a: unknown[]) => unknown) | undefined;
            return fn ? await fn.apply(ctx, args) : undefined;
        };
        await call('configResolved', { root, command: 'serve' });

        // The file has sz props, so the hook gets past its cheap guards and
        // reaches the transform — which is where the throw lands.
        const file = path.join(root, 'src/Card.tsx');
        fs.writeFileSync(file, 'export const Card = () => <div sz={{ p: 4 }} />;');
        engine.throws = true;

        const server = {
            config: { root },
            watcher: { emit() {} },
            moduleGraph: {
                getModuleById: () => null,
                invalidateModule() {},
                getModulesByFile: () => undefined,
            },
        };
        await expect(
            call('handleHotUpdate', { file, server, modules: [] }),
        ).resolves.toBeUndefined();
        // No classes were discovered, so nothing was safelisted — the failure
        // degrades to "this file contributed nothing", not to a crash.
        expect(fs.existsSync(path.join(root, '.csszyx/csszyx-classes.txt'))).toBe(false);
    });
});
