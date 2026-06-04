import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    createNextGenerationManifestFromContext,
    createNextStateContext,
} from '../src/next-state-context.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Next state context', () => {
    function tempRoot(): string {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-next-context-'));
        tempDirs.push(dir);
        return dir;
    }

    it('derives one scoped state context from explicit app root', () => {
        const root = tempRoot();
        const appRoot = join(root, 'apps/web');
        mkdirSync(appRoot, { recursive: true });
        writeFileSync(join(appRoot, 'package.json'), '{"private":true}\n', 'utf8');

        const context = createNextStateContext({
            explicitRoot: appRoot,
            loaderRootContext: root,
            config: { mangleVars: false },
            env: { NEXT_PUBLIC_THEME: 'dark', SECRET_TOKEN: 'ignored' },
            envKeys: ['NEXT_PUBLIC_THEME'],
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development',
        });

        expect(context.root).toBe(appRoot);
        expect(context.rootSource).toBe('explicit');
        expect(context.cacheDir).toBe(join(appRoot, '.csszyx/cache'));
        expect(context.safelist.shardsDir).toBe(join(appRoot, '.csszyx/cache/safelist-shards'));
        expect(context.safelist.outputPath).toBe(join(appRoot, 'csszyx-classes.html'));
        expect(context.manifestPath).toBe(join(appRoot, '.csszyx/cache/generation-manifest.json'));
        expect(context.manifestExpectation).toMatchObject({
            root: appRoot,
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development',
        });
        expect(context.manifestExpectation.configHash).toBe(context.identity.configHash);
        expect(context.manifestExpectation.envHash).toBe(context.identity.envHash);
    });

    it('keeps custom cache and safelist output scoped to the same app root', () => {
        const root = tempRoot();
        const appRoot = join(root, 'apps/web');
        mkdirSync(join(appRoot, 'src/app'), { recursive: true });
        writeFileSync(join(appRoot, 'package.json'), '{"private":true}\n', 'utf8');

        const context = createNextStateContext({
            loaderContext: join(appRoot, 'src/app'),
            cacheDir: '.cache/csszyx',
            safelistOutputFile: 'src/csszyx-classes.html',
            config: { mangleVars: true },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'production',
        });

        expect(context.root).toBe(appRoot);
        expect(context.rootSource).toBe('loader-context');
        expect(context.cacheDir).toBe(join(appRoot, '.cache/csszyx'));
        expect(context.safelist.cacheDir).toBe(join(appRoot, '.cache/csszyx'));
        expect(context.safelist.outputPath).toBe(join(appRoot, 'src/csszyx-classes.html'));
        expect(context.manifestPath).toBe(join(appRoot, '.cache/csszyx/generation-manifest.json'));
    });

    it('isolates sibling app state when loader root context is a monorepo root', () => {
        const root = tempRoot();
        const repoRoot = join(root, 'repo');
        const webRoot = join(repoRoot, 'apps/web');
        const docsRoot = join(repoRoot, 'apps/docs');
        mkdirSync(join(webRoot, 'app'), { recursive: true });
        mkdirSync(join(docsRoot, 'app'), { recursive: true });
        writeFileSync(join(repoRoot, 'package.json'), '{"private":true}\n', 'utf8');
        writeFileSync(join(webRoot, 'package.json'), '{"private":true}\n', 'utf8');
        writeFileSync(join(docsRoot, 'package.json'), '{"private":true}\n', 'utf8');

        const web = createNextStateContext({
            loaderRootContext: repoRoot,
            loaderContext: join(webRoot, 'app/page.tsx'),
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development',
        });
        const docs = createNextStateContext({
            loaderRootContext: repoRoot,
            loaderContext: join(docsRoot, 'app/page.tsx'),
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development',
        });

        expect(web.root).toBe(webRoot);
        expect(docs.root).toBe(docsRoot);
        expect(web.rootSource).toBe('loader-context');
        expect(docs.rootSource).toBe('loader-context');
        expect(web.cacheDir).toBe(join(webRoot, '.csszyx/cache'));
        expect(docs.cacheDir).toBe(join(docsRoot, '.csszyx/cache'));
        expect(web.manifestPath).not.toBe(docs.manifestPath);
        expect(web.safelist.outputPath).not.toBe(docs.safelist.outputPath);
        expect(web.identity.generation).not.toBe(docs.identity.generation);
    });

    it('creates a completed generation manifest from the same context identity', () => {
        const root = tempRoot();
        const context = createNextStateContext({
            explicitRoot: root,
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development',
        });

        expect(
            createNextGenerationManifestFromContext(context, 42, '2026-06-04T00:00:00.000Z'),
        ).toEqual({
            schema: 1,
            generation: context.identity.generation,
            root,
            configHash: context.identity.configHash,
            envHash: context.identity.envHash,
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development',
            sourceCount: 42,
            completed: true,
            createdAt: '2026-06-04T00:00:00.000Z',
        });
    });
});
