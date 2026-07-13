import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransformCacheKeyInput } from '../src/transform-cache.js';
import {
    readTransformCache,
    resolveTransformCacheDir,
    writeTransformCache,
} from '../src/transform-cache.js';

vi.mock('@csszyx/compiler', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler')>();
    return {
        ...actual,
        ensureRustTransformAvailable: vi.fn(() => {
            throw new actual.OxcRustNotImplementedError('mock native unavailable');
        }),
        transformOxc: vi.fn(() => {
            throw new Error('mock oxc failure');
        }),
        transformRust: vi.fn(() => {
            throw new actual.OxcRustNotImplementedError('mock native unavailable');
        }),
    };
});

const { vitePlugin } = await import('../src/unplugin.js');

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

function cacheInput(overrides: Partial<TransformCacheKeyInput> = {}): TransformCacheKeyInput {
    return {
        pluginVersion: PLUGIN_VERSION,
        compilerVersion: COMPILER_VERSION,
        parserMode: 'oxc',
        producer: 'oxc',
        filename: '/repo/src/App.tsx',
        source: '<div szRecover="csr" sz={{ p: 4 }} />;',
        ...overrides,
    };
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('transform cache fallback safety', () => {
    function tempRoot(): string {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-cache-fallback-'));
        tempDirs.push(dir);
        return dir;
    }

    it('does not cache Babel fallback output under the oxc cache key', () => {
        const root = tempRoot();
        // Pinned to oxc so the oxc-to-Babel fallback path is exercised. The
        // default parser is now rust; rust does not fall back to anything and
        // would surface OxcRustNotImplementedError instead of running this
        // test's intended fallback codepath.
        const [prePlugin] = vitePlugin({ build: { parser: 'oxc' } }) as TransformHook[];
        prePlugin.configResolved?.({ root });

        const warnings: string[] = [];
        const source = '<div szRecover="csr" sz={{ p: 4 }} />;';
        const id = join(root, 'src/App.tsx');
        const result = prePlugin.transform.call(
            { warn: message => warnings.push(message) },
            source,
            id,
        ) as { code: string };

        expect(result.code).toContain('className="p-4"');
        expect(result.code).toContain('data-sz-recovery-token=');
        expect(warnings.join('\n')).toContain('oxc parser fell back to Babel');

        const cacheRoot = resolveTransformCacheDir(root);
        expect(readTransformCache(cacheRoot, cacheInput({ filename: id, source }))).toBeNull();
        expect(
            readTransformCache(
                cacheRoot,
                cacheInput({ filename: id, source, producer: 'babel-fallback' }),
            ),
        ).toBeNull();
    });

    it('does not serve a rust cache entry when the native binding is unavailable', () => {
        const root = tempRoot();
        const source = 'const App=()=> <div sz={{ p: 4 }} />;';
        const id = join(root, 'src/App.tsx');
        const cacheRoot = resolveTransformCacheDir(root);
        writeTransformCache(
            cacheRoot,
            cacheInput({
                filename: id,
                parserMode: 'rust',
                producer: 'rust',
                source,
            }),
            {
                code: 'const App=()=> <div className="p-4" />;',
                transformed: true,
                usesRuntime: false,
                usesMerge: false,
                usesColorVar: false,
                usesSpacingVar: false,
                usesUnitVar: false,
                classes: new Set(['p-4']),
                rawClassNames: new Set(),
                diagnostics: [],
                recoveryTokens: new Map(),
                cssVariableMap: new Map(),
            },
        );
        const [prePlugin] = vitePlugin({ build: { parser: 'rust' } }) as TransformHook[];
        prePlugin.configResolved?.({ root });

        expect(() => prePlugin.transform.call({ warn: () => undefined }, source, id)).toThrow(
            'mock native unavailable',
        );
    });
});
