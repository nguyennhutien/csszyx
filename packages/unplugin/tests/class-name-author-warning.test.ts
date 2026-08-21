/**
 * The plugin telling a project that one of its class names has two authors.
 *
 * `findClassNameAuthorConflicts` decides WHAT collides; this covers what the
 * plugin does with the answer. Two things matter to a person and neither is in
 * that function: the warning reaches them at all, and it arrives once. The
 * theme scan re-runs on every hot update of a watched stylesheet, so a warning
 * without a memory would repeat on each keystroke in an unrelated file and be
 * scrolled past — which is the same as not warning.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];
const hookContext = { warn() {}, error() {} };

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
    const plugin = plugins.find(candidate =>
        Boolean(candidate && hookName in (candidate as Record<string, unknown>)),
    );
    if (!plugin) return undefined;
    const hook = (plugin as Record<string, unknown>)[hookName];
    const handler = (
        typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
    ) as ((...hookArgs: unknown[]) => unknown) | undefined;
    return handler ? await handler.apply(hookContext, args) : undefined;
}

/**
 * Lay down a project whose stylesheet claims one name twice.
 *
 * @param css - Stylesheet contents.
 * @returns The project root and the stylesheet path.
 */
function projectWith(css: string): { root: string; themeCss: string } {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-authors-')));
    tempDirs.push(root);
    const themeCss = path.join(root, 'theme.css');
    fs.writeFileSync(themeCss, css, 'utf8');
    return { root, themeCss };
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const DECLARED_TWICE = [
    '@utility card {',
    '    padding: 1rem;',
    '}',
    '@utility card {',
    '    border-radius: 4px;',
    '}',
].join('\n');

describe('the @utility collision warning', () => {
    it('names the class and says what Tailwind does with it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { root } = projectWith(DECLARED_TWICE);

        await invokeHook(vitePlugin({ build: { scanCss: ['theme.css'] } }), 'configResolved', {
            root,
            command: 'serve',
        });

        const said = warn.mock.calls.map(call => call.join(' ')).join('\n');
        expect(said).toContain('@utility card');
        expect(said).toContain('declared twice');
    });

    it('says it once, however many times the stylesheet is rescanned', async () => {
        // Every hot update of a watched stylesheet re-runs the whole scan, so
        // the conflict is found again each time. Repeating the warning would
        // bury it under itself.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { root, themeCss } = projectWith(DECLARED_TWICE);
        const plugins = vitePlugin({ build: { scanCss: ['theme.css'] } });

        await invokeHook(plugins, 'configResolved', { root, command: 'serve' });
        await invokeHook(plugins, 'handleHotUpdate', {
            file: themeCss,
            server: {
                config: { root },
                watcher: { emit() {} },
                moduleGraph: { getModuleById: () => null, invalidateModule() {} },
            },
            modules: [],
        });

        const collisions = warn.mock.calls
            .map(call => call.join(' '))
            .filter(said => said.includes('@utility card'));
        expect(collisions).toHaveLength(1);
    });

    it('stays quiet for a stylesheet whose names each have one author', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { root } = projectWith('@utility card {\n    padding: 1rem;\n}\n');

        await invokeHook(vitePlugin({ build: { scanCss: ['theme.css'] } }), 'configResolved', {
            root,
            command: 'serve',
        });

        expect(warn.mock.calls.map(call => call.join(' ')).join('\n')).not.toContain('@utility');
    });
});
