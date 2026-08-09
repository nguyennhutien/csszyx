/**
 * The recovery branches that only a failing filesystem call reaches.
 *
 * Each one is a race the plugin cannot prevent and must not fail on: a file
 * that passed its existence check and was deleted before the read, a provider
 * removed while the prescan was walking. They cannot be arranged with real
 * files — the whole point is that the check succeeds and the read does not —
 * so `node:fs` is wrapped and made to fail for marked paths only. Everything
 * else keeps its real behaviour, including the fixture writes below.
 *
 * Worth pinning precisely because they are unreachable in a healthy project: a
 * change from "skip it" to "throw" would surface as a failed build in someone
 * else's repo, on a file they never edited.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/** A path holding this reads fine but cannot be `stat`ed. */
const UNSTATABLE = 'UNSTATABLE';
/** A path holding this exists and is a file, but cannot be read. */
const UNREADABLE = 'UNREADABLE';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    const wrapped = {
        ...actual,
        statSync: (target: Parameters<typeof actual.statSync>[0], ...rest: unknown[]) => {
            if (String(target).includes(UNSTATABLE)) throw new Error('simulated stat failure');
            return (actual.statSync as (...args: unknown[]) => unknown)(target, ...rest);
        },
        readFileSync: (target: Parameters<typeof actual.readFileSync>[0], ...rest: unknown[]) => {
            if (String(target).includes(UNREADABLE)) throw new Error('simulated read failure');
            return (actual.readFileSync as (...args: unknown[]) => unknown)(target, ...rest);
        },
    };
    return { ...wrapped, default: wrapped };
});

const { resolveNextCrossModule } = await import('../src/next-cross-module.js');
const { isReadableProviderFile } = await import('../src/provider-file.js');
const { discoverProjectTheme } = await import('../src/theme-discovery.js');
const { vitePlugin } = await import('../src/unplugin.js');

/**
 * Call one plugin hook directly, with no bundler around it.
 *
 * The watch paths under test run before any module is re-transformed, so a
 * real rebuild would tell us nothing a direct call does not — and could not
 * arrange a read that fails only for the file in question.
 *
 * @param root - Project root.
 * @param hookName - Hook to invoke.
 * @param args - Arguments to pass.
 * @returns Whatever the hook returns.
 */
async function invokeHook(root: string, hookName: string, ...args: unknown[]): Promise<unknown> {
    const plugins = vitePlugin({});
    const context = { warn() {}, error() {} };
    const call = async (name: string, ...rest: unknown[]): Promise<unknown> => {
        const plugin = plugins.find(p => p && name in (p as Record<string, unknown>));
        if (!plugin) return undefined;
        const hook = (plugin as Record<string, unknown>)[name];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(context, rest) : undefined;
    };
    await call('configResolved', { root, command: 'serve' });
    return call(hookName, ...args);
}

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A throwaway project root.
 *
 * @returns Absolute path, realpath-resolved the way the plugin resolves it.
 */
function tempRoot(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-fsfail-')));
    roots.push(root);
    return root;
}

describe('a path that exists but cannot be inspected', () => {
    it('is not treated as a readable provider', () => {
        const root = tempRoot();
        const target = join(root, `${UNSTATABLE}.ts`);
        writeFileSync(target, 'export const cardSz = { p: 7 };\n');

        // Answering "yes" here would hand the caller a path whose read is about
        // to fail, moving the failure to a place with less context.
        expect(isReadableProviderFile(target)).toBe(false);
    });
});

describe('a provider that disappears between the probe and the read', () => {
    it('costs its importer the optimization and nothing else', () => {
        const root = tempRoot();
        mkdirSync(join(root, 'app'), { recursive: true });
        writeFileSync(join(root, `app/${UNREADABLE}.ts`), 'export const cardSz = { p: 7 };\n');

        const resolved = resolveNextCrossModule({
            filename: join(root, 'app/page.tsx'),
            source: `import { cardSz } from './${UNREADABLE}';\n`,
            root,
            importedStaticSz: true,
        });

        expect(resolved.statics).toEqual({});
        // Still declared: an edit that makes it readable has to reach this
        // importer, and by then the loader is not running to notice.
        expect(resolved.providers).toEqual([join(root, `app/${UNREADABLE}.ts`)]);
    });
});

describe('a stylesheet that disappears between the glob and the read', () => {
    it('is skipped, and the stylesheets around it are still scanned', () => {
        const root = tempRoot();
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(
            join(root, `src/${UNREADABLE}.css`),
            '@theme { --color-vanished: #000000; }\n',
        );
        writeFileSync(join(root, 'src/real.css'), '@theme { --color-brand: #123456; }\n');

        const discovered = discoverProjectTheme(root);

        expect(discovered.theme?.colors).toContain('brand');
        expect(discovered.theme?.colors ?? []).not.toContain('vanished');
    });
});

describe('a watched file that cannot be re-read', () => {
    it('drops its registry entry rather than keeping one nothing can refresh', async () => {
        // The delete race: the watcher reports a change, the file is gone by
        // the time the refresh reads it. Keeping the old entry would serve
        // importers a table for a module that no longer says what it said.
        const root = tempRoot();
        mkdirSync(join(root, 'src'), { recursive: true });
        const changed = join(root, `src/${UNREADABLE}.tsx`);
        writeFileSync(changed, 'export const A = () => <div sz={{ p: 4 }} />;\n');

        await expect(
            invokeHook(root, 'watchChange', changed, { event: 'update' }),
        ).resolves.toBeUndefined();
    });

    it('leaves an importer alone when the provider it names cannot be read', async () => {
        // The provider passes its existence check and fails its read, so the
        // demand pass has nothing to record. The importer keeps the runtime
        // path it would have had, and the edit does not fail.
        const root = tempRoot();
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, `src/${UNREADABLE}.ts`), 'export const cardSz = { p: 7 };\n');
        const importer = join(root, 'src/Card.tsx');
        writeFileSync(
            importer,
            `import { cardSz } from './${UNREADABLE}';\n` +
                'export const Card = () => <div sz={cardSz} />;\n',
        );

        await expect(
            invokeHook(root, 'watchChange', importer, { event: 'update' }),
        ).resolves.toBeUndefined();
    });
});
