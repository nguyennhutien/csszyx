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
import { acquireNextSafelistStateLock } from '../src/next-safelist-state.js';
import { type NextTurboLoaderContext, runNextTurboLoader } from '../src/next-turbo-loader.js';
import { SAFELIST_HEADER } from '../src/safelist-format.js';
import { _resetThemeGroupsFileCache } from '../src/theme-groups-file.js';

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

    it('refuses to run while a stylesheet still names the old safelist', () => {
        const root = tempRoot();
        const source = 'export const App = () => <div sz={{ p: 4 }} />;';
        const filename = writeSource(root, source);
        // A real project root: the resolver settles on the directory that
        // holds the package manifest, and the stylesheet walk starts there.
        writeFileSync(join(root, 'package.json'), '{ "name": "app" }\n');
        mkdirSync(join(root, 'app'), { recursive: true });
        writeFileSync(
            join(root, 'app/globals.css'),
            '@import "tailwindcss";\n@source "../csszyx-classes.html";\n',
        );
        expect(() =>
            runNextTurboLoader(source, loaderContext(root, filename), {
                parserMode: 'auto',
                config: { mangleVars: false },
                writeOptions: { retryDelayMs: 0 },
            }),
        ).toThrow(/names the old safelist/);
    });

    it('transforms source, injects runtime imports, writes a shard, and materializes the safelist before returning', () => {
        const root = tempRoot();
        const source = '"use client";\nexport const App=({rest})=> <div sz={{ p: 4, ...rest }} />;';
        const filename = writeSource(root, source);
        const ctx = loaderContext(root, filename) as NextTurboLoaderContext & {
            dependencies: string[];
        };

        const result = runNextTurboLoader(source, ctx, {
            parserMode: 'auto',
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
            parserMode: 'auto',
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            compilerVersion: '0.9.0',
            nativeVersion: '0.9.0-test',
            writeOptions: { retryDelayMs: 0 },
        });
        const second = runNextTurboLoader(source, ctx, {
            parserMode: 'auto',
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
            parserMode: 'auto',
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
            parserMode: 'auto' as const,
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
        expect(readFileSync(second.context.safelist.outputPath, 'utf8')).toBe(SAFELIST_HEADER);
    });

    it('fails closed in production when the generation manifest is absent', () => {
        const root = tempRoot();
        const source = 'export const App=()=> <div sz={{ p: 4 }} />;';
        const filename = writeSource(root, source);

        expect(() =>
            runNextTurboLoader(source, loaderContext(root, filename), {
                parserMode: 'auto',
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
                parserMode: 'auto',
                mode: 'production',
                compilerOptions: { mangleVars: true },
            }),
        ).toThrow(/does not support production CSS variable mangling/);
    });
});

