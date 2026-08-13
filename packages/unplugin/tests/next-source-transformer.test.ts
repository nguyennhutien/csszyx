import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { transformNextSource } from '../src/next-source-transformer.js';
import { resolveTransformCacheDir } from '../src/transform-cache.js';

const tempDirs: string[] = [];
const PLUGIN_VERSION = packageVersion('../package.json');
const COMPILER_VERSION = packageVersion('../../compiler/package.json');

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Next source transformer', () => {
    function tempRoot(): string {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-next-transform-'));
        tempDirs.push(dir);
        return dir;
    }

    function input(overrides: Partial<Parameters<typeof transformNextSource>[0]> = {}) {
        return {
            source: 'const App=()=> <div sz={{ p: 4 }} />;',
            filename: '/repo/src/App.tsx',
            parserMode: 'wasm' as const,
            pluginVersion: PLUGIN_VERSION,
            compilerVersion: COMPILER_VERSION,
            ...overrides,
        };
    }

    it('transforms static sz source and reuses cache entries', () => {
        const root = tempRoot();
        const cacheRoot = resolveTransformCacheDir(root);
        const first = transformNextSource(input({ cacheRoot }));
        const second = transformNextSource(input({ cacheRoot }));

        expect(first.cacheStatus).toBe('write');
        expect(first.producer).toBe('wasm');
        expect(first.result.code).toContain('className="p-4"');
        expect(second.cacheStatus).toBe('hit');
        expect(second.result.code).toBe(first.result.code);
    });

    it('returns an untransformed result for source without sz syntax', () => {
        const result = transformNextSource(
            input({
                source: 'const value = "p-4";',
                filename: '/repo/src/plain.ts',
            }),
        );

        expect(result.cacheStatus).toBe('disabled');
        expect(result.result.transformed).toBe(false);
        expect(result.result.code).toBe('const value = "p-4";');
    });

    it('caches supported oxc output without falling back to Babel', () => {
        const root = tempRoot();
        const cacheRoot = resolveTransformCacheDir(root);
        const first = transformNextSource(
            input({
                cacheRoot,
                source: '<div szRecover="csr" sz={{ p: 4 }} />;',
                filename: join(root, 'src/App.tsx'),
            }),
        );
        const rerun = transformNextSource(
            input({
                cacheRoot,
                source: '<div szRecover="csr" sz={{ p: 4 }} />;',
                filename: join(root, 'src/App.tsx'),
            }),
        );

        expect(first.producer).toBe('wasm');
        expect(first.cacheStatus).toBe('write');
        expect(first.result.code).toContain('className="p-4"');
        expect(rerun.cacheStatus).toBe('hit');
    });

    it('fails closed instead of passing through invalid source', () => {
        expect(() =>
            transformNextSource(
                input({
                    parserMode: 'wasm',
                    source: 'const App = <div sz={{ p: 4 }}',
                }),
            ),
        ).toThrow();
    });

    // The fail-closed guard previously tripped on any `sz=` substring,
    // including comments and string literals. The tightened guard strips
    // line/block comments and string literals before the pattern match so
    // benign annotations and payloads do not cause spurious failures.
    it('does not fail closed when sz= appears only inside a line comment', () => {
        const result = transformNextSource(
            input({
                parserMode: 'wasm',
                source: '// TODO: replace inline sz={{ p: 4 }} with a hook\nexport const X = 1;\n',
                filename: '/repo/src/CommentOnly.tsx',
            }),
        );

        expect(result.result.transformed).toBe(false);
        expect(result.result.code).toContain('// TODO');
    });

    it('does not fail closed when sz: appears only inside a block comment', () => {
        const result = transformNextSource(
            input({
                parserMode: 'wasm',
                source: '/* future: sz: { p: 4 } */\nexport const Y = 2;\n',
                filename: '/repo/src/BlockOnly.tsx',
            }),
        );

        expect(result.result.transformed).toBe(false);
        expect(result.result.code).toContain('/* future:');
    });

    it('does not fail closed when sz= appears only inside a string literal', () => {
        const result = transformNextSource(
            input({
                parserMode: 'wasm',
                source: 'export const Z = "sample text sz={{ p: 4 }} not real";\n',
                filename: '/repo/src/StringOnly.tsx',
            }),
        );

        expect(result.result.transformed).toBe(false);
        expect(result.result.code).toContain('sample text');
    });

    it('does not fail closed when sz= appears only inside a regex literal', () => {
        const result = transformNextSource(
            input({
                parserMode: 'wasm',
                source: 'export const hasSzText = /sz={{ p: 4 }}/.test(input);\n',
                filename: '/repo/src/RegexOnly.ts',
            }),
        );

        expect(result.result.transformed).toBe(false);
        expect(result.result.code).toContain('/sz=');
    });

    it('still fails closed when a regex literal appears before real sz syntax', () => {
        expect(() =>
            transformNextSource(
                input({
                    parserMode: 'wasm',
                    source: 'const marker = /sz=/;\nconst App = <div sz={{ p: 4 }}',
                }),
            ),
        ).toThrow();
    });
    it('will not serve a file the output built against a different table', () => {
        // The registry slice a file compiled against is part of its identity.
        // Sharing one key across two tables serves an importer the output built
        // from the value its provider used to have — the failure this lane
        // refused to risk before it resolved anything at all.
        const root = tempRoot();
        const cacheRoot = resolveTransformCacheDir(root, '.csszyx/cache');
        const source = "import { rowSz } from './styles';\nconst A=()=> <div sz={{ p: 4 }} />;";
        const against = (table: unknown) => ({
            ...input({ source }),
            cacheRoot,
            compilerOptions: { crossModuleStatics: table },
        });
        const table = { './styles': { rowSz: { base: { p: 1 } } } };

        // Warm it, then prove the cache is live for an identical call — without
        // this the misses below would prove nothing.
        transformNextSource(against(table));
        expect(transformNextSource(against(table)).cacheStatus).toBe('hit');

        // Same source, same everything else. Only the table differs.
        expect(
            transformNextSource(against({ './styles': { rowSz: { base: { p: 2 } } } })).cacheStatus,
        ).not.toBe('hit');

        // And a run with no table at all is a third identity, not the first.
        expect(transformNextSource({ ...input({ source }), cacheRoot }).cacheStatus).not.toBe(
            'hit',
        );
    });
});

function packageVersion(packageJsonPath: string): string {
    const packageJson = JSON.parse(
        readFileSync(new URL(packageJsonPath, import.meta.url), 'utf8'),
    ) as { version: string };
    return packageJson.version;
}
