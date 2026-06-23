import { describe, expect, it } from 'vitest';

import {
    fileMayContainSafelistableSz,
    isCompileSourceOptedIn,
    isHardIgnoredPath,
    isPackagesSkippedSource,
    resolveCompileSourceDirs,
    skippedSzFilesMessage,
} from '../src/unplugin.js';

describe('fileMayContainSafelistableSz', () => {
    it('accepts a file with a sz= prop', () => {
        expect(fileMayContainSafelistableSz('const A = () => <div sz={{ p: 4 }} />;')).toBe(true);
    });

    it('accepts a file with a sz: object key (JS-transformed form)', () => {
        expect(fileMayContainSafelistableSz('createElement(C, { sz: { p: 4 } })')).toBe(true);
    });

    it('accepts a szv-only prop-API layout file with NO sz= (the reported gap)', () => {
        const flex = `import { _sz, szv } from '@csszyx/runtime';
            const flexSz = szv({ variants: { justify: { start: { justify: 'start' } } } });
            export const Flex = (p) => <Box className={_sz(flexSz({ justify: p.justify }))} />;`;
        expect(fileMayContainSafelistableSz(flex)).toBe(true);
    });

    it('rejects a file with neither sz nor szv', () => {
        expect(fileMayContainSafelistableSz('export const x = clsx("flex", "p-4");')).toBe(false);
    });

    it('does not treat sx (the runtime style prop) as sz', () => {
        expect(fileMayContainSafelistableSz('<Box sx={{ display: "flex" }} />')).toBe(false);
    });
});

// `compileSources` opts source locations into compilation BY PATH. Matching runs
// per-module (hot path), so it is pure prefix tests on normalized absolute paths;
// the fs work (resolve + realpath) happens once in resolveCompileSourceDirs.

describe('resolveCompileSourceDirs', () => {
    // realpathDir injected: maps an absolute path to its realpath if it "exists",
    // else null. Mirrors fs.realpathSync + isDirectory.
    const realpathOf =
        (map: Record<string, string>) =>
        (p: string): string | null =>
            map[p.replace(/\\/g, '/')] ?? null;

    it('resolves a relative path against root, like a Vite config path', () => {
        const got = resolveCompileSourceDirs(
            '/repo/apps/web',
            ['../../packages/vui'],
            realpathOf({ '/repo/packages/vui': '/repo/packages/vui' }),
        );
        expect(got).toEqual({ dirs: ['/repo/packages/vui'], missing: [] });
    });

    it('passes an absolute path through', () => {
        const got = resolveCompileSourceDirs(
            '/repo/apps/web',
            ['/abs/libs/ui'],
            realpathOf({ '/abs/libs/ui': '/abs/libs/ui' }),
        );
        expect(got.dirs).toEqual(['/abs/libs/ui']);
    });

    it('realpath-resolves a symlinked entry (pnpm) to its real directory', () => {
        const got = resolveCompileSourceDirs(
            '/repo/apps/web',
            ['./node_modules/vui'],
            realpathOf({ '/repo/apps/web/node_modules/vui': '/repo/packages/vui' }),
        );
        expect(got.dirs).toEqual(['/repo/packages/vui']);
    });

    it('reports an entry that does not resolve to a directory as missing', () => {
        const got = resolveCompileSourceDirs('/repo', ['packages/typo'], realpathOf({}));
        expect(got).toEqual({ dirs: [], missing: ['packages/typo'] });
    });

    it('dedups entries that resolve to the same real directory', () => {
        const got = resolveCompileSourceDirs(
            '/repo',
            ['packages/vui', './packages/vui/'],
            realpathOf({ '/repo/packages/vui': '/repo/packages/vui' }),
        );
        expect(got.dirs).toEqual(['/repo/packages/vui']);
    });

    it('normalizes a trailing slash and ./ prefix', () => {
        const got = resolveCompileSourceDirs(
            '/repo',
            ['./libs/ui/'],
            realpathOf({ '/repo/libs/ui': '/repo/libs/ui' }),
        );
        expect(got.dirs).toEqual(['/repo/libs/ui']);
    });

    it('returns empty for no sources', () => {
        expect(resolveCompileSourceDirs('/repo', [], realpathOf({}))).toEqual({
            dirs: [],
            missing: [],
        });
    });
});

