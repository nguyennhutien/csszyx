/**
 * The safelist write must replace the file at its path, not write through it.
 *
 * `writeFileSync` opens a path and overwrites what it finds there. When the
 * path is a symlink it follows the link and overwrites the file at the far end,
 * so anything that can place a link at `.csszyx/csszyx-classes.txt` — an
 * install script, an extracted archive, a shared workspace — redirects the next
 * dev run into a file the developer never offered. Renaming a temporary file
 * over the path replaces the link itself and leaves its target alone.
 *
 * The same change is what makes the write atomic, which is the failure most
 * likely to be met: a dev server killed mid-write leaves a truncated class list
 * that Tailwind reads as the whole set, so styles go missing with no error at
 * all. A rename is one step — the file is the old one or the new one, never
 * half of either.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Boot the Vite plugins over a throwaway project and hot-update one source file.
 *
 * @param prepare - Runs before the edit, with the project root.
 * @returns The project root and the safelist path.
 */
async function runHotUpdate(
    prepare: (root: string) => void,
): Promise<{ root: string; safelistPath: string }> {
    const { vitePlugin } = await import('../src/unplugin.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-write-safety-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });

    const plugins = vitePlugin({});
    const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    const call = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
        const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
        const hook = (plugin as Record<string, unknown> | undefined)?.[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(ctx, args) : undefined;
    };
    await call('configResolved', { root, command: 'serve' });

    prepare(root);

    const file = path.join(root, 'src/Card.tsx');
    fs.writeFileSync(file, 'export const Card = () => <div sz={{ p: 4 }} />;');
    const moduleGraph = {
        getModuleById: () => null,
        invalidateModule() {},
        getModulesByFile: () => undefined,
    };
    await call('hotUpdate', {
        type: 'update',
        file,
        modules: [],
        server: {
            config: { root },
            watcher: { emit() {} },
            ws: { send() {} },
            moduleGraph,
            environments: { client: { moduleGraph } },
        },
    });

    return { root, safelistPath: path.join(root, '.csszyx/csszyx-classes.txt') };
}

describe('writing the generated safelist', () => {
    it('replaces a symlink instead of writing through it', async () => {
        let decoy = '';
        const { safelistPath, root } = await runHotUpdate(projectRoot => {
            decoy = path.join(projectRoot, 'src/keep-me.ts');
            fs.writeFileSync(decoy, 'export const KEEP = 1;\n');
            fs.mkdirSync(path.join(projectRoot, '.csszyx'), { recursive: true });
            fs.symlinkSync(decoy, path.join(projectRoot, '.csszyx/csszyx-classes.txt'));
        });

        expect(
            fs.readFileSync(path.join(root, 'src/keep-me.ts'), 'utf8'),
            'the file the link pointed at must be untouched',
        ).toBe('export const KEEP = 1;\n');
        expect(
            fs.lstatSync(safelistPath).isSymbolicLink(),
            'the link itself must have been replaced by a real file',
        ).toBe(false);
        expect(fs.readFileSync(safelistPath, 'utf8')).toContain('p-4');
        expect(decoy.endsWith('keep-me.ts')).toBe(true);
    });

    it('still writes the safelist when the path is an ordinary file', async () => {
        const { safelistPath } = await runHotUpdate(() => {});

        expect(fs.readFileSync(safelistPath, 'utf8')).toContain('p-4');
    });

    it('leaves no temporary file behind', async () => {
        const { root } = await runHotUpdate(() => {});

        const leftovers = fs
            .readdirSync(path.join(root, '.csszyx'))
            .filter(name => name.startsWith('.tmp-'));
        expect(leftovers).toEqual([]);
    });
});
