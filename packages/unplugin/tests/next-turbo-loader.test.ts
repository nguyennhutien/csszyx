import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readNextGenerationManifest } from '../src/next-generation-manifest.js';
import { type NextTurboLoaderContext, runNextTurboLoader } from '../src/next-turbo-loader.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Next Turbopack loader core', () => {
    function tempRoot(): string {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-next-loader-'));
        tempDirs.push(dir);
        return dir;
    }

    function writeSource(root: string, source: string, file = 'src/App.tsx'): string {
        const filename = join(root, file);
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(filename, source, 'utf8');
        return filename;
    }

    function loaderContext(root: string, filename: string): NextTurboLoaderContext {
        const dependencies: string[] = [];
        return {
            resourcePath: filename,
            rootContext: root,
            context: join(root, 'src'),
            mode: 'development',
            addDependency: file => {
                dependencies.push(file);
            },
            get dependencies() {
                return dependencies;
            },
        } as NextTurboLoaderContext & { dependencies: string[] };
    }

    it('transforms source, injects runtime imports, writes a shard, and materializes the safelist before returning', () => {
        const root = tempRoot();
        const source = '"use client";\nexport const App=({rest})=> <div sz={{ p: 4, ...rest }} />;';
        const filename = writeSource(root, source);
        const ctx = loaderContext(root, filename) as NextTurboLoaderContext & {
            dependencies: string[];
        };

        const result = runNextTurboLoader(source, ctx, {
            parserMode: 'babel',
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            compilerVersion: '0.9.0',
            nativeVersion: '0.9.0-test',
            writeOptions: { retryDelayMs: 0 },
        });

        expect(result.code).toContain('"use client";');
        expect(result.code).toContain("import { _sz } from '@csszyx/runtime';");
        expect(result.code).toContain('className={_sz({');
        expect(result.code).toContain('p: 4');
        expect(result.code).toContain('...rest');
        expect(result.shardPath && existsSync(result.shardPath)).toBe(true);
        expect(result.materialized).toBe(true);
        expect(readFileSync(result.context.safelist.outputPath, 'utf8')).toContain('p-4');
        expect(readNextGenerationManifest(result.context.manifestPath)?.completed).toBe(true);
        expect(ctx.dependencies).toEqual(
            expect.arrayContaining([
                result.context.manifestPath,
                result.shardPath,
                result.context.safelist.outputPath,
                result.context.safelist.snapshotPath,
            ]),
        );
    });

    it('can write only the metadata shard when an external watcher owns materialization', () => {
        const root = tempRoot();
        const source = 'export const App=()=> <div sz={{ p: 8 }} />;';
        const filename = writeSource(root, source);

        const result = runNextTurboLoader(source, loaderContext(root, filename), {
            parserMode: 'babel',
            materializeSafelist: false,
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            compilerVersion: '0.9.0',
            nativeVersion: '0.9.0-test',
            writeOptions: { retryDelayMs: 0 },
        });

        expect(result.shardPath && existsSync(result.shardPath)).toBe(true);
        expect(result.materialized).toBe(false);
        expect(existsSync(result.context.safelist.outputPath)).toBe(false);
    });

    it('fails closed in production when the generation manifest is absent', () => {
        const root = tempRoot();
        const source = 'export const App=()=> <div sz={{ p: 4 }} />;';
        const filename = writeSource(root, source);

        expect(() =>
            runNextTurboLoader(source, loaderContext(root, filename), {
                parserMode: 'babel',
                mode: 'production',
                config: { mangleVars: false },
                nextVersion: '16.2.7',
                csszyxVersion: '0.9.0',
                compilerVersion: '0.9.0',
                nativeVersion: '0.9.0-test',
            }),
        ).toThrow(/prebuild/);
    });

    it('rejects unsupported production CSS variable mangling under Turbopack', () => {
        const root = tempRoot();
        const source = 'export const App=()=> <div sz={{ color: "red" }} />;';
        const filename = writeSource(root, source);

        expect(() =>
            runNextTurboLoader(source, loaderContext(root, filename), {
                parserMode: 'babel',
                mode: 'production',
                compilerOptions: { mangleVars: true },
            }),
        ).toThrow(/does not support production CSS variable mangling/);
    });
});
