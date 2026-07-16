/**
 * The virtual-module generators/resolvers and the package-version fallback —
 * small build-plumbing helpers with no direct suite of their own.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readPackageVersion } from '../src/next-package-version';
import {
    createChecksumModule,
    createMangleMapModule,
    createThemeGroupsModule,
    isVirtualModule,
    RESOLVED_THEME_GROUPS_VIRTUAL_ID,
    RESOLVED_VIRTUAL_CHECKSUM_ID,
    RESOLVED_VIRTUAL_MODULE_ID,
    resolveVirtualModule,
    THEME_GROUPS_VIRTUAL_ID,
    VIRTUAL_CHECKSUM_ID,
    VIRTUAL_MODULE_ID,
} from '../src/virtual-modules';

describe('readPackageVersion', () => {
    it('reads the real package version relative to a module URL', () => {
        const version = readPackageVersion('../package.json', import.meta.url);
        expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('falls back to 0.0.0 for a missing file or missing version field', () => {
        expect(readPackageVersion('./does-not-exist.json', import.meta.url)).toBe('0.0.0');
        // tsconfig.json parses but has no version string.
        expect(readPackageVersion('../tsconfig.json', import.meta.url)).toBe('0.0.0');
    });
});

describe('virtual module generators', () => {
    it('emits the mangle-map module with maps, metrics and checksum', () => {
        const source = createMangleMapModule({ 'p-4': 'z' }, 'sum', { '--x': 'y' }, null);
        expect(source).toContain('"p-4": "z"');
        expect(source).toContain('"--x": "y"');
        expect(source).toContain('export const checksum = "sum"');
        expect(source).toContain('export default');
    });

    it('emits the checksum-only module', () => {
        expect(createChecksumModule('abc')).toContain('export const checksum = "abc"');
    });

    it('emits the theme-groups module', () => {
        const source = createThemeGroupsModule({} as never);
        expect(source).toContain('export');
    });
});

describe('virtual module resolution', () => {
    it('recognizes exactly the three csszyx virtual ids', () => {
        expect(isVirtualModule(VIRTUAL_MODULE_ID)).toBe(true);
        expect(isVirtualModule(VIRTUAL_CHECKSUM_ID)).toBe(true);
        expect(isVirtualModule(THEME_GROUPS_VIRTUAL_ID)).toBe(true);
        expect(isVirtualModule('virtual:someone-else')).toBe(false);
    });

    it('resolves each id to its \\0-prefixed form and unknown ids to undefined', () => {
        expect(resolveVirtualModule(VIRTUAL_MODULE_ID)).toBe(RESOLVED_VIRTUAL_MODULE_ID);
        expect(resolveVirtualModule(VIRTUAL_CHECKSUM_ID)).toBe(RESOLVED_VIRTUAL_CHECKSUM_ID);
        expect(resolveVirtualModule(THEME_GROUPS_VIRTUAL_ID)).toBe(
            RESOLVED_THEME_GROUPS_VIRTUAL_ID,
        );
        expect(resolveVirtualModule('other')).toBeUndefined();
    });
});

describe('injectNextRuntimeImports remaining helpers', () => {
    it('injects only the missing helpers, including _szPart and __szColorVar', async () => {
        const { injectNextRuntimeImports } = await import('../src/next-runtime-injection');
        const code = "import { _sz } from '@csszyx/runtime';\nexport const x = 1;\n";
        const result = injectNextRuntimeImports(code, {
            usesRuntime: true,
            usesSzPart: true,
            usesColorVar: true,
            usesSpacingVar: true,
            usesUnitVar: true,
        });
        expect(result.injected).toEqual([
            '_szPart',
            '__szColorVar',
            '__szSpacingVar',
            '__szUnitVar',
        ]);
        expect(result.code).toContain(
            "import { _szPart, __szColorVar, __szSpacingVar, __szUnitVar } from '@csszyx/runtime';",
        );
    });

    it('returns the code untouched when every helper is already imported', async () => {
        const { injectNextRuntimeImports } = await import('../src/next-runtime-injection');
        const code = "import { _sz } from '@csszyx/runtime';\nexport const x = 1;\n";
        const result = injectNextRuntimeImports(code, { usesRuntime: true });
        expect(result.injected).toEqual([]);
        expect(result.code).toBe(code);
    });
});

describe('small guard branches', () => {
    it('next prebuild rejects production variable mangling without the escape hatch', async () => {
        const { runNextPrebuild } = await import('../src/next-prebuild');
        expect(() =>
            runNextPrebuild({
                root: resolve('test-fixtures/next-prebuild'),
                patterns: [],
                compilerOptions: { mangleVars: true },
            } as never),
        ).toThrow(/does not support production CSS variable mangling/);
        expect(() =>
            runNextPrebuild({
                root: resolve('test-fixtures/next-prebuild'),
                patterns: [],
                config: { mangleVars: true },
            } as never),
        ).toThrow(/does not support production CSS variable mangling/);
    });

    it('generation manifest validation names each failure', async () => {
        const { validateNextGenerationManifest } = await import('../src/next-generation-manifest');
        expect(validateNextGenerationManifest(null, {} as never).reason).toContain('missing');
        expect(
            validateNextGenerationManifest({ schema: 2 } as never, {} as never).reason,
        ).toContain('unsupported');
        expect(
            validateNextGenerationManifest({ schema: 1, completed: false } as never, {} as never)
                .reason,
        ).toContain('incomplete');
    });

    it('glob translation covers ? and literal characters', async () => {
        const { globToRegExp } = await import('../src/file-patterns');
        const regex = globToRegExp('src/?pp.t+x');
        expect(regex.test('src/app.t+x')).toBe(true);
        expect(regex.test('src/a/pp.t+x')).toBe(false);
    });

    it('expandFilePatterns skips unreadable directories', async () => {
        const { expandFilePatterns } = await import('../src/file-patterns');
        expect(expandFilePatterns('/nonexistent-root-abc123', ['src/**/*.tsx'])).toEqual([]);
    });
});

