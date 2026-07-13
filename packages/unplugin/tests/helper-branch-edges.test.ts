/**
 * Branch edges for small pure helpers exported from unplugin.ts:
 * `isMonorepoPackage` via an ancestor package.json `workspaces` field,
 * `resolveCompileSourceDirs` through its DEFAULT (real-fs) resolver, and the
 * trailing-slash normalization path in `isCompileSourceOptedIn`.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    isCompileSourceOptedIn,
    isMonorepoPackage,
    resolveCompileSourceDirs,
} from '../src/unplugin.js';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-helper-edge-')));
    tempDirs.push(dir);
    return dir;
}

describe('isMonorepoPackage', () => {
    it('detects an ancestor package.json with a workspaces field', () => {
        const root = tempDir();
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({ name: 'wsroot', workspaces: ['packages/*'] }),
        );
        const pkg = join(root, 'packages', 'web');
        mkdirSync(pkg, { recursive: true });
        expect(isMonorepoPackage(pkg)).toBe(true);
    });

    it('keeps walking up past an ancestor package.json with no workspaces field', () => {
        const root = tempDir();
        writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'plain' }));
        const pkg = join(root, 'apps', 'web');
        mkdirSync(pkg, { recursive: true });
        expect(isMonorepoPackage(pkg)).toBe(false);
    });
});

describe('resolveCompileSourceDirs (default fs resolver)', () => {
    it('keeps existing directories and reports non-directory entries as missing', () => {
        const root = tempDir();
        mkdirSync(join(root, 'ui'), { recursive: true });
        writeFileSync(join(root, 'notadir.txt'), 'x');

        const got = resolveCompileSourceDirs(root, ['ui', 'notadir.txt', 'does-not-exist']);
        expect(got.dirs).toEqual([join(root, 'ui').replace(/\\/g, '/')]);
        // A regular file resolves (realpath) but fails the isDirectory() check,
        // and a nonexistent entry throws — both land in `missing`.
        expect(got.missing.sort()).toEqual(['does-not-exist', 'notadir.txt']);
    });
});

describe('isCompileSourceOptedIn trailing-slash normalization', () => {
    it('matches an id carrying a trailing slash against a slash-free dir', () => {
        expect(isCompileSourceOptedIn('/repo/src/', ['/repo/src'])).toBe(true);
    });
});
