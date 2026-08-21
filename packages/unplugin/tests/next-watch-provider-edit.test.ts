/**
 * A style module edited during a dev session, end to end on the Turbopack lane.
 *
 * Nothing here re-transforms anything on its own. The safelist watcher only
 * aggregates shards, and the shards are written by the loader — so the chain
 * that keeps dev CSS correct after a provider edit has four links:
 *
 *   1. Turbopack re-runs the loader on the IMPORTER, because the loader
 *      declared the provider with `addDependency`.
 *   2. The loader recompiles against the provider's new value.
 *   3. Its shard changes, because a shard is keyed by source PATH and compared
 *      by content — same file, different classes.
 *   4. The watcher sees the shard change and re-materializes the safelist.
 *
 * Link 1 belongs to Turbopack and is covered by the addDependency e2e probe.
 * Links 2–4 are here, driven directly so the assertion is deterministic and
 * needs neither chokidar nor a dev server. What they establish is the thing
 * that would otherwise be assumed: the class the loader now emits is the class
 * Tailwind is now told about, and the class it replaced is gone.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearNextAliasCache } from '../src/next-cross-module.js';
import { runNextPrebuild } from '../src/next-prebuild.js';
import { type NextTurboLoaderContext, runNextTurboLoader } from '../src/next-turbo-loader.js';
import { NextSafelistWatcher } from '../src/next-watcher.js';

const roots: string[] = [];

const IMPORTER =
    "import { cardSz } from '@/app/styles';\nexport default () => <div sz={cardSz} />;\n";

const SHARED = {
    parserMode: 'auto',
    config: { mangleVars: false },
    nextVersion: '16.2.7',
    csszyxVersion: '0.9.0',
    compilerVersion: '0.9.0',
    nativeVersion: '0.9.0-test',
    writeOptions: { retryDelayMs: 0 },
    importedStaticSz: true,
} as const;

/**
 * Write a Next-shaped project whose page imports its styles through `@/`.
 *
 * @returns The root and the page path.
 */
function project(): { root: string; page: string } {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-next-watch-xmod-'));
    roots.push(root);
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n');
    writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } }),
    );
    writeFileSync(join(root, 'app/styles.ts'), 'export const cardSz = { p: 7 };\n');
    const page = join(root, 'app/page.tsx');
    writeFileSync(page, IMPORTER);
    return { root, page };
}

/**
 * A loader context that records what the loader declared.
 *
 * @param root - Project root.
 * @param page - The module being transformed.
 * @returns The context plus its dependency list.
 */
function loaderContext(
    root: string,
    page: string,
): NextTurboLoaderContext & { dependencies: string[] } {
    const dependencies: string[] = [];
    return {
        resourcePath: page,
        rootContext: root,
        context: join(root, 'app'),
        mode: 'development',
        addDependency: (file: string) => {
            dependencies.push(file);
        },
        dependencies,
    } as unknown as NextTurboLoaderContext & { dependencies: string[] };
}

beforeEach(() => {
    clearNextAliasCache();
});

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('a provider edited mid dev session', () => {
    it('carries the new class into the safelist and drops the old one', () => {
        const { root, page } = project();
        const prebuild = runNextPrebuild({
            files: [page],
            explicitRoot: root,
            cwd: root,
            mode: 'development',
            ...SHARED,
        });
        expect(readFileSync(prebuild.safelistOutputPath, 'utf8')).toContain('p-7');

        const watcher = new NextSafelistWatcher({
            context: prebuild.context,
            cycleOptions: { writeOptions: SHARED.writeOptions },
        });
        watcher.start();

        // The edit a developer makes. The importer's own source is untouched,
        // which is the whole difficulty: nothing about `page.tsx` changed.
        writeFileSync(join(root, 'app/styles.ts'), 'export const cardSz = { p: 9 };\n');

        const ctx = loaderContext(root, page);
        const rerun = runNextTurboLoader(IMPORTER, ctx, SHARED);
        expect(rerun.code).toContain('className="p-9"');
        expect(ctx.dependencies).toContain(join(root, 'app/styles.ts'));
        // A shard keyed by content rather than by path would land in a new file
        // and leave the old one behind, so both classes would survive.
        expect(rerun.shardPath).toBe(prebuild.files[0]?.shardPath);

        expect(watcher.notify('change', rerun.shardPath as string)).toBe(true);
        watcher.flush();
        watcher.close();

        const safelist = readFileSync(prebuild.safelistOutputPath, 'utf8');
        expect(safelist).toContain('p-9');
        // Dropping the old one matters as much as gaining the new one: a
        // safelist that only grows keeps generating CSS for rules nothing
        // renders, and hides a regression where the edit did not take.
        expect(safelist).not.toContain('p-7');
    });

    it('ignores the provider edit itself, which is why the declaration matters', () => {
        // The watcher accepts shard events, not source events. Editing a style
        // module moves nothing on its own — only the loader re-running writes a
        // shard. That is the whole reason the loader must declare its
        // providers: without it, Turbopack never re-runs the importer and this
        // chain has no first link.
        const { root, page } = project();
        const prebuild = runNextPrebuild({
            files: [page],
            explicitRoot: root,
            cwd: root,
            mode: 'development',
            ...SHARED,
        });
        const watcher = new NextSafelistWatcher({
            context: prebuild.context,
            cycleOptions: { writeOptions: SHARED.writeOptions },
        });
        watcher.start();

        expect(watcher.notify('change', join(root, 'app/styles.ts'))).toBe(false);
        watcher.close();
    });

    it('materializes an unchanged provider as an unchanged safelist', () => {
        // The negative control for the first case. If re-running the loader
        // rewrote the shard every time, the first test would pass whether or
        // not the edit was read.
        const { root, page } = project();
        const prebuild = runNextPrebuild({
            files: [page],
            explicitRoot: root,
            cwd: root,
            mode: 'development',
            ...SHARED,
        });
        const before = readFileSync(prebuild.safelistOutputPath, 'utf8');

        const rerun = runNextTurboLoader(IMPORTER, loaderContext(root, page), SHARED);
        expect(rerun.code).toContain('className="p-7"');

        const watcher = new NextSafelistWatcher({
            context: prebuild.context,
            cycleOptions: { writeOptions: SHARED.writeOptions },
        });
        watcher.start();
        watcher.flush();
        watcher.close();

        expect(readFileSync(prebuild.safelistOutputPath, 'utf8')).toBe(before);
    });
});
