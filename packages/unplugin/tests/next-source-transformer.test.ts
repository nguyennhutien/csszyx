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
            parserMode: 'oxc' as const,
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
        expect(first.producer).toBe('oxc');
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

        expect(first.producer).toBe('oxc');
        expect(first.cacheStatus).toBe('write');
        expect(first.result.code).toContain('className="p-4"');
        expect(rerun.cacheStatus).toBe('hit');
    });

    it('fails closed instead of passing through invalid source', () => {
        expect(() =>
            transformNextSource(
                input({
                    parserMode: 'babel',
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
                parserMode: 'babel',
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
                parserMode: 'babel',
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
                parserMode: 'babel',
                source: 'export const Z = "sample text sz={{ p: 4 }} not real";\n',
                filename: '/repo/src/StringOnly.tsx',
            }),
        );

        expect(result.result.transformed).toBe(false);
        expect(result.result.code).toContain('sample text');
    });
});

function packageVersion(packageJsonPath: string): string {
    const packageJson = JSON.parse(
        readFileSync(new URL(packageJsonPath, import.meta.url), 'utf8'),
    ) as { version: string };
    return packageJson.version;
}
