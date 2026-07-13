/**
 * Branch coverage for the Next source transformer's fail-closed lexer and its
 * global-var-alias cache-key normalizer: regex-literal escapes / char-classes /
 * flags, escaped string literals, a leading regex literal, and the three alias
 * container shapes (Map / Array / plain object) plus the non-`--` filter.
 */
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
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function packageVersion(packageJsonPath: string): string {
    const packageJson = JSON.parse(
        readFileSync(new URL(packageJsonPath, import.meta.url), 'utf8'),
    ) as { version: string };
    return packageJson.version;
}

function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-next-lexer-'));
    tempDirs.push(dir);
    return dir;
}

function base(overrides: Partial<Parameters<typeof transformNextSource>[0]> = {}) {
    return {
        source: 'const value = 1;',
        filename: '/repo/src/plain.ts',
        parserMode: 'babel' as const,
        pluginVersion: PLUGIN_VERSION,
        compilerVersion: COMPILER_VERSION,
        ...overrides,
    };
}

describe('fail-closed lexer does not trip on non-sz constructs', () => {
    it('handles an escaped forward slash inside a regex literal', () => {
        const result = transformNextSource(base({ source: 'const r = /a\\/sz={{ p: 4 }}b/;\n' }));
        expect(result.result.transformed).toBe(false);
    });

    it('handles a character class inside a regex literal', () => {
        const result = transformNextSource(base({ source: 'const r = /[sz]={{ p: 4 }}/;\n' }));
        expect(result.result.transformed).toBe(false);
    });

    it('handles regex flags after the closing slash', () => {
        const result = transformNextSource(base({ source: 'const r = /sz={{ p: 4 }}/gi;\n' }));
        expect(result.result.transformed).toBe(false);
    });

    it('handles an escaped quote inside a string literal', () => {
        const result = transformNextSource(base({ source: 'const s = "a\\" sz={{ p: 4 }} b";\n' }));
        expect(result.result.transformed).toBe(false);
    });

    it('handles a regex literal at the very start of the source', () => {
        const result = transformNextSource(base({ source: '/sz={{ p: 4 }}/.test(input);\n' }));
        expect(result.result.transformed).toBe(false);
    });

    it('handles a regex literal that ends exactly at end-of-source', () => {
        // No trailing character after the closing slash → the flag scan reads
        // past the end and must tolerate the undefined lookahead.
        const result = transformNextSource(base({ source: 'const r = /sz={{ p: 4 }}/' }));
        expect(result.result.transformed).toBe(false);
    });
});

describe('global-var-alias cache-key normalization', () => {
    const source = 'const App=()=> <div sz={{ p: 4 }} />;';

    it('treats Map, Array, and object alias containers as equivalent cache keys', () => {
        const root = tempRoot();
        const cacheRoot = resolveTransformCacheDir(root);
        const filename = join(root, 'src/A.tsx');

        const first = transformNextSource(
            base({
                source,
                filename,
                cacheRoot,
                compilerOptions: { globalVarAliases: new Map([['--brand', '--gz']]) },
            }),
        );
        const second = transformNextSource(
            base({
                source,
                filename,
                cacheRoot,
                compilerOptions: { globalVarAliases: [['--brand', '--gz']] },
            }),
        );
        const third = transformNextSource(
            base({
                source,
                filename,
                cacheRoot,
                compilerOptions: { globalVarAliases: { '--brand': '--gz' } },
            }),
        );

        expect(first.cacheStatus).toBe('write');
        expect(second.cacheStatus).toBe('hit');
        expect(third.cacheStatus).toBe('hit');
    });

    it('ignores alias entries whose names do not start with --', () => {
        const root = tempRoot();
        const cacheRoot = resolveTransformCacheDir(root);
        const filename = join(root, 'src/B.tsx');

        const withNoAliases = transformNextSource(base({ source, filename, cacheRoot }));
        const withJunkAliases = transformNextSource(
            base({
                source,
                filename,
                cacheRoot,
                compilerOptions: { globalVarAliases: { brand: 'gz', '--ok': 'nope' } },
            }),
        );

        // Every junk entry is filtered out, so the normalized alias list is
        // empty and the cache key matches the no-alias run.
        expect(withNoAliases.cacheStatus).toBe('write');
        expect(withJunkAliases.cacheStatus).toBe('hit');
    });
});
