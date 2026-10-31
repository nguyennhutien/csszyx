/**
 * The prescan asks the engine for module links a fixed number of times,
 * however many files it walks.
 *
 * Each call carries a fixed cost on top of the parse, and the walk used to make
 * two per file: one for szv factories, one for forwards. It now makes one per
 * question for the whole walk, so the count is the same for four files and for
 * sixteen.
 */
import { scanModuleLinks } from '@csszyx/compiler/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

// Wrapped, not replaced: the scans are real, and a test can count them.
vi.mock('@csszyx/compiler/engine', async importOriginal => {
    const engine = await importOriginal<typeof import('@csszyx/compiler/engine')>();
    return { ...engine, scanModuleLinks: vi.fn(engine.scanModuleLinks) };
});

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
    vi.mocked(scanModuleLinks).mockClear();
});

/**
 * How many module-link calls one prescan makes over a project of `count`
 * components. None imports another, so no provider is demanded and the
 * calls are the walk's alone; a demanded provider is read with one parse.
 *
 * @param count - Components in the project.
 * @returns The calls.
 */
async function callsFor(count: number): Promise<number> {
    const files: Record<string, string> = { 'src/index.css': '@import "tailwindcss";\n' };
    for (let index = 0; index < count; index++) {
        files[`src/C${index}.tsx`] =
            `export const C${index} = () => <div sz={{ p: ${index % 8} }} />;\n`;
    }
    const root = tailwindProject('csszyx-prescan-calls-', files);
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.mocked(scanModuleLinks).mockClear();
    const call = callHooks(
        vitePlugin({
            build: { cache: false },
            production: { mangle: false },
        }) as unknown as Record<string, unknown>[],
    );
    await call('configResolved', { root, command: 'build' });
    return vi.mocked(scanModuleLinks).mock.calls.length;
}

describe('the prescan walk', () => {
    it('asks for module links as often for sixteen files as for four', async () => {
        const few = await callsFor(4);
        const many = await callsFor(16);

        expect(few).toBeGreaterThan(0);
        expect(many).toBe(few);
    }, 60_000);
});
