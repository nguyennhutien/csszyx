import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { transformWasm } from '@csszyx/compiler/engine';
import {
    diagnosticFileOf,
    renderEngineDiagnostic,
    transformWasmUnrendered,
} from '@csszyx/compiler/internal';
import { loadCandidateScanner } from '@csszyx/tailwind-oracle';
import { afterEach, describe, expect, it } from 'vitest';
import { emittedClassSites } from '../src/dead-class.js';
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
    configResolved?: (config: { root: string }) => Promise<void>;
    transform: (this: { warn: (message: string) => void }, code: string, id: string) => unknown;
};

const tempDirs: string[] = [];

/**
 * Where an entry lives in the cache root.
 *
 * @param cacheRoot - The transform cache directory.
 * @param key - The entry's key.
 * @returns The entry's path.
 */
function entryFile(cacheRoot: string, key: string): string {
    return join(cacheRoot, `${key}.json`);
}
/** The repository root, whose Tailwind the scanner loads from. */
const REPO = resolve(import.meta.dirname, '../../..');
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

    it("keeps its entries out of Tailwind's scan of the project", () => {
        // Tailwind scans every file it is not told to ignore. Read as a
        // source, an entry doubled the files of an 800-module app and kept a
        // class deleted from the code in the CSS until the entry aged out.
        const root = tempRoot();
        mkdirSync(join(root, 'src'));
        writeFileSync(join(root, 'src/App.tsx'), 'export const A = () => <b className="p-3" />;\n');
        const cacheRoot = resolveTransformCacheDir(root);
        writeTransformCache(cacheRoot, input(), {
            ...result(),
            code: 'const App=()=> <div className="bg-lime-700" />;',
        });

        expect(readFileSync(join(cacheRoot, '.gitignore'), 'utf8')).toBe('*\n');
        const scan = loadCandidateScanner(REPO);
        if (scan === null) throw new Error('expected a scanner');
        const found = scan([{ base: root, pattern: '**/*', negated: false }]);
        expect(found).toContain('p-3');
        expect(found).not.toContain('bg-lime-700');
    });

    it('leaves an ignore file it finds in the cache as it was', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        mkdirSync(cacheRoot, { recursive: true });
        writeFileSync(join(cacheRoot, '.gitignore'), '*.json\n');
        writeTransformCache(cacheRoot, input(), result());

        expect(readFileSync(join(cacheRoot, '.gitignore'), 'utf8')).toBe('*.json\n');
        expect(readTransformCache(cacheRoot, input())?.code).toBe(result().code);
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

    it('keeps the code and place of each diagnostic and merge group', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        const spanned: CacheableTransformResult = {
            ...result(),
            diagnostics: ['[csszyx] Unknown property "xyzzy"'],
            issues: [{ code: 'unknown-key', line: 3, column: 7 }],
            mergeGroups: [
                {
                    keys: ['pb', 'p'],
                    positions: [
                        { line: 2, column: 5 },
                        { line: 3, column: 5 },
                    ],
                    classes: ['pb-2', 'p-4'],
                },
            ],
            mergeOverrides: [{ line: 4, column: 9, base: ['pb-2'], over: ['p-4'] }],
        };
        writeTransformCache(cacheRoot, input(), spanned);

        const cached = readTransformCache(cacheRoot, input());

        expect(cached?.issues).toEqual(spanned.issues);
        expect(cached?.mergeGroups).toEqual(spanned.mergeGroups);
        expect(cached?.mergeOverrides).toEqual(spanned.mergeOverrides);
    });

    it('stores where an engine placed each span as a byte offset, and reads it back in place', () => {
        // A line and column per class grew an entry by ~45% and resolved every
        // position at write time, undoing the lazy line index. The offset is
        // what the engine reported; the source is at hand when the entry is read.
        const source = [
            'export const A = () => (',
            '    <div className="pb-2" sz={{ pb: 2,',
            "        p: 4, xyzzy: 'é' }} />);",
        ].join('\n');
        const engine = transformWasm(source, '/repo/src/App.tsx');
        expect(engine.issues).toHaveLength(1);
        expect(engine.mergeGroups).toHaveLength(1);
        expect(engine.mergeOverrides).toHaveLength(1);
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        const spannedInput = input({ source });
        writeTransformCache(cacheRoot, spannedInput, { ...result(), ...engine });

        const { key } = createTransformCacheKey(spannedInput);
        const stored = JSON.parse(readFileSync(entryFile(cacheRoot, key), 'utf8')) as {
            result: Record<string, unknown>;
        };
        expect(JSON.stringify(stored.result)).not.toMatch(/"line"|"column"|"positions"/);
        expect(stored.result.issues).toEqual([
            // The args travel with the offset, so a cache hit reads the key back.
            { code: 'unknown-key', start: source.indexOf('xyzzy'), args: { key: 'xyzzy' } },
        ]);

        const cached = readTransformCache(cacheRoot, spannedInput);
        // Compared as JSON, which reads each position: `toEqual` sees only
        // own fields, and a position's line and column are accessors.
        expect(JSON.stringify(cached?.issues)).toBe(JSON.stringify(engine.issues));
        expect(JSON.stringify(cached?.mergeGroups)).toBe(JSON.stringify(engine.mergeGroups));
        expect(JSON.stringify(cached?.mergeOverrides)).toBe(JSON.stringify(engine.mergeOverrides));
        expect(cached?.issues?.[0]?.line).toBe(3);
    });

    it('keeps where each one-class object is written, so a cache hit still places its dead class', () => {
        const source = [
            "export const A = () => <div sz={{ break: 'bogus', p: 4 }} />;",
            "export const B = () => <div sz={{ justify: 'safe-center' }} />;",
        ].join('\n');
        const engine = transformWasm(source, '/repo/src/App.tsx');
        expect(engine.singleClassGroups).toHaveLength(1);
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        const spannedInput = input({ source });
        writeTransformCache(cacheRoot, spannedInput, { ...result(), ...engine });

        const { key } = createTransformCacheKey(spannedInput);
        const stored = JSON.parse(readFileSync(entryFile(cacheRoot, key), 'utf8')) as {
            result: Record<string, unknown>;
        };
        expect(stored.result.singleClassGroups).toEqual([
            {
                keys: ['justify'],
                keyStarts: [Buffer.byteLength(source.slice(0, source.indexOf('justify')))],
                classes: ['justify-safe-center'],
            },
        ]);

        const cached = readTransformCache(cacheRoot, spannedInput);
        expect(JSON.stringify(cached?.singleClassGroups)).toBe(
            JSON.stringify(engine.singleClassGroups),
        );
        expect(
            emittedClassSites(cached as CacheableTransformResult).get('justify-safe-center'),
        ).toEqual({
            line: 2,
            column: 'export const B = () => <div sz={{ '.length + 1,
            key: 'justify',
        });
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

    it('writes each entry atomically, straight into the cache root', () => {
        // A directory per key prefix made a cold 800-file build create 256 of
        // them: 33.6 ms of writes, against 17.3 ms for the same files flat.
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        writeTransformCache(cacheRoot, input(), result());

        const { key } = createTransformCacheKey(input());
        expect(readdirSync(cacheRoot).sort()).toEqual(['.gitignore', `${key}.json`]);
        const content = readFileSync(entryFile(cacheRoot, key), 'utf8');

        expect(content).toContain('"version":22');
        expect(readTransformCache(cacheRoot, input())).not.toBeNull();
    });

    it('keeps an unrendered result unrendered: no message text, the issues and their file', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        const source = "export const A = () => <div sz={{ workBreak: 'all' }} />;\n";
        const keyInput = input({ source, filename: '/repo/src/A.tsx' });
        const lazy = transformWasmUnrendered(source, '/repo/src/A.tsx', { rootDir: '/repo' });
        writeTransformCache(cacheRoot, keyInput, lazy);

        const { key } = createTransformCacheKey(keyInput);
        const entry = JSON.parse(readFileSync(entryFile(cacheRoot, key), 'utf8')) as {
            result: { diagnostics: string[]; diagnosticFile?: string };
        };
        expect(entry.result.diagnostics).toEqual([]);
        expect(entry.result.diagnosticFile).toBe('src/A.tsx');

        const cached = readTransformCache(cacheRoot, keyInput);
        expect(cached?.diagnostics).toEqual([]);
        const file = diagnosticFileOf(cached as CacheableTransformResult) as string;
        expect(cached?.issues?.map(issue => renderEngineDiagnostic(issue, file))).toEqual(
            transformWasm(source, '/repo/src/A.tsx', { rootDir: '/repo' }).diagnostics,
        );
    });

    it('rejects an entry written under an older cache schema', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        writeTransformCache(cacheRoot, input(), result());

        const { key } = createTransformCacheKey(input());
        const file = entryFile(cacheRoot, key);
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

    it('keys entries on the Tailwind prefix, reading no prefix and null as the same', () => {
        const bare = createTransformCacheKey(input());
        expect(createTransformCacheKey(input({ classPrefix: 'tw' })).key).not.toBe(bare.key);
        expect(createTransformCacheKey(input({ classPrefix: 'ui' })).key).not.toBe(
            createTransformCacheKey(input({ classPrefix: 'tw' })).key,
        );
        expect(createTransformCacheKey(input({ classPrefix: null })).key).toBe(bare.key);
    });

    it('serves an entry only to a transform asking for the same prefix', () => {
        const cacheRoot = tempRoot();
        writeTransformCache(cacheRoot, input({ classPrefix: 'tw' }), result());

        expect(readTransformCache(cacheRoot, input({ classPrefix: 'tw' }))).not.toBeNull();
        expect(readTransformCache(cacheRoot, input())).toBeNull();
        expect(readTransformCache(cacheRoot, input({ classPrefix: 'ui' }))).toBeNull();
    });

    it('rejects an entry whose recorded prefix is not the one asked for', () => {
        // The file name is derived from the prefix, so only a hand-edited or
        // colliding entry reaches this check; it still has to refuse.
        const cacheRoot = tempRoot();
        const asked = input({ classPrefix: 'tw' });
        writeTransformCache(cacheRoot, asked, result());
        const { key } = createTransformCacheKey(asked);
        const file = entryFile(cacheRoot, key);
        const entry = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        entry.classPrefix = 'ui';
        writeFileSync(file, JSON.stringify(entry));

        expect(readTransformCache(cacheRoot, asked)).toBeNull();
    });

    it('evicts old or corrupt entries', () => {
        const cacheRoot = resolveTransformCacheDir(tempRoot());
        writeTransformCache(cacheRoot, input(), result());
        const { key } = createTransformCacheKey(input());
        const file = entryFile(cacheRoot, key);
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
            const file = entryFile(cacheRoot, key);
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

    it('plugin wiring writes cache entries by default', async () => {
        const root = tempRoot();
        // Pinned to wasm so this test stays valid in environments without the
        // optional Rust native addon. The cache-wiring assertion does not
        // depend on which parser produced the entry.
        const [prePlugin] = vitePlugin({ build: { parser: 'wasm' } }) as TransformHook[];
        await prePlugin.configResolved?.({ root });

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

    it('plugin wiring bypasses cache when build.cache is false', async () => {
        const root = tempRoot();
        const [prePlugin] = vitePlugin({ build: { cache: false } }) as TransformHook[];
        await prePlugin.configResolved?.({ root });

        prePlugin.transform.call(
            { warn: () => undefined },
            'const App=()=> <div sz={{ p: 4 }} />;',
            join(root, 'src/App.tsx'),
        );

        expect(existsSync(resolveTransformCacheDir(root))).toBe(false);
    });

    it('plugin wiring reuses the in-memory transform cache before disk reads', async () => {
        const root = tempRoot();
        const [prePlugin] = vitePlugin() as TransformHook[];
        await prePlugin.configResolved?.({ root });

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
