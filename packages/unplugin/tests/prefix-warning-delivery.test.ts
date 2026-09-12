/**
 * The prefix warning reaches a project that authored nothing of its own.
 *
 * `@import "tailwindcss" prefix(tw)` makes `tw:p-4` the served class and leaves
 * `p-4` — what the lowering emits — with no CSS at all. A project in that state
 * builds green and renders unstyled, so the warning is the only thing standing
 * between the author and an afternoon of searching.
 *
 * It is computed beside the unserved-class list, and that step returns early
 * when the project authored no class names. Nothing about the prefix depends on
 * an authored class, so the warning is emitted BEFORE that return — an ordering
 * a later "consolidate the early returns" edit would undo without a failing
 * test. Hence this one: a fixture with a prefix and no authored class at all.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const REPO = resolve(import.meta.dirname, '../../..');

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/**
 * A project the plugin can resolve Tailwind and the runtime from.
 *
 * Real packages, reached the way an installed project reaches them: the oracle
 * compiles the project's own Tailwind, so a fixture without one proves nothing.
 *
 * @param css - The entry stylesheet's contents.
 * @returns Absolute project root.
 */
function project(css: string): string {
    // realpath: macOS `tmpdir()` is a symlink and the plugin resolves through it.
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-prefix-warn-')));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/theme.css'), css, 'utf8');

    const require_ = createRequire(join(REPO, 'package.json'));
    mkdirSync(join(root, 'node_modules/@csszyx'), { recursive: true });
    symlinkSync(
        resolve(dirname(require_.resolve('tailwindcss')), '..'),
        join(root, 'node_modules/tailwindcss'),
        'dir',
    );
    symlinkSync(join(REPO, 'packages/runtime'), join(root, 'node_modules/@csszyx/runtime'), 'dir');
    return root;
}

/**
 * Drive the plugin array through its hooks the way a bundler would.
 *
 * @param plugins - The plugin objects `vitePlugin` returned.
 * @returns Caller that invokes one hook by name and awaits its result.
 */
function callHooks(
    plugins: Record<string, unknown>[],
): (hookName: string, ...args: unknown[]) => Promise<unknown> {
    const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    return async (hookName, ...args) => {
        const plugin = plugins.find(p => p && hookName in p);
        const hook = plugin?.[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(ctx, args) : undefined;
    };
}

/**
 * Build a project and collect what the plugin printed.
 *
 * @param css - The entry stylesheet's contents.
 * @param source - A module to transform, or none at all.
 * @returns Everything passed to `console.warn`, joined.
 */
async function warningsFrom(css: string, source?: string): Promise<string> {
    const root = project(css);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugins = vitePlugin({ production: { mangle: false } }) as unknown as Record<
        string,
        unknown
    >[];
    const call = callHooks(plugins);

    await call('configResolved', { root, command: 'build' });
    if (source !== undefined) await call('transform', source, `${root}/src/A.tsx`);
    await call('renderStart');

    return warn.mock.calls.map(args => args.join(' ')).join('\n');
}

describe('the prefix warning', () => {
    it('is printed for a project that authored no class of its own', async () => {
        // No `className`, no `sz` — the case the authored-class early return
        // would swallow if the warning moved below it.
        const printed = await warningsFrom('@import "tailwindcss" prefix(tw);\n');

        expect(printed).toContain('prefix(tw)');
        expect(printed).toContain('no CSS');
    }, 60_000);

    it('is printed for a project that did author classes', async () => {
        const printed = await warningsFrom(
            '@import "tailwindcss" prefix(tw);\n',
            'export const A = () => <div className="card p-4" />;',
        );

        expect(printed).toContain('prefix(tw)');
    }, 60_000);

    it('says nothing for a stock Tailwind entry', async () => {
        const printed = await warningsFrom(
            '@import "tailwindcss";\n',
            'export const A = () => <div className="card p-4" />;',
        );

        expect(printed).not.toContain('does not emit for yet');
    }, 60_000);
});