describe('szcn theme groups on the Turbopack lane', () => {
    const roots: string[] = [];

    afterEach(() => {
        _resetThemeGroupsFileCache();
        for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    /**
     * Build a project whose stylesheet declares tokens szcn groups by.
     *
     * @param options - Fixture switches.
     * @param options.theme - False to omit the @theme block entirely.
     * @param options.source - Module source to transform.
     * @returns The project root, the module path, and a loader context.
     */
    function project(options: { theme?: boolean; source: string }): {
        root: string;
        filename: string;
        ctx: NextTurboLoaderContext & { watched: string[] };
    } {
        const watched: string[] = [];
        const root = mkdtempSync(join(tmpdir(), 'csszyx-next-theme-'));
        roots.push(root);
        mkdirSync(join(root, 'src'), { recursive: true });
        // The Next root resolver walks up to the nearest package.json. Without
        // one the fixture root would resolve to src/, which is not what a real
        // project looks like.
        writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n', 'utf8');
        writeFileSync(
            join(root, 'src/theme.css'),
            options.theme === false
                ? '@import "tailwindcss";'
                : '@import "tailwindcss";\n@theme { --color-brand: #2dd597; }',
            'utf8',
        );
        const filename = join(root, 'src/App.tsx');
        writeFileSync(filename, options.source, 'utf8');
        return {
            root,
            filename,
            ctx: Object.assign(
                {
                    resourcePath: filename,
                    rootContext: root,
                    context: join(root, 'src'),
                    mode: 'development',
                    addDependency: (file: string) => {
                        watched.push(file);
                    },
                },
                { watched },
            ),
        };
    }

    /** Loader options every case in this block shares. */
    const OPTIONS = {
        parserMode: 'auto',
        config: { mangleVars: false },
        nextVersion: '16.2.7',
        csszyxVersion: '0.9.0',
        compilerVersion: '0.9.0',
        nativeVersion: '0.9.0-test',
        writeOptions: { retryDelayMs: 0 },
    } as const;

    it('writes a real registration module and imports it from a szcn caller', () => {
        // Turbopack cannot resolve the `virtual:` specifier every other lane
        // uses, so without a real file the app's custom tokens never register
        // and szcn keeps both classes with the stylesheet picking the winner.
        const { root, filename, ctx } = project({
            source: `"use client";\nimport { szcn } from '@csszyx/runtime';\nexport const A = (p) => szcn('text-brand', p.className);\n`,
        });

        const result = runNextTurboLoader(readFileSync(filename, 'utf8'), ctx, OPTIONS);

        const generated = join(root, '.csszyx/theme-groups.mjs');
        expect(existsSync(generated)).toBe(true);
        expect(readFileSync(generated, 'utf8')).toContain('"colors":["brand"]');
        expect(result.code).toContain("import '../.csszyx/theme-groups.mjs';");
        // The directive must stay the first statement in the module.
        expect(result.code.indexOf('"use client"')).toBeLessThan(
            result.code.indexOf('theme-groups.mjs'),
        );
    });

    it('leaves a module that cannot call szcn untouched', () => {
        const { root, filename, ctx } = project({
            source: 'export const A = () => <div sz={{ p: 4 }} />;',
        });

        const result = runNextTurboLoader(readFileSync(filename, 'utf8'), ctx, OPTIONS);

        expect(result.code).not.toContain('theme-groups');
        expect(existsSync(join(root, '.csszyx/theme-groups.mjs'))).toBe(false);
    });

    it('writes nothing when the project declares no groupable tokens', () => {
        // An empty registration would be a module every szcn caller imports
        // for no change in behaviour.
        const { root, filename, ctx } = project({
            theme: false,
            source: `import { szcn } from '@csszyx/runtime';\nexport const A = (p) => szcn('p-4', p.className);\n`,
        });

        const result = runNextTurboLoader(readFileSync(filename, 'utf8'), ctx, OPTIONS);

        expect(result.code).not.toContain('theme-groups');
        expect(existsSync(join(root, '.csszyx/theme-groups.mjs'))).toBe(false);
    });

    it('regenerates when a watched stylesheet changes, without restarting', () => {
        // Turbopack forwards a loader's file dependencies to its watcher, so an
        // edit re-runs the loader. The generated module must follow the edit
        // rather than stay at whatever the first compile saw.
        const { root, filename, ctx } = project({
            source: `import { szcn } from '@csszyx/runtime';\nexport const A = (p) => szcn('text-brand', p.className);\n`,
        });
        const generated = join(root, '.csszyx/theme-groups.mjs');

        runNextTurboLoader(readFileSync(filename, 'utf8'), ctx, OPTIONS);
        expect(readFileSync(generated, 'utf8')).toContain('"colors":["brand"]');
        expect(ctx.watched).toContain(join(root, 'src/theme.css'));

        writeFileSync(
            join(root, 'src/theme.css'),
            '@import "tailwindcss";\n@theme { --color-accent: #3f0fa6; }\n',
            'utf8',
        );
        runNextTurboLoader(readFileSync(filename, 'utf8'), ctx, OPTIONS);

        const after = readFileSync(generated, 'utf8');
        expect(after).toContain('"colors":["accent"]');
        expect(after).not.toContain('brand');
    });

    it('watches a stylesheet that carries no tokens yet', () => {
        // The edit that matters most is the one ADDING the first @theme block:
        // watching only token-carrying files would miss exactly that.
        const { root, filename, ctx } = project({
            theme: false,
            source: `import { szcn } from '@csszyx/runtime';\nexport const A = (p) => szcn('p-4', p.className);\n`,
        });

        runNextTurboLoader(readFileSync(filename, 'utf8'), ctx, OPTIONS);
        expect(ctx.watched).toContain(join(root, 'src/theme.css'));

        writeFileSync(
            join(root, 'src/theme.css'),
            '@import "tailwindcss";\n@theme { --color-late: #123456; }\n',
            'utf8',
        );
        const result = runNextTurboLoader(readFileSync(filename, 'utf8'), ctx, OPTIONS);

        expect(readFileSync(join(root, '.csszyx/theme-groups.mjs'), 'utf8')).toContain('"late"');
        expect(result.code).toContain('theme-groups.mjs');
    });
});

/**
 * What the loader does when someone else already holds the safelist lock.
 *
 * The documented Next Turbopack setup runs `csszyx next watch` alongside
 * `next dev`, and both materialize the safelist through the same lock. The
 * critical section is short — under a millisecond on a real shard set — but
 * the lock refuses a live holder outright, so an overlap surfaced as a module
 * build failure and the page stopped compiling. Measured on a CI run of this
 * repository, three Turbopack suites failed that way while the same tree
 * passed on the pull request.
 *
 * The loader does not need to win. It writes its shard BEFORE it reaches the
 * lock, and the watcher is driven by shard filesystem events rather than by
 * source ones, so the write that lost the race is the write that wakes the
 * winner. Yielding is not a fallback here; it is the shorter path to the same
 * state.
 *
 * A holder that is NOT a watcher gets no such treatment: two loaders in one
 * cycle means something is wrong, and that still has to be loud.
 */
describe('Next Turbopack loader under lock contention', () => {
    function tempRoot(): string {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-loader-lock-'));
        tempDirs.push(dir);
        return dir;
    }

    function loaderContext(root: string, filename: string): NextTurboLoaderContext {
        return {
            resourcePath: filename,
            rootContext: root,
            context: join(root, 'src'),
            mode: 'development',
            addDependency: () => undefined,
        } as NextTurboLoaderContext;
    }

    /**
     * Hold the lock the loader itself would take.
     *
     * The path is read off a real loader run rather than recomputed, because
     * the loader resolves its own root by walking up for the nearest package.
     * A lock held anywhere else is not contention — it is two processes
     * quietly working on different files, which is what an earlier draft of
     * this suite measured without noticing.
     *
     * @param cacheDir - the loader's own resolved cache directory.
     * @param command - what the competing holder calls itself.
     * @returns a release function for the held lock.
     */
    function holdLock(cacheDir: string, command: string): () => void {
        mkdirSync(cacheDir, { recursive: true });
        const lock = acquireNextSafelistStateLock(join(cacheDir, 'state.lock'), {
            root: cacheDir,
            mode: 'development',
            command,
        });
        return lock.release;
    }

    /**
     * @param root - project root.
     * @param file - path to write, relative to the root. Each case uses its
     *   own so a later run is a fresh transform rather than a cache hit.
     * @returns the loader result for one source file carrying an sz prop.
     */
    function runLoader(root: string, file = 'src/App.tsx'): ReturnType<typeof runNextTurboLoader> {
        const source = `export const App=()=> <div sz={{ p: ${file.length} }} />;`;
        const filename = join(root, file);
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(filename, source, 'utf8');
        return runNextTurboLoader(source, loaderContext(root, filename), {
            parserMode: 'auto',
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            compilerVersion: '0.9.0',
            nativeVersion: '0.9.0-test',
            writeOptions: { retryDelayMs: 0 },
        });
    }

    it('yields to a live watcher: shard written, materialization left to it, no throw', () => {
        const root = tempRoot();
        // One clean run first, to learn the directory the loader locks on.
        const cacheDir = runLoader(root, 'src/Warm.tsx').context.cacheDir;
        const release = holdLock(cacheDir, 'csszyx next watch');
        try {
            const result = runLoader(root, 'src/Yield.tsx');

            expect(result.shardPath && existsSync(result.shardPath)).toBe(true);
            expect(result.materialized).toBe(false);
        } finally {
            release();
        }
    });

    it('still throws when the holder is another loader', () => {
        const root = tempRoot();
        const cacheDir = runLoader(root, 'src/Warm.tsx').context.cacheDir;
        const release = holdLock(cacheDir, 'csszyx next turbo-loader');
        try {
            expect(() => runLoader(root, 'src/Loud.tsx')).toThrow(/already locked by process/);
        } finally {
            release();
        }
    });

    it('materializes as usual when nothing holds the lock', () => {
        const root = tempRoot();
        const result = runLoader(root);

        expect(result.materialized).toBe(true);
        expect(existsSync(result.context.safelist.outputPath)).toBe(true);
    });
});
