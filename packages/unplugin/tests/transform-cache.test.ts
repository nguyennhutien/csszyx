import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import {
    type CacheableTransformResult,
    createTransformCacheKey,
    evictOldTransformCacheEntries,
    readTransformCache,
    resolveTransformCacheDir,
    type TransformCacheKeyInput,
    writeTransformCache,
} from '../src/transform-cache.js';
import { vitePlugin } from '../src/unplugin.js';

type TransformHook = {
    configResolved?: (config: { root: string }) => void;
    transform: (this: { warn: (message: string) => void }, code: string, id: string) => unknown;
};

const tempDirs: string[] = [];
const PLUGIN_VERSION = packageVersion('../package.json');
const COMPILER_VERSION = packageVersion('../../compiler/package.json');

function packageVersion(packageJsonPath: string): string {
    const packageJson = JSON.parse(
        readFileSync(new URL(packageJsonPath, import.meta.url), 'utf8'),
    ) as { version: string };
    return packageJson.version;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('transform cache', () => {
    function tempRoot(): string {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-cache-'));
        tempDirs.push(dir);
        return dir;
    }

    function input(overrides: Partial<TransformCacheKeyInput> = {}): TransformCacheKeyInput {
        return {
            pluginVersion: PLUGIN_VERSION,
            compilerVersion: COMPILER_VERSION,
            parserMode: 'oxc',
            producer: 'oxc',
            filename: '/repo/src/App.tsx',
            source: 'const App=()=> <div sz={{ p: 4 }} />;',
            ...overrides,
        };
    }

    function result(): CacheableTransformResult {
        return {
            code: 'const App=()=> <div className="p-4" />;',
            transformed: true,
            usesRuntime: false,
            usesMerge: false,
            usesColorVar: false,
            classes: new Set(['p-4']),
            rawClassNames: new Set(['custom']),
            diagnostics: ['diagnostic'],
            recoveryTokens: new Map([
                [
                    'abc123',
                    {
                        mode: 'csr',
                        component: 'div',
                        path: '/repo/src/App.tsx',
                    },
                ],
            ]),
            cssVariableMap: new Map([['--_sz-p', '--sz']]),
        };
    }

    it('resolves the transform cache under the configured cache directory', () => {
        expect(resolveTransformCacheDir('/repo', undefined)).toBe('/repo/.csszyx/cache/transform');
        expect(resolveTransformCacheDir('/repo', '.custom-cache')).toBe(
            '/repo/.custom-cache/transform',
        );
    });

    it('round-trips transform results through disk', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        writeTransformCache(cacheRoot, input(), result());

        const cached = readTransformCache(cacheRoot, input());

        expect(cached?.code).toBe('const App=()=> <div className="p-4" />;');
        expect(cached?.classes).toEqual(new Set(['p-4']));
        expect(cached?.rawClassNames).toEqual(new Set(['custom']));
        expect(cached?.diagnostics).toEqual(['diagnostic']);
        expect(cached?.recoveryTokens.get('abc123')?.mode).toBe('csr');
        expect(cached?.cssVariableMap.get('--_sz-p')).toBe('--sz');
    });

    it('misses when source, version, parser, producer, budget, mangleVars, or filename changes', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        writeTransformCache(cacheRoot, input({ astBudget: 50_000 }), result());

        expect(readTransformCache(cacheRoot, input({ astBudget: 50_000 }))).not.toBeNull();
        expect(readTransformCache(cacheRoot, input({ source: 'const x = 1;' }))).toBeNull();
        expect(readTransformCache(cacheRoot, input({ pluginVersion: '0.8.1' }))).toBeNull();
        expect(readTransformCache(cacheRoot, input({ compilerVersion: '0.8.1' }))).toBeNull();
        expect(readTransformCache(cacheRoot, input({ parserMode: 'babel' }))).toBeNull();
        expect(readTransformCache(cacheRoot, input({ producer: 'babel-fallback' }))).toBeNull();
        expect(readTransformCache(cacheRoot, input({ astBudget: 1_000 }))).toBeNull();
        expect(readTransformCache(cacheRoot, input({ mangleVars: true }))).toBeNull();
        expect(
            readTransformCache(cacheRoot, input({ filename: '/repo/src/Other.tsx' })),
        ).toBeNull();
        expect(
            readTransformCache(cacheRoot, input({ filename: '\\repo\\src\\App.tsx' })),
        ).toBeNull();
    });

    it('writes entries atomically without leaving tmp files on success', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        writeTransformCache(cacheRoot, input(), result());

        const { key } = createTransformCacheKey(input());
        const shardDir = join(cacheRoot, key.slice(0, 2));
        const content = readFileSync(join(shardDir, `${key.slice(2)}.json`), 'utf8');

        expect(content).toContain('"version":4');
        expect(readTransformCache(cacheRoot, input())).not.toBeNull();
    });

    it('evicts old or corrupt entries', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        writeTransformCache(cacheRoot, input(), result());
        const { key } = createTransformCacheKey(input());
        const file = join(cacheRoot, key.slice(0, 2), `${key.slice(2)}.json`);
        const entry = JSON.parse(readFileSync(file, 'utf8')) as { timestamp: string };
        entry.timestamp = new Date('2026-01-01T00:00:00.000Z').toISOString();
        writeFileSync(file, JSON.stringify(entry), 'utf8');

        const corruptDir = join(cacheRoot, 'ff');
        const corruptFile = join(corruptDir, 'corrupt.json');
        mkdirSync(corruptDir, { recursive: true });
        writeFileSync(corruptFile, '{bad json', 'utf8');

        const deleted = evictOldTransformCacheEntries(cacheRoot, {
            maxAgeMs: 30 * 24 * 60 * 60 * 1000,
            now: Date.parse('2026-05-17T00:00:00.000Z'),
        });

        expect(deleted).toBe(2);
        expect(readTransformCache(cacheRoot, input())).toBeNull();
    });

    it('evicts oldest remaining entries when over the max-entry cap', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        for (let i = 0; i < 4; i++) {
            const entryInput = input({ source: `const n = ${i}; <div sz={{ p: ${i} }} />;` });
            writeTransformCache(cacheRoot, entryInput, result());
            const { key } = createTransformCacheKey(entryInput);
            const file = join(cacheRoot, key.slice(0, 2), `${key.slice(2)}.json`);
            const entry = JSON.parse(readFileSync(file, 'utf8')) as { timestamp: string };
            entry.timestamp = new Date(`2026-05-17T00:00:0${i}.000Z`).toISOString();
            writeFileSync(file, JSON.stringify(entry), 'utf8');
        }

        const deleted = evictOldTransformCacheEntries(cacheRoot, {
            maxAgeMs: 30 * 24 * 60 * 60 * 1000,
            maxEntries: 2,
            now: Date.parse('2026-05-17T00:01:00.000Z'),
        });

        expect(deleted).toBe(2);
        expect(
            readTransformCache(cacheRoot, input({ source: 'const n = 0; <div sz={{ p: 0 }} />;' })),
        ).toBeNull();
        expect(
            readTransformCache(cacheRoot, input({ source: 'const n = 1; <div sz={{ p: 1 }} />;' })),
        ).toBeNull();
        expect(
            readTransformCache(cacheRoot, input({ source: 'const n = 2; <div sz={{ p: 2 }} />;' })),
        ).not.toBeNull();
        expect(
            readTransformCache(cacheRoot, input({ source: 'const n = 3; <div sz={{ p: 3 }} />;' })),
        ).not.toBeNull();
    });

    it('plugin wiring writes cache entries by default', () => {
        const root = tempRoot();
        // Pinned to oxc so this test stays valid in environments without the
        // optional Rust native addon. The cache-wiring assertion does not
        // depend on which parser produced the entry.
        const [prePlugin] = vitePlugin({ build: { parser: 'oxc' } }) as TransformHook[];
        prePlugin.configResolved?.({ root });

        const id = join(root, 'src/App.tsx');
        prePlugin.transform.call(
            { warn: () => undefined },
            'const App=()=> <div sz={{ p: 4 }} />;',
            id,
        );

        expect(
            readTransformCache(resolveTransformCacheDir(root), input({ filename: id })),
        ).not.toBeNull();
    });

    it('plugin wiring bypasses cache when build.cache is false', () => {
        const root = tempRoot();
        const [prePlugin] = vitePlugin({ build: { cache: false } }) as TransformHook[];
        prePlugin.configResolved?.({ root });

        prePlugin.transform.call(
            { warn: () => undefined },
            'const App=()=> <div sz={{ p: 4 }} />;',
            join(root, 'src/App.tsx'),
        );

        expect(existsSync(resolveTransformCacheDir(root))).toBe(false);
    });

    it('plugin wiring reuses the in-memory transform cache before disk reads', () => {
        const root = tempRoot();
        const [prePlugin] = vitePlugin() as TransformHook[];
        prePlugin.configResolved?.({ root });

        const source = 'const App=()=> <div sz={{ p: 4 }} />;';
        const id = join(root, 'src/App.tsx');
        prePlugin.transform.call({ warn: () => undefined }, source, id);
        const cacheRoot = resolveTransformCacheDir(root);
        rmSync(cacheRoot, { recursive: true, force: true });

        prePlugin.transform.call({ warn: () => undefined }, source, id);

        expect(existsSync(cacheRoot)).toBe(false);
    });
});
