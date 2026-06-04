import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    acquireNextSafelistStateLock,
    materializeNextSafelist,
    writeNextSafelistShard,
} from '../src/next-safelist-state.js';
import { createNextStateContext, type NextStateContext } from '../src/next-state-context.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-next-monorepo-'));
    tempDirs.push(dir);
    return dir;
}

function writePackageJson(dir: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"private":true}\n', 'utf8');
}

interface SiblingFixture {
    repoRoot: string;
    webRoot: string;
    docsRoot: string;
}

function buildSiblingApps(): SiblingFixture {
    const repoRoot = join(tempRoot(), 'repo');
    const webRoot = join(repoRoot, 'apps/web');
    const docsRoot = join(repoRoot, 'apps/docs');
    writePackageJson(repoRoot);
    writePackageJson(webRoot);
    writePackageJson(docsRoot);
    mkdirSync(join(webRoot, 'app'), { recursive: true });
    mkdirSync(join(docsRoot, 'app'), { recursive: true });
    return { repoRoot, webRoot, docsRoot };
}

function buildContextFor(appRoot: string, repoRoot: string): NextStateContext {
    return createNextStateContext({
        loaderRootContext: repoRoot,
        loaderContext: join(appRoot, 'app/page.tsx'),
        config: { mangleVars: false },
        nextVersion: '16.2.7',
        csszyxVersion: '0.9.0',
        nativeVersion: '0.9.0-linux-arm64-gnu',
        mode: 'development',
    });
}

// Watcher convention from next-watcher-cycle.ts: lock lives at `${cacheDir}/state.lock`.
function lockPathFor(context: NextStateContext): string {
    return join(context.cacheDir, 'state.lock');
}

