import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
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
        // The loader intentionally registers no Turbopack dependencies. The
        // transformed code is a pure function of the source plus the resolved
        // csszyx config; the safelist output, snapshot, and generation
        // manifest are side-effect outputs of the cycle, not inputs of the
        // transform, so registering them would force a self-invalidation
        // cascade across loader calls.
        expect(result.dependencies).toEqual([]);
        expect(ctx.dependencies).toEqual([]);
    });

    it('skips the materialization cycle on a repeated invocation with the same source content', () => {
        const root = tempRoot();
        const source = 'export const App=()=> <div sz={{ p: 4 }} />;';
        const filename = writeSource(root, source);
        const ctx = loaderContext(root, filename);

        const first = runNextTurboLoader(source, ctx, {
            parserMode: 'babel',
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            compilerVersion: '0.9.0',
            nativeVersion: '0.9.0-test',
            writeOptions: { retryDelayMs: 0 },
        });
        const second = runNextTurboLoader(source, ctx, {
            parserMode: 'babel',
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            compilerVersion: '0.9.0',
            nativeVersion: '0.9.0-test',
            writeOptions: { retryDelayMs: 0 },
        });

        // First call writes the shard and runs the materialize cycle. Second
        // call sees the equivalent shard already on disk; the shard write is
        // a no-op so the cycle is skipped entirely. Without this skip, every
        // Turbopack loader invocation across N files would re-acquire the
        // state lock and re-materialize the full safelist, making initial dev
        // start O(N²) shard reads.
        expect(first.materialized).toBe(true);
        expect(second.materialized).toBe(false);
        expect(second.shardPath).toBe(first.shardPath);
        expect(readFileSync(second.context.safelist.outputPath, 'utf8')).toContain('p-4');
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

    it('materializes an empty shard when the last sz prop is removed from a file', () => {
        const root = tempRoot();
        const withSz = 'export const App=()=> <div sz={{ p: 4 }} />;';
        const withoutSz = 'export const App=()=> <div />;';
        const filename = writeSource(root, withSz);
        const ctx = loaderContext(root, filename);
        const options = {
            parserMode: 'babel' as const,
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            compilerVersion: '0.9.0',
            nativeVersion: '0.9.0-test',
            writeOptions: { retryDelayMs: 0 },
        };

        const first = runNextTurboLoader(withSz, ctx, options);
        expect(readFileSync(first.context.safelist.outputPath, 'utf8')).toContain('p-4');

        writeFileSync(filename, withoutSz, 'utf8');
        const second = runNextTurboLoader(withoutSz, ctx, options);

        expect(second.shardPath && existsSync(second.shardPath)).toBe(true);
        expect(second.shardPath).toBe(first.shardPath);
        expect(readdirSync(second.context.safelist.shardsDir)).toHaveLength(1);
        expect(second.materialized).toBe(true);
        expect(readFileSync(second.context.safelist.outputPath, 'utf8')).toBe(
            '<!-- csszyx Next safelist: empty -->\n',
        );
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