describe('isCompileSourceOptedIn', () => {
    const dirs = ['/repo/packages/vui', '/repo/libs/ui'];

    it('opts in a file under a source directory', () => {
        expect(isCompileSourceOptedIn('/repo/packages/vui/src/Button.tsx', dirs)).toBe(true);
        expect(isCompileSourceOptedIn('/repo/libs/ui/x.ts', dirs)).toBe(true);
    });

    it('opts in the directory itself and excludes a prefix-sharing sibling', () => {
        expect(isCompileSourceOptedIn('/repo/packages/vui', dirs)).toBe(true);
        // /repo/packages/vui-core must NOT match /repo/packages/vui (boundary).
        expect(isCompileSourceOptedIn('/repo/packages/vui-core/x.tsx', dirs)).toBe(false);
    });

    it('does not opt in a file outside every source directory', () => {
        expect(isCompileSourceOptedIn('/repo/packages/other/x.tsx', dirs)).toBe(false);
        expect(isCompileSourceOptedIn('/repo/apps/web/x.tsx', dirs)).toBe(false);
    });

    it('matches Windows backslash ids', () => {
        expect(
            isCompileSourceOptedIn('C:\\repo\\packages\\vui\\x.tsx', ['C:/repo/packages/vui']),
        ).toBe(true);
    });

    it('is false for an empty source list', () => {
        expect(isCompileSourceOptedIn('/repo/packages/vui/x.tsx', [])).toBe(false);
    });
});

describe('isHardIgnoredPath', () => {
    const vui = ['/repo/packages/vui'];

    it('relaxes a /packages/ file under an opted-in source dir', () => {
        expect(isHardIgnoredPath('/repo/packages/vui/src/Button.tsx', vui)).toBe(false);
    });

    it('still ignores /packages/ source not under any source dir', () => {
        expect(isHardIgnoredPath('/repo/packages/vui/src/Button.tsx', [])).toBe(true);
        expect(isHardIgnoredPath('/repo/packages/other/x.tsx', vui)).toBe(true);
    });

    it('compiles a non-packages sibling lib WITHOUT opt-in (not hard-ignored)', () => {
        // The reported gap: a shared lib outside /packages/ is not ignored at all.
        expect(isHardIgnoredPath('/repo/libs/vui/src/Flex.tsx', [])).toBe(false);
    });

    it('lets an explicit opt-in win over the node_modules ignore', () => {
        expect(isHardIgnoredPath('/repo/node_modules/vui/i.js', ['/repo/node_modules/vui'])).toBe(
            false,
        );
        expect(isHardIgnoredPath('/repo/node_modules/other/i.js', ['/repo/node_modules/vui'])).toBe(
            true,
        );
    });

    it('keeps .next ignored except its static assets', () => {
        expect(isHardIgnoredPath('/repo/.next/server/page.js', vui)).toBe(true);
        expect(isHardIgnoredPath('/repo/.next/static/chunk.js', [])).toBe(false);
    });

    it('does not ignore ordinary app source', () => {
        expect(isHardIgnoredPath('/repo/src/app.tsx', vui)).toBe(false);
    });

    it('matches the default ignores when no sources are configured', () => {
        expect(isHardIgnoredPath('/repo/node_modules/a/i.js')).toBe(true);
        expect(isHardIgnoredPath('/repo/packages/a/i.tsx')).toBe(true);
        expect(isHardIgnoredPath('/repo/.next/server/i.js')).toBe(true);
        expect(isHardIgnoredPath('/repo/.next/static/i.js')).toBe(false);
        expect(isHardIgnoredPath('/repo/src/i.tsx')).toBe(false);
    });

    it('relaxes an opted-in package on Windows backslash paths', () => {
        expect(
            isHardIgnoredPath('C:\\repo\\packages\\vui\\src\\Button.tsx', ['C:/repo/packages/vui']),
        ).toBe(false);
        expect(isHardIgnoredPath('C:\\repo\\packages\\vui\\src\\Button.tsx', [])).toBe(true);
    });
});

describe('isPackagesSkippedSource', () => {
    it('flags /packages/ source not under any source dir', () => {
        expect(isPackagesSkippedSource('/repo/packages/vui/x.tsx', [])).toBe(true);
        expect(isPackagesSkippedSource('/repo/packages/app/x.tsx', ['/repo/packages/vui'])).toBe(
            true,
        );
    });

    it('does not flag an opted-in package', () => {
        expect(isPackagesSkippedSource('/repo/packages/vui/x.tsx', ['/repo/packages/vui'])).toBe(
            false,
        );
    });

    it('never flags node_modules, .next, ordinary source, or a non-packages lib', () => {
        expect(isPackagesSkippedSource('/repo/node_modules/x/i.js', [])).toBe(false);
        expect(isPackagesSkippedSource('/repo/.next/server/i.js', [])).toBe(false);
        expect(isPackagesSkippedSource('/repo/src/app.tsx', [])).toBe(false);
        // a non-packages sibling lib is compiled, not "skipped" — no warning.
        expect(isPackagesSkippedSource('/repo/libs/vui/x.tsx', [])).toBe(false);
    });
});

describe('skippedSzFilesMessage', () => {
    it('names the count, the files, and the compileSources fix', () => {
        const message = skippedSzFilesMessage([
            '/repo/packages/vui/Button.tsx',
            '/repo/packages/vui/Card.tsx',
        ]);
        expect(message).toContain('2 file(s) under packages/');
        expect(message).toContain('/repo/packages/vui/Button.tsx');
        expect(message).toContain('compileSources');
        expect(message).toContain('no CSS');
    });
});
