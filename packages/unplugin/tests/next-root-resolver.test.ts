import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveNextAppCacheDir, resolveNextAppRoot } from '../src/next-root-resolver.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Next app root resolver', () => {
    function tempRoot(): string {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-next-root-'));
        tempDirs.push(dir);
        return dir;
    }

    function writePackageJson(dir: string): void {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'package.json'), '{"private":true}\n', 'utf8');
    }

    it('prefers explicit root over loader and cwd candidates', () => {
        const root = tempRoot();
        const explicit = join(root, 'apps/web');
        const loaderRootContext = join(root, 'repo-root');

        expect(
            resolveNextAppRoot({
                explicitRoot: explicit,
                loaderRootContext,
                cwd: root,
            }),
        ).toEqual({
            root: explicit,
            source: 'explicit',
        });
    });

    it('uses loader root context before nested loader context', () => {
        const root = tempRoot();
        const appRoot = join(root, 'apps/web');
        const nestedContext = join(appRoot, 'src/app');
        writePackageJson(appRoot);

        expect(
            resolveNextAppRoot({
                loaderRootContext: appRoot,
                loaderContext: nestedContext,
                cwd: root,
            }),
        ).toEqual({
            root: appRoot,
            source: 'loader-root-context',
        });
    });

    it('prefers nested app package root when loader root context is the monorepo root', () => {
        const root = tempRoot();
        const repoRoot = join(root, 'repo');
        const webRoot = join(repoRoot, 'apps/web');
        const docsRoot = join(repoRoot, 'apps/docs');
        writePackageJson(repoRoot);
        writePackageJson(webRoot);
        writePackageJson(docsRoot);

        expect(
            resolveNextAppRoot({
                loaderRootContext: repoRoot,
                loaderContext: join(webRoot, 'src/app'),
            }),
        ).toEqual({
            root: webRoot,
            source: 'loader-context',
        });
        expect(
            resolveNextAppRoot({
                loaderRootContext: repoRoot,
                loaderContext: join(docsRoot, 'src/app'),
            }),
        ).toEqual({
            root: docsRoot,
            source: 'loader-context',
        });
    });

    it('walks loader context up to the nearest package root', () => {
        const root = tempRoot();
        const appRoot = join(root, 'apps/web');
        const nestedContext = join(appRoot, 'src/app');
        writePackageJson(appRoot);
        mkdirSync(nestedContext, { recursive: true });

        expect(resolveNextAppRoot({ loaderContext: nestedContext, cwd: root })).toEqual({
            root: appRoot,
            source: 'loader-context',
        });
    });

    it('keeps sibling workspace app caches isolated', () => {
        const root = tempRoot();
        const webRoot = join(root, 'apps/web');
        const docsRoot = join(root, 'apps/docs');
        writePackageJson(webRoot);
        writePackageJson(docsRoot);

        expect(resolveNextAppCacheDir(webRoot)).toBe(join(webRoot, '.csszyx/cache'));
        expect(resolveNextAppCacheDir(docsRoot)).toBe(join(docsRoot, '.csszyx/cache'));
        expect(resolveNextAppCacheDir(webRoot)).not.toBe(resolveNextAppCacheDir(docsRoot));
    });

    it('keeps Vercel-style sibling app roots scoped from loader context', () => {
        const root = tempRoot();
        const repoRoot = join(root, 'repo');
        const webRoot = join(repoRoot, 'apps/web');
        const docsRoot = join(repoRoot, 'apps/docs');
        writePackageJson(repoRoot);
        writePackageJson(webRoot);
        writePackageJson(docsRoot);

        const web = resolveNextAppRoot({
            loaderRootContext: repoRoot,
            loaderContext: join(webRoot, 'app/page.tsx'),
            cwd: repoRoot,
        });
        const docs = resolveNextAppRoot({
            loaderRootContext: repoRoot,
            loaderContext: join(docsRoot, 'app/page.tsx'),
            cwd: repoRoot,
        });

        expect(web).toEqual({ root: webRoot, source: 'loader-context' });
        expect(docs).toEqual({ root: docsRoot, source: 'loader-context' });
        expect(resolveNextAppCacheDir(web.root)).toBe(join(webRoot, '.csszyx/cache'));
        expect(resolveNextAppCacheDir(docs.root)).toBe(join(docsRoot, '.csszyx/cache'));
        expect(resolveNextAppCacheDir(web.root)).not.toBe(resolveNextAppCacheDir(docs.root));
    });

    it('falls back to cwd package root only when stronger candidates are absent', () => {
        const root = tempRoot();
        const appRoot = join(root, 'apps/web');
        const nestedCwd = join(appRoot, 'src/app');
        writePackageJson(appRoot);
        mkdirSync(nestedCwd, { recursive: true });

        expect(resolveNextAppRoot({ cwd: nestedCwd })).toEqual({
            root: appRoot,
            source: 'cwd',
        });
    });

    // Win32 path normalization documentation tests. These pin the current
    // contract that csszyx defers to node:path semantics and does NOT add
    // its own case folding, drive-letter canonicalization, or UNC rewriting.
    // The tests use `node:path/win32` directly so they run deterministically
    // on POSIX hosts; the actual fs-touching `resolveNextAppRoot` cannot be
    // exercised against Windows paths from Linux because `fs.existsSync` would
    // need a Windows filesystem.

    describe('Windows path normalization (pure-string contract)', () => {
        it('preserves drive-letter case when normalized — csszyx will treat C:/ and c:/ as different roots', () => {
            const upper = win32.normalize('C:\\App\\src');
            const lower = win32.normalize('c:\\App\\src');

            // Documents node:path behavior. csszyx hashes the resolved path
            // string as the shard cache key, so a build that mixes drive
            // casing produces split state — users must keep drive letters
            // consistent across their toolchain.
            expect(upper).not.toBe(lower);
            expect(upper).toBe('C:\\App\\src');
            expect(lower).toBe('c:\\App\\src');
        });

        it('keeps UNC path forms distinct from their device-namespace equivalents', () => {
            const unc = win32.normalize('\\\\server\\share\\App');
            const deviceUnc = win32.normalize('\\\\?\\UNC\\server\\share\\App');

            // The two forms point at the same network location on Windows
            // but are not collapsed by node:path. csszyx inherits this:
            // builds running under one form produce a different shard cache
            // than builds running under the other. Documented limitation.
            expect(unc).not.toBe(deviceUnc);
            expect(unc.startsWith('\\\\server\\share')).toBe(true);
            expect(deviceUnc.startsWith('\\\\?\\UNC\\')).toBe(true);
        });

        it('collapses forward slashes inside a win32 path into backslashes', () => {
            // Tools sometimes emit forward slashes inside Windows paths
            // (webpack/turbopack loader contexts on PowerShell, for example).
            // node:path/win32 normalizes them to backslashes, so two strings
            // that differ only in slash direction end up equal after
            // normalization. csszyx inherits this behavior — no extra work
            // needed for that specific edge case.
            expect(win32.normalize('C:/App/src/page.tsx')).toBe('C:\\App\\src\\page.tsx');
            expect(win32.normalize('C:\\App\\src\\page.tsx')).toBe('C:\\App\\src\\page.tsx');
        });
    });
});