describe('cache and context path guards', () => {
    it('global-var scan cache rejects a key mismatch', async () => {
        const { readGlobalVarScanCache, writeGlobalVarScanCache } = await import(
            '../src/global-var-cache'
        );
        const os = await import('node:os');
        const fs = await import('node:fs');
        const path = await import('node:path');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-gvc-'));
        try {
            writeGlobalVarScanCache(dir, 'key-a', { entries: [] } as never);
            // Poison: rewrite the entry under a different key on disk.
            const file = fs.readdirSync(dir).find(name => name.endsWith('.json'));
            if (!file) throw new Error('no cache file written');
            fs.writeFileSync(
                path.join(dir, file),
                JSON.stringify({ key: 'other', result: { entries: [] } }),
            );
            expect(readGlobalVarScanCache(dir, 'key-a')).toBeNull();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('state context keeps an out-of-root cache dir absolute', async () => {
        const { createNextStateContext } = await import('../src/next-state-context');
        const context = createNextStateContext({
            explicitRoot: '/repo/apps/web',
            cacheDir: '/var/shared/csszyx-cache',
            config: {},
            nextVersion: 'x',
            csszyxVersion: 'y',
            nativeVersion: 'z',
            mode: 'development',
        });
        expect(context.cacheDir).toBe('/var/shared/csszyx-cache');
    });
});

describe('runtime static-class scan with nested braces', () => {
    it('walks nested objects inside an _sz call to find static fragments', async () => {
        const { collectNextTransformMetadata } = await import('../src/next-transform-metadata');
        const source = 'const A = ({rest}) => <div sz={{ hover: { m: 2 }, gap: 1, ...rest }} />;';
        const { transformSourceCode } = await import('@csszyx/compiler');
        const result = transformSourceCode(source, '/repo/src/A.tsx');
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/A.tsx');
        expect(metadata.classes).toContain('gap-1');
        expect(metadata.classes).toContain('hover:m-2');
    });
});

describe('generation manifest parse rejects malformed content', () => {
    it('throws the invalid-manifest error for a wrong-typed field', async () => {
        const { readNextGenerationManifest } = await import('../src/next-generation-manifest');
        const os = await import('node:os');
        const fs = await import('node:fs');
        const path = await import('node:path');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-gm-'));
        try {
            const manifestPath = path.join(dir, 'generation-manifest.json');
            fs.writeFileSync(
                manifestPath,
                JSON.stringify({
                    schema: 1,
                    root: '/x',
                    mode: 'development',
                    sourceCount: 1,
                    completed: 'yes', // must be boolean
                    createdAt: 'now',
                }),
            );
            expect(readNextGenerationManifest(manifestPath)).toBeNull();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('runtime import scan handles an empty specifier slot', async () => {
        const { injectNextRuntimeImports } = await import('../src/next-runtime-injection');
        const code = "import { _sz, , _szMerge } from '@csszyx/runtime';\nexport const x = 1;\n";
        const result = injectNextRuntimeImports(code, { usesRuntime: true, usesMerge: true });
        expect(result.injected).toEqual([]);
    });
});
