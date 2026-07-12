/**
 * The Next source transformer's oxc failure handling: fail hard when
 * `allowBabelFallback` is disabled, fall back to Babel otherwise (recording a
 * `babel-fallback` producer so a cache with a live cacheRoot reports `miss`
 * rather than `write`), and stringify a non-Error thrown by the parser.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@csszyx/compiler', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler')>();
    return { ...actual, transformOxc: vi.fn() };
});

const { transformOxc } = await import('@csszyx/compiler');
const { transformNextSource } = await import('../src/next-source-transformer.js');
const { resolveTransformCacheDir } = await import('../src/transform-cache.js');

const tempDirs: string[] = [];
const PLUGIN_VERSION = packageVersion('../package.json');
const COMPILER_VERSION = packageVersion('../../compiler/package.json');

function packageVersion(packageJsonPath: string): string {
    const packageJson = JSON.parse(
        readFileSync(new URL(packageJsonPath, import.meta.url), 'utf8'),
    ) as { version: string };
    return packageJson.version;
}

function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-next-fallback-'));
    tempDirs.push(dir);
    return dir;
}

function base(overrides: Partial<Parameters<typeof transformNextSource>[0]> = {}) {
    return {
        source: 'const App=()=> <div sz={{ p: 4 }} />;',
        filename: '/repo/src/App.tsx',
        parserMode: 'oxc' as const,
        pluginVersion: PLUGIN_VERSION,
        compilerVersion: COMPILER_VERSION,
        ...overrides,
    };
}

beforeEach(() => {
    vi.mocked(transformOxc).mockReset();
});

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Next source transformer oxc failure handling', () => {
    it('falls back to Babel and reports a cache miss (fallback producer is not cached)', () => {
        vi.mocked(transformOxc).mockImplementation(() => {
            throw new Error('mock oxc failure');
        });
        const root = tempRoot();
        const cacheRoot = resolveTransformCacheDir(root);
        const result = transformNextSource(base({ cacheRoot, filename: join(root, 'App.tsx') }));

        expect(result.producer).toBe('babel-fallback');
        // producer !== parserMode('oxc') → not written → cacheStatus is 'miss'
        expect(result.cacheStatus).toBe('miss');
        expect(result.result.diagnostics.join('\n')).toContain('oxc parser fell back to Babel');
        expect(result.result.code).toContain('className="p-4"');
    });

    it('rethrows the oxc error when allowBabelFallback is disabled', () => {
        vi.mocked(transformOxc).mockImplementation(() => {
            throw new Error('mock oxc failure hard');
        });
        expect(() => transformNextSource(base({ allowBabelFallback: false }))).toThrow(
            'mock oxc failure hard',
        );
    });

    it('stringifies a non-Error thrown by oxc in the fallback diagnostic', () => {
        vi.mocked(transformOxc).mockImplementation(() => {
            throw 'plain string failure';
        });
        const result = transformNextSource(base());
        expect(result.producer).toBe('babel-fallback');
        expect(result.result.diagnostics.join('\n')).toContain('plain string failure');
    });
});
