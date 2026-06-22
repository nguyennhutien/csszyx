import { describe, expect, it } from 'vitest';

import {
    isCompilePackageOptedIn,
    isHardIgnoredPath,
    isPackagesSkippedSource,
    resolveCompilePackageDirs,
    skippedSzFilesMessage,
} from '../src/unplugin.js';

// The compilePackages opt-in + skip diagnostic decide which workspace-package
// files csszyx compiles vs. silently skips. The build wiring runs in a worker
// (see missing-tailwind-entry.test.ts), so the precedence — node_modules/.next
// stay hard regardless of compilePackages — is asserted on the pure functions.

describe('isHardIgnoredPath', () => {
    it('relaxes /packages/<name>/ when the package is opted in', () => {
        expect(isHardIgnoredPath('/repo/packages/vui/src/Button.tsx', ['vui'])).toBe(false);
    });

    it('still ignores /packages/ source that is not opted in', () => {
        expect(isHardIgnoredPath('/repo/packages/vui/src/Button.tsx', [])).toBe(true);
        expect(isHardIgnoredPath('/repo/packages/other/x.tsx', ['vui'])).toBe(true);
    });

    it('never relaxes node_modules, even when the name is listed (safety)', () => {
        expect(isHardIgnoredPath('/repo/node_modules/vui/index.js', ['vui'])).toBe(true);
        // A nested workspace package inside node_modules stays ignored too.
        expect(isHardIgnoredPath('/repo/node_modules/x/packages/vui/i.js', ['vui'])).toBe(true);
    });

    it('keeps .next ignored except its static assets, regardless of opt-in', () => {
        expect(isHardIgnoredPath('/repo/.next/server/page.js', ['vui'])).toBe(true);
        expect(isHardIgnoredPath('/repo/.next/static/chunk.js', [])).toBe(false);
    });

    it('does not ignore ordinary app source', () => {
        expect(isHardIgnoredPath('/repo/src/app.tsx', ['vui'])).toBe(false);
    });

    it('ignores pnpm and scoped dependency layouts under node_modules', () => {
        expect(
            isHardIgnoredPath('/repo/node_modules/.pnpm/vui@1/node_modules/vui/i.js', ['vui']),
        ).toBe(true);
        expect(isHardIgnoredPath('/repo/node_modules/@scope/pkg/index.js', ['vui'])).toBe(true);
    });

    it('relaxes an opted-in package on Windows backslash paths', () => {
        expect(isHardIgnoredPath('C:\\repo\\packages\\vui\\src\\Button.tsx', ['vui'])).toBe(false);
        expect(isHardIgnoredPath('C:\\repo\\packages\\vui\\src\\Button.tsx', [])).toBe(true);
        expect(isHardIgnoredPath('C:\\repo\\node_modules\\vui\\index.js', ['vui'])).toBe(true);
    });

    it('matches the legacy behavior when compilePackages is unset', () => {
        // node_modules || /packages/ || (.next && !static)
        expect(isHardIgnoredPath('/repo/node_modules/a/i.js')).toBe(true);
        expect(isHardIgnoredPath('/repo/packages/a/i.tsx')).toBe(true);
        expect(isHardIgnoredPath('/repo/.next/server/i.js')).toBe(true);
        expect(isHardIgnoredPath('/repo/.next/static/i.js')).toBe(false);
        expect(isHardIgnoredPath('/repo/src/i.tsx')).toBe(false);
    });
});

describe('isCompilePackageOptedIn', () => {
    it('matches the package name as a /packages/ path segment', () => {
        expect(isCompilePackageOptedIn('/repo/packages/vui/x.tsx', ['vui'])).toBe(true);
        expect(isCompilePackageOptedIn('/repo/packages/app/x.tsx', ['vui'])).toBe(false);
    });

    it('never opts in node_modules paths (safety)', () => {
        expect(isCompilePackageOptedIn('/repo/node_modules/x/packages/vui/i.js', ['vui'])).toBe(
            false,
        );
    });

    it('is false for an empty allowlist', () => {
        expect(isCompilePackageOptedIn('/repo/packages/vui/x.tsx', [])).toBe(false);
    });

    it('matches the name as a whole segment, not a prefix or substring', () => {
        // `vui` must not opt in a sibling package whose name merely starts with
        // or contains it — the `/<name>/` delimiters guard against that.
        expect(isCompilePackageOptedIn('/repo/packages/vui-core/x.tsx', ['vui'])).toBe(false);
        expect(isCompilePackageOptedIn('/repo/packages/my-vui/x.tsx', ['vui'])).toBe(false);
        expect(isCompilePackageOptedIn('/repo/packages/vui/x.tsx', ['vui'])).toBe(true);
    });

    it('requires the name under a packages/ dir, not any path segment', () => {
        expect(isCompilePackageOptedIn('/repo/apps/vui/x.tsx', ['vui'])).toBe(false);
    });

    it('matches Windows backslash paths', () => {
        expect(isCompilePackageOptedIn('C:\\repo\\packages\\vui\\src\\x.tsx', ['vui'])).toBe(true);
        expect(isCompilePackageOptedIn('C:\\repo\\packages\\app\\x.tsx', ['vui'])).toBe(false);
    });
});

