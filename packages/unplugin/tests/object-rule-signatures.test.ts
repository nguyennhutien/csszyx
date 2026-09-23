/**
 * The two merge rules that are not about coverage, through a real stylesheet.
 *
 * Two classes of one signature — same properties, different values — replace
 * each other, so the later key wins. A class with `!important` has its own
 * signature: it and a plain class never replace each other whatever their
 * order, since only one of them wins the cascade. Both rules are checked at
 * the engine's unit level; this drives them from an authored `sz` object
 * through the project's compiled Tailwind to the emitted `className`.
 */
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * The className a Vite build emits for one `sz` object over a stock Tailwind.
 *
 * @param sz - The object as written.
 * @returns The emitted class list.
 */
async function classNameOf(sz: string): Promise<string> {
    const app = `export const A = () => <div sz={${sz}} />;\n`;
    const root = tailwindProject('csszyx-object-rule-signatures-', {
        'src/theme.css': '@import "tailwindcss";\n',
        'src/App.tsx': app,
        'src/index.js': 'export const ready = true;\n',
    });
    const call = callHooks(
        vitePlugin({ build: { cache: false }, production: { mangle: false } }) as unknown as Record<
            string,
            unknown
        >[],
    );
    await call('configResolved', { root, command: 'build' });
    const result = (await call('transform', app, join(root, 'src/App.tsx'))) as { code: string };
    return /className="([^"]*)"/.exec(result.code)?.[1] ?? '';
}

describe('the object rule on a real stylesheet', () => {
    // Two keys, one key path each, so the pair meets the merge rather than
    // the array fold, which settles a repeated key path before lowering.
    it('keeps the later of two keys that set the same properties', async () => {
        expect(await classNameOf("{ css: { padding: '1rem' }, p: 4 }")).toBe('p-4');
        expect(await classNameOf("{ p: 4, css: { padding: '1rem' } }")).toBe('[padding:1rem]');
    }, 60_000);

    it('never merges an important class with a plain one it would cover', async () => {
        expect(await classNameOf('{ px: 8, p: 4 }')).toBe('p-4');
        expect(await classNameOf("{ px: 8, p: '4!' }")).toBe('px-8 p-4!');
        expect(await classNameOf("{ p: '4!', px: 8 }")).toBe('p-4! px-8');
    }, 60_000);
});
