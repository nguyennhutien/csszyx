/**
 * The bundler plugin reading `csszyx.config` when its build starts.
 *
 * The file is where diagnostic levels live, so a mistake in it has to surface
 * where the author is looking: an id the policy does not know would otherwise
 * set nothing, and the finding it was meant to silence or raise would keep its
 * default without a word.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { findUnknownConfigKeys, unknownConfigKeysMessage } from '../src/config-keys.js';
import { unplugin as rawInstance, vitePlugin } from '../src/unplugin.js';

const roots: string[] = [];
const hookContext = { warn() {}, error() {} };

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/**
 * Lay down a project with one config file.
 *
 * @param config - The `csszyx.config.mjs` text.
 * @returns The project root.
 */
function projectWithConfig(config: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-policy-plugin-')));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'csszyx.config.mjs'), config);
    return root;
}

/**
 * Call one hook off the plugin array, whichever plugin object carries it.
 *
 * @param plugins - The plugin array under test.
 * @param hookName - Hook to invoke.
 * @param args - Arguments to pass it.
 * @returns Whatever the hook returned.
 */
async function invokeHook(
    plugins: ReturnType<typeof vitePlugin>,
    hookName: string,
    ...args: unknown[]
): Promise<unknown> {
    const plugin = (plugins as unknown[]).find(candidate =>
        Boolean(candidate && hookName in (candidate as Record<string, unknown>)),
    );
    const hook = (plugin as Record<string, unknown>)[hookName];
    const handler = (
        typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
    ) as (...hookArgs: unknown[]) => unknown;
    return await handler.apply(hookContext, args);
}

const MISSPELT = 'export default { diagnostics: { rules: { "dead-clas": "off" } } };\n';

describe('the plugin reading csszyx.config', () => {
    it('warns about an id it does not know, naming the one it most likely means', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const root = projectWithConfig(MISSPELT);

        await invokeHook(vitePlugin(), 'configResolved', { root, command: 'build' });

        const said = warn.mock.calls.map(call => call.join(' ')).join('\n');
        expect(said).toContain('csszyx.config.mjs has 1 problem(s)');
        expect(said).toContain('did you mean `dead-class`?');
    });

    it('says it once per build, however many hooks read the config', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const root = projectWithConfig(MISSPELT);
        const plugins = vitePlugin();

        await invokeHook(plugins, 'configResolved', { root, command: 'build' });
        await invokeHook(plugins, 'configResolved', { root, command: 'build' });

        const said = warn.mock.calls.filter(call => call.join(' ').includes('dead-clas'));
        expect(said).toHaveLength(1);
    });

    it('stays quiet about it under quiet: true, like every config warning', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const root = projectWithConfig(MISSPELT);

        await invokeHook(vitePlugin({ quiet: true }), 'configResolved', {
            root,
            command: 'build',
        });

        expect(warn.mock.calls.flat().join('\n')).not.toContain('dead-clas');
    });

    it('reads the config on the webpack lane before the first compile', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const root = projectWithConfig(MISSPELT);
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const plugin = rawInstance.raw(
            { build: { cache: false } },
            { framework: 'webpack' },
        ) as unknown as { webpack: (compiler: unknown) => void };
        const compiles: Promise<void>[] = [];
        plugin.webpack({
            context: root,
            options: { mode: 'production' },
            hooks: {
                beforeCompile: {
                    tap: (_name: string, run: () => void) => run(),
                    tapPromise: (_name: string, run: () => Promise<void>) => {
                        compiles.push(run());
                    },
                },
                thisCompilation: { tap: () => undefined },
            },
        });
        await Promise.all(compiles);

        expect(warn.mock.calls.flat().join('\n')).toContain('did you mean `dead-class`?');
    });
});

describe('an inline diagnostics option', () => {
    it('is not read, and the warning says where it belongs', () => {
        const unknown = findUnknownConfigKeys({ diagnostics: { preset: 'atomic' } });
        expect(unknown).toEqual([{ key: 'diagnostics', movedTo: 'csszyx.config' }]);
        expect(unknownConfigKeysMessage(unknown)).toContain(
            '`diagnostics` is read from `csszyx.config`, not from the plugin options',
        );
    });
});
