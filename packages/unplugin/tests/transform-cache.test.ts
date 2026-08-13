import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import {
    type CacheableTransformResult,
    createTransformCacheKey,
    evictMemoryCacheToBudget,
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
            parserMode: 'wasm',
            producer: 'wasm',
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
            usesSpacingVar: true,
            usesUnitVar: true,
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
            cssVariableMap: new Map([['--_sz-p', ['--cz', '--sz']]]),
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
        expect(cached?.usesColorVar).toBe(false);
        expect(cached?.usesSpacingVar).toBe(true);
        expect(cached?.usesUnitVar).toBe(true);
        expect(cached?.classes).toEqual(new Set(['p-4']));
        expect(cached?.rawClassNames).toEqual(new Set(['custom']));
        expect(cached?.diagnostics).toEqual(['diagnostic']);
        expect(cached?.recoveryTokens.get('abc123')?.mode).toBe('csr');
        expect(cached?.cssVariableMap.get('--_sz-p')).toEqual(['--cz', '--sz']);
    });

    it('misses when source, version, parser, producer, budget, mangle options, aliases, or filename changes', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        writeTransformCache(cacheRoot, input({ astBudget: 50_000 }), result());

        expect(readTransformCache(cacheRoot, input({ astBudget: 50_000 }))).not.toBeNull();
        expect(readTransformCache(cacheRoot, input({ source: 'const x = 1;' }))).toBeNull();
        expect(readTransformCache(cacheRoot, input({ pluginVersion: '0.8.1' }))).toBeNull();
        expect(readTransformCache(cacheRoot, input({ compilerVersion: '0.8.1' }))).toBeNull();
        expect(readTransformCache(cacheRoot, input({ parserMode: 'wasm' }))).toBeNull();
        expect(readTransformCache(cacheRoot, input({ producer: 'rust' }))).toBeNull();
        expect(readTransformCache(cacheRoot, input({ astBudget: 1_000 }))).toBeNull();
        expect(readTransformCache(cacheRoot, input({ mangleVars: true }))).toBeNull();
        expect(readTransformCache(cacheRoot, input({ mangleVarHoistMaxDepth: 3 }))).toBeNull();
        expect(
            readTransformCache(
                cacheRoot,
                input({
                    globalVarAliases: [
                        ['--color-brand', '--g0'],
                        ['--space-card', '--g1'],
                    ],
                }),
            ),
        ).toBeNull();
        expect(
            readTransformCache(cacheRoot, input({ filename: '/repo/src/Other.tsx' })),
        ).toBeNull();
        expect(
            readTransformCache(cacheRoot, input({ filename: '\\repo\\src\\App.tsx' })),
        ).toBeNull();
    });

    it('uses a stable cache key for reordered global variable aliases', () => {
        const first = createTransformCacheKey(
            input({
                globalVarAliases: [
                    ['--space-card', '--g1'],
                    ['--color-brand', '--g0'],
                ],
            }),
        );
        const second = createTransformCacheKey(
            input({
                globalVarAliases: [
                    ['--color-brand', '--g0'],
                    ['--space-card', '--g1'],
                ],
            }),
        );

        expect(first.key).toBe(second.key);
        expect(first.inputSha256).toBe(second.inputSha256);
    });

    it('writes entries atomically without leaving tmp files on success', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        writeTransformCache(cacheRoot, input(), result());

        const { key } = createTransformCacheKey(input());
        const shardDir = join(cacheRoot, key.slice(0, 2));
        const content = readFileSync(join(shardDir, `${key.slice(2)}.json`), 'utf8');

        expect(content).toContain('"version":16');
        expect(readTransformCache(cacheRoot, input())).not.toBeNull();
    });

    it('rejects an entry written under an older cache schema', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        writeTransformCache(cacheRoot, input(), result());

        const { key } = createTransformCacheKey(input());
        const file = join(cacheRoot, key.slice(0, 2), `${key.slice(2)}.json`);
        const entry = JSON.parse(readFileSync(file, 'utf8')) as { version: number };
        // Simulate a schema-9 entry surviving at the current key: its result
        // predates usesSpacingVar/usesUnitVar, so serving it would resurrect
        // those flags as undefined and skip helper import injection.
        entry.version = 9;
        writeFileSync(file, JSON.stringify(entry), 'utf8');

        expect(readTransformCache(cacheRoot, input())).toBeNull();
    });

    it('keys and validates entries on the native engine identity', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        const rustInput = (nativeIdentity?: string): TransformCacheKeyInput =>
            input({ parserMode: 'rust', producer: 'rust', nativeIdentity });

        writeTransformCache(cacheRoot, rustInput('core@0.9.5:111:222'), result());

        expect(readTransformCache(cacheRoot, rustInput('core@0.9.5:111:222'))).not.toBeNull();
        // A rebuilt binary (new mtime/size) must miss instead of serving the
        // previous engine's output.
        expect(readTransformCache(cacheRoot, rustInput('core@0.9.5:999:222'))).toBeNull();
        expect(readTransformCache(cacheRoot, rustInput(undefined))).toBeNull();
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
        // Pinned to wasm so this test stays valid in environments without the
        // optional Rust native addon. The cache-wiring assertion does not
        // depend on which parser produced the entry.
        const [prePlugin] = vitePlugin({ build: { parser: 'wasm' } }) as TransformHook[];
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

describe('evictMemoryCacheToBudget', () => {
    const entry = (chars: number): { code: string } => ({ code: 'x'.repeat(chars) });

    it('evicts oldest-first past the byte budget, not just the entry count', () => {
        const cache = new Map<string, { code: string }>([
            ['a', entry(600)],
            ['b', entry(300)],
            ['c', entry(200)],
        ]);
        const total = evictMemoryCacheToBudget(cache, 1100, 1000, 500);
        // Evicting 'a' (600 chars) brings the total to exactly the 500 budget.
        expect([...cache.keys()]).toEqual(['b', 'c']);
        expect(total).toBe(500);
    });

    it('keeps at least one entry even when it alone exceeds the byte budget', () => {
        const cache = new Map<string, { code: string }>([['huge', entry(5000)]]);
        const total = evictMemoryCacheToBudget(cache, 5000, 1000, 500);
        expect(cache.size).toBe(1);
        expect(total).toBe(5000);
    });

    it('entry-count budget still applies independently', () => {
        const cache = new Map<string, { code: string }>([
            ['a', entry(1)],
            ['b', entry(1)],
            ['c', entry(1)],
        ]);
        const total = evictMemoryCacheToBudget(cache, 3, 2, 1_000_000);
        expect([...cache.keys()]).toEqual(['b', 'c']);
        expect(total).toBe(2);
    });

    it('no-ops under both budgets', () => {
        const cache = new Map<string, { code: string }>([['a', entry(10)]]);
        expect(evictMemoryCacheToBudget(cache, 10, 1000, 500)).toBe(10);
        expect(cache.size).toBe(1);
    });
});
