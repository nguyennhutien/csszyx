import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAFELIST_HEADER } from '../src/safelist-format.js';

const compilerMock = vi.hoisted(() => ({
    transformRustBatch: vi.fn(),
    transformRust: vi.fn(),
}));

vi.mock('@csszyx/compiler', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler')>();
    return {
        ...actual,
        ensureRustTransformAvailable: vi.fn(),
        transformRustBatch: compilerMock.transformRustBatch,
        // Delegates unless a case installs its own behaviour, so the files
        // that compile go through the real engine.
        transformRust: (source: string, filename: string, options: unknown) =>
            compilerMock.transformRust.getMockImplementation() === undefined
                ? (actual.transformRust as (s: string, f: string, o: unknown) => unknown)(
                      source,
                      filename,
                      options,
                  )
                : compilerMock.transformRust(source, filename, options),
    };
});

const { vitePlugin } = await import('../src/unplugin.js');

type ViteConfigHook = {
    configResolved?: (config: { root: string }) => Promise<void>;
};

const tempDirs: string[] = [];

afterEach(() => {
    compilerMock.transformRustBatch.mockReset();
    compilerMock.transformRust.mockReset();
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('rust prescan batching', () => {
    function tempRoot(): string {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-prescan-batch-'));
        tempDirs.push(dir);
        mkdirSync(join(dir, 'src'), { recursive: true });
        return dir;
    }

    it('batches rust prescan cache misses in one native call', async () => {
        const root = tempRoot();
        const appPath = join(root, 'src/App.tsx');
        const cardPath = join(root, 'src/Card.tsx');
        writeFileSync(appPath, 'export const App = () => <div sz={{ p: 4 }} />;', 'utf8');
        writeFileSync(cardPath, 'export const Card = () => <div sz={{ m: 2 }} />;', 'utf8');

        compilerMock.transformRustBatch.mockImplementation(
            (
                files: Array<{ filename: string; source: string }>,
            ): Array<{
                code: string;
                transformed: boolean;
                usesRuntime: boolean;
                usesMerge: boolean;
                usesColorVar: boolean;
                usesSpacingVar: boolean;
                usesUnitVar: boolean;
                classes: Set<string>;
                rawClassNames: Set<string>;
                diagnostics: string[];
                recoveryTokens: Map<string, never>;
                cssVariableMap: Map<string, never>;
            }> =>
                files.map(file => ({
                    code: file.source.includes('p: 4')
                        ? 'export const App = () => <div className="p-4" />;'
                        : 'export const Card = () => <div className="m-2" />;',
                    transformed: true,
                    usesRuntime: false,
                    usesMerge: false,
                    usesColorVar: false,
                    usesSpacingVar: false,
                    usesUnitVar: false,
                    classes: new Set([file.source.includes('p: 4') ? 'p-4' : 'm-2']),
                    rawClassNames: new Set(),
                    diagnostics: [],
                    recoveryTokens: new Map(),
                    cssVariableMap: new Map(),
                })),
        );

        const [prePlugin] = vitePlugin({
            build: { parser: 'rust', cache: false },
        }) as ViteConfigHook[];
        await prePlugin.configResolved?.({ root });

        expect(compilerMock.transformRustBatch).toHaveBeenCalledTimes(1);
        expect(compilerMock.transformRustBatch.mock.calls[0]?.[0]).toEqual([
            { filename: appPath, source: 'export const App = () => <div sz={{ p: 4 }} />;' },
            { filename: cardPath, source: 'export const Card = () => <div sz={{ m: 2 }} />;' },
        ]);
        expect(readFileSync(join(root, '.csszyx/csszyx-classes.txt'), 'utf8')).toBe(
            `${SAFELIST_HEADER}p-4\nm-2\n`,
        );
    });

    // The batch is one native call for every file, so one unreadable file
    // fails it for all of them; the per-file fallback then keeps what it can
    // and the safelist is built from those, without the file it skipped.
    it('keeps the files that compile when the batch falls back', async () => {
        const root = tempRoot();
        writeFileSync(
            join(root, 'src/App.tsx'),
            'export const App = () => <div sz={{ p: 4 }} />;',
            'utf8',
        );
        const brokenPath = join(root, 'src/Broken.tsx');
        writeFileSync(brokenPath, 'export const Broken = () => <div sz={{ m: 2 }} />;', 'utf8');
        compilerMock.transformRustBatch.mockImplementation(() => {
            throw new Error('batch unavailable');
        });
        const real = await vi.importActual<typeof import('@csszyx/compiler')>('@csszyx/compiler');
        compilerMock.transformRust.mockImplementation(
            (source: string, filename: string, options: never) => {
                if (filename === brokenPath) throw new Error('cannot read this file');
                return real.transformRust(source, filename, options);
            },
        );

        const [prePlugin] = vitePlugin({
            build: { parser: 'rust', cache: false },
        }) as ViteConfigHook[];
        await prePlugin.configResolved?.({ root });

        expect(readFileSync(join(root, '.csszyx/csszyx-classes.txt'), 'utf8')).toBe(
            `${SAFELIST_HEADER}p-4\n`,
        );
    });
});
