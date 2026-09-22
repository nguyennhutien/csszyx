/**
 * Which files pay for the object rule's second engine pass.
 *
 * The second pass is only worth its cost when a merge inside one static object
 * would remove a class. Two classes of one file cover each other far more often
 * than two of one object do: on the docs app, 25 of 26 files held such a pair
 * and not one held it inside an object. The first pass reports each object's
 * class list, so a file whose covering pair spans two elements lowers once.
 */
import { join } from 'node:path';

import * as compiler from '@csszyx/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

vi.mock('@csszyx/compiler', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler')>();
    return {
        ...actual,
        transformRust: vi.fn(actual.transformRust),
        transformWasm: vi.fn(actual.transformWasm),
    };
});

afterEach(() => {
    removeTailwindProjects();
    vi.clearAllMocks();
});

/**
 * How many engine passes were handed a merge table.
 *
 * @returns The count across both artifacts.
 */
function tablePasses(): number {
    return [compiler.transformRust, compiler.transformWasm]
        .flatMap(engine => vi.mocked(engine).mock.calls)
        .filter(call => (call[2] as { mergeTable?: unknown } | undefined)?.mergeTable !== undefined)
        .length;
}

/**
 * Transform one module on a Vite build over a stock Tailwind project.
 *
 * @param app - The module's source.
 * @returns The emitted code.
 */
async function transform(app: string): Promise<string> {
    const root = tailwindProject('csszyx-object-rule-passes-', {
        'src/theme.css': '@import "tailwindcss";\n',
        'src/App.tsx': app,
        'src/index.js': 'export const ready = true;\n',
    });
    const call = callHooks(
        vitePlugin({
            build: { cache: false },
            production: { mangle: false },
        }) as unknown as Record<string, unknown>[],
    );
    await call('configResolved', { root, command: 'build' });
    const result = (await call('transform', app, join(root, 'src/App.tsx'))) as { code: string };
    return result.code;
}

describe("the object rule's second pass", () => {
    it('is skipped when the covering pair spans two elements', async () => {
        const code = await transform(
            'export const A = () => <><div sz={{ p: 4 }} /><b sz={{ pb: 2 }} /></>;\n',
        );

        expect(code).toContain('className="pb-2"');
        expect(tablePasses()).toBe(0);
    }, 60_000);

    it('runs when the pair is inside one object', async () => {
        const code = await transform('export const A = () => <div sz={{ pb: 2, p: 4 }} />;\n');

        expect(code).toContain('className="p-4"');
        // Once for the prescan and once for the transform hook, with no cache.
        expect(tablePasses()).toBeGreaterThan(0);
    }, 60_000);
});
