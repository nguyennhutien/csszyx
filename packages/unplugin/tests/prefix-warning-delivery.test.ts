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
import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * Build a project and collect what the plugin printed.
 *
 * @param css - The entry stylesheet's contents.
 * @param source - A module to transform, or none at all.
 * @returns Everything passed to `console.warn`, joined.
 */
async function warningsFrom(css: string, source?: string): Promise<string> {
    const root = tailwindProject('csszyx-prefix-warn-', { 'src/theme.css': css });
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