describe('isPackagesSkippedSource', () => {
    it('flags /packages/ source not opted into compilePackages', () => {
        expect(isPackagesSkippedSource('/repo/packages/vui/x.tsx', [])).toBe(true);
        expect(isPackagesSkippedSource('/repo/packages/app/x.tsx', ['vui'])).toBe(true);
    });

    it('does not flag opted-in packages', () => {
        expect(isPackagesSkippedSource('/repo/packages/vui/x.tsx', ['vui'])).toBe(false);
    });

    it('never flags node_modules or .next, or ordinary source', () => {
        expect(isPackagesSkippedSource('/repo/node_modules/x/i.js', [])).toBe(false);
        expect(isPackagesSkippedSource('/repo/.next/server/i.js', [])).toBe(false);
        expect(isPackagesSkippedSource('/repo/src/app.tsx', [])).toBe(false);
    });
});

describe('resolveCompilePackageDirs', () => {
    // A monorepo where the build cwd is apps/web and the design system is a
    // sibling at packages/vui — the exact layout the prescan must reach.
    const exists = (dirs: string[]) => (d: string) => dirs.includes(d.replace(/\\/g, '/'));

    it('resolves a sibling package dir by walking up from rootDir', () => {
        const got = resolveCompilePackageDirs(
            '/repo/apps/web',
            ['vui'],
            exists(['/repo/packages/vui']),
        );
        expect(got).toEqual(['/repo/packages/vui']);
    });

    it('returns empty when compilePackages is unset', () => {
        expect(
            resolveCompilePackageDirs('/repo/apps/web', [], exists(['/repo/packages/vui'])),
        ).toEqual([]);
    });

    it('skips a package that lives inside rootDir (the rootDir walk covers it)', () => {
        // rootDir is the repo root; packages/vui is under it → not returned.
        expect(resolveCompilePackageDirs('/repo', ['vui'], exists(['/repo/packages/vui']))).toEqual(
            [],
        );
    });

    it('ignores a name whose directory does not exist (typo → no dir)', () => {
        expect(resolveCompilePackageDirs('/repo/apps/web', ['typo'], exists([]))).toEqual([]);
    });

    it('resolves multiple packages, deduped', () => {
        const got = resolveCompilePackageDirs(
            '/repo/apps/web',
            ['vui', 'icons'],
            exists(['/repo/packages/vui', '/repo/packages/icons']),
        );
        expect(got.sort()).toEqual(['/repo/packages/icons', '/repo/packages/vui']);
    });

    it('prefers the nearest ancestor when packages/<name> exists at two levels', () => {
        // Nearer ancestor wins (found first on the upward walk), and the farther
        // duplicate is not added again.
        const got = resolveCompilePackageDirs(
            '/repo/apps/web/sub',
            ['vui'],
            exists(['/repo/apps/web/packages/vui', '/repo/packages/vui']),
        );
        expect(got).toEqual(['/repo/apps/web/packages/vui']);
    });
});

describe('skippedSzFilesMessage', () => {
    it('names the count, the files, and the actionable fix', () => {
        const message = skippedSzFilesMessage([
            '/repo/packages/vui/Button.tsx',
            '/repo/packages/vui/Card.tsx',
        ]);
        expect(message).toContain('2 file(s) under packages/');
        expect(message).toContain('/repo/packages/vui/Button.tsx');
        expect(message).toContain('/repo/packages/vui/Card.tsx');
        expect(message).toContain('compilePackages');
        expect(message).toContain('no CSS');
    });
});
