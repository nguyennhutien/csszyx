/**
 * A fresh plugin's transform hook, for the tests that decide which template
 * adapter a build loads. The plugin is imported per call, after the test's
 * own `vi.mock` of the adapters, so each call sees the mocks as they stand.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Temporary project roots made so far; the test removes them. */
export const adapterTestRoots: string[] = [];

/**
 * A fresh plugin, configured for a build of an empty project.
 *
 * @returns Its transform hook, taking a project-relative file.
 */
export async function adapterTransformer(): Promise<
    (code: string, file: string) => Promise<unknown>
> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-adapter-isolation-'));
    adapterTestRoots.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    const { vitePlugin } = await import('../src/unplugin.js');
    const plugins = vitePlugin({}) as unknown as Record<string, unknown>[];
    const ctx = { warn() {}, error() {} };
    const invoke = async (name: string, ...args: unknown[]): Promise<unknown> => {
        const plugin = plugins.find(p => p && name in p);
        const hook = plugin?.[name];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(ctx, args) : undefined;
    };
    await invoke('configResolved', { root, command: 'build' });
    return (code, file) => invoke('transform', code, path.join(root, file));
}

/**
 * Removes the roots {@link adapterTransformer} made.
 */
export function removeAdapterTestRoots(): void {
    for (const dir of adapterTestRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}