describe('Next monorepo / Vercel sibling-app isolation', () => {
    it('derives distinct cacheDir, safelist output, manifest, and lock path per sibling app', () => {
        const { repoRoot, webRoot, docsRoot } = buildSiblingApps();
        const web = buildContextFor(webRoot, repoRoot);
        const docs = buildContextFor(docsRoot, repoRoot);

        expect(web.cacheDir).not.toBe(docs.cacheDir);
        expect(web.safelist.outputPath).not.toBe(docs.safelist.outputPath);
        expect(web.safelist.shardsDir).not.toBe(docs.safelist.shardsDir);
        expect(web.safelist.snapshotPath).not.toBe(docs.safelist.snapshotPath);
        expect(web.manifestPath).not.toBe(docs.manifestPath);
        expect(lockPathFor(web)).not.toBe(lockPathFor(docs));

        // Each path stays inside its own app root — no leakage into the sibling.
        expect(web.cacheDir.startsWith(webRoot)).toBe(true);
        expect(web.cacheDir.startsWith(docsRoot)).toBe(false);
        expect(docs.cacheDir.startsWith(docsRoot)).toBe(true);
        expect(docs.cacheDir.startsWith(webRoot)).toBe(false);
    });

    it('writes safelist shards to one app cache without touching the sibling', () => {
        const { repoRoot, webRoot, docsRoot } = buildSiblingApps();
        const web = buildContextFor(webRoot, repoRoot);
        const docs = buildContextFor(docsRoot, repoRoot);

        const webShard = writeNextSafelistShard(web.safelist.shardsDir, {
            sourcePath: join(webRoot, 'app/page.tsx'),
            sourceHash: 'web-hash',
            classes: ['p-4', 'bg-emerald-500'],
            cacheKey: 'web-cache-key',
            timestamp: 1717420800000,
            pid: 4242,
        });

        expect(webShard.filePath.startsWith(webRoot)).toBe(true);
        expect(webShard.filePath.startsWith(docsRoot)).toBe(false);

        // docs shard dir must not exist purely as a side effect of web writes.
        // (readdirSync on a missing dir throws ENOENT — we use that as the
        // assertion signal.)
        expect(() => readdirSync(docs.safelist.shardsDir)).toThrow(/ENOENT/);
    });

    it('materializes safelist outputs into one app root only', () => {
        const { repoRoot, webRoot, docsRoot } = buildSiblingApps();
        const web = buildContextFor(webRoot, repoRoot);
        const docs = buildContextFor(docsRoot, repoRoot);

        // The materializer tombstones shards whose source no longer exists, so
        // the source has to be on disk for the shard to survive a real
        // materialization pass.
        const webSourcePath = join(webRoot, 'app/page.tsx');
        writeFileSync(webSourcePath, 'export default function Page() { return null; }\n');

        writeNextSafelistShard(web.safelist.shardsDir, {
            sourcePath: webSourcePath,
            sourceHash: 'web-hash',
            classes: ['p-4', 'bg-emerald-500'],
            cacheKey: 'web-cache-key',
            timestamp: 1717420800000,
            pid: 4242,
        });

        const result = materializeNextSafelist(web.safelist);
        expect(result.shardCount).toBe(1);
        expect(result.classCount).toBe(2);

        // Web output exists and lives under web root.
        expect(web.safelist.outputPath.startsWith(webRoot)).toBe(true);

        // Docs root is untouched: no .csszyx dir created, no safelist output.
        expect(() => readdirSync(join(docsRoot, '.csszyx'))).toThrow(/ENOENT/);
        expect(docs.safelist.outputPath.startsWith(docsRoot)).toBe(true);
    });

    it('allows two sibling apps to hold state locks concurrently', () => {
        const { repoRoot, webRoot, docsRoot } = buildSiblingApps();
        const web = buildContextFor(webRoot, repoRoot);
        const docs = buildContextFor(docsRoot, repoRoot);

        const webLock = acquireNextSafelistStateLock(lockPathFor(web), {
            pid: 10001,
            root: web.root,
            mode: 'development',
            command: 'csszyx watcher web',
        });
        // Second sibling acquires its own lock without conflict.
        const docsLock = acquireNextSafelistStateLock(lockPathFor(docs), {
            pid: 10002,
            root: docs.root,
            mode: 'development',
            command: 'csszyx watcher docs',
        });

        try {
            expect(webLock.lockPath).not.toBe(docsLock.lockPath);
            expect(webLock.token).not.toBe(docsLock.token);
        } finally {
            webLock.release();
            docsLock.release();
        }

        // Releasing one sibling lock must not affect the other's earlier
        // visibility — release is idempotent so calling twice is safe.
        webLock.release();
        docsLock.release();
    });

    it('Vercel Root Directory: explicit root scopes state to one app and ignores siblings', () => {
        const { webRoot, docsRoot } = buildSiblingApps();

        // Simulate Vercel project setting "Root Directory = apps/web". Vercel
        // runs the build with that path as the effective project root, and the
        // sibling apps/docs is never the loader rootContext or cwd.
        const vercelWeb = createNextStateContext({
            explicitRoot: webRoot,
            cwd: webRoot,
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'production',
        });

        expect(vercelWeb.root).toBe(webRoot);
        expect(vercelWeb.rootSource).toBe('explicit');
        expect(vercelWeb.cacheDir.startsWith(webRoot)).toBe(true);
        expect(vercelWeb.cacheDir.startsWith(docsRoot)).toBe(false);
        expect(vercelWeb.safelist.outputPath.startsWith(webRoot)).toBe(true);
        expect(vercelWeb.safelist.outputPath.startsWith(docsRoot)).toBe(false);
        expect(vercelWeb.manifestPath.startsWith(webRoot)).toBe(true);
        expect(vercelWeb.manifestPath.startsWith(docsRoot)).toBe(false);
        expect(lockPathFor(vercelWeb).startsWith(webRoot)).toBe(true);

        // The docs sibling stays untouched on disk — no state context for it
        // was ever derived, and no cache directory was created.
        expect(() => readdirSync(join(docsRoot, '.csszyx'))).toThrow(/ENOENT/);
    });

    it('generation identity stays sibling-specific even with identical config and env', () => {
        const { repoRoot, webRoot, docsRoot } = buildSiblingApps();
        const web = buildContextFor(webRoot, repoRoot);
        const docs = buildContextFor(docsRoot, repoRoot);

        // Same config object, same env-key list, same versions, same mode.
        // Only the resolved root differs. The identity hash must still differ
        // so a stale manifest from app A cannot be mistaken for app B's.
        expect(web.identity.generation).not.toBe(docs.identity.generation);
        expect(web.manifestExpectation.root).toBe(webRoot);
        expect(docs.manifestExpectation.root).toBe(docsRoot);
    });
});
