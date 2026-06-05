import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const compilerMock = vi.hoisted(() => ({
    transformRustBatch: vi.fn(),
}));

vi.mock('@csszyx/compiler', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler')>();
    return {
        ...actual,
        ensureRustTransformAvailable: vi.fn(),
        transformRustBatch: compilerMock.transformRustBatch,
    };
});

const { vitePlugin } = await import('../src/unplugin.js');

type ViteConfigHook = {
    configResolved?: (config: { root: string }) => void;
};

const tempDirs: string[] = [];

afterEach(() => {
    compilerMock.transformRustBatch.mockReset();
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

    it('batches rust prescan cache misses in one native call', () => {
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
        prePlugin.configResolved?.({ root });

        expect(compilerMock.transformRustBatch).toHaveBeenCalledTimes(1);
        expect(compilerMock.transformRustBatch.mock.calls[0]?.[0]).toEqual([
            { filename: appPath, source: 'export const App = () => <div sz={{ p: 4 }} />;' },
            { filename: cardPath, source: 'export const Card = () => <div sz={{ m: 2 }} />;' },
        ]);
        expect(readFileSync(join(root, 'csszyx-classes.html'), 'utf8')).toContain('p-4 m-2');
    });
});
