import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNativePackageName, loadNativeBinding } from '@csszyx/core/native';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
    readTransformCache,
    resolveTransformCacheDir,
    type TransformCacheKeyInput,
} from '../src/transform-cache.js';
import { vitePlugin } from '../src/unplugin.js';

type TransformHook = {
    configResolved?: (config: { root: string }) => void;
    transform: (this: { warn: (message: string) => void }, code: string, id: string) => unknown;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../..');
const PLUGIN_VERSION = packageVersion('../package.json');
const COMPILER_VERSION = packageVersion('../../compiler/package.json');

let nativeRustAvailable = false;

beforeAll(() => {
    try {
        loadNativeBinding(getNativePackageName());
        nativeRustAvailable = true;
    } catch {
        nativeRustAvailable = false;
    }
});

function packageVersion(packageJsonPath: string): string {
    const packageJson = JSON.parse(
        readFileSync(new URL(packageJsonPath, import.meta.url), 'utf8'),
    ) as { version: string };
    return packageJson.version;
}

describe('rust parser real-source canary', () => {
    function createRustTransform({
        cache = false,
        root = REPO_ROOT,
    }: {
        cache?: boolean;
        root?: string;
    } = {}): TransformHook {
        const [prePlugin] = vitePlugin({
            build: { parser: 'rust', cache },
        }) as TransformHook[];
        prePlugin.configResolved?.({ root });
        return prePlugin;
    }

    function rustCacheInput(overrides: Partial<TransformCacheKeyInput>): TransformCacheKeyInput {
        return {
            pluginVersion: PLUGIN_VERSION,
            compilerVersion: COMPILER_VERSION,
            parserMode: 'rust',
            producer: 'rust',
            filename: '/repo/src/App.tsx',
            source: 'const App=()=> <div sz={{ p: 4 }} />;',
            ...overrides,
        };
    }

    it('runs representative playground and docs files through the unplugin rust path', () => {
        const prePlugin = createRustTransform();

        if (!nativeRustAvailable) {
            expect(() =>
                prePlugin.transform.call(
                    { warn: vi.fn() },
                    'const App=()=> <div sz={{ p: 4 }} />;',
                    join(REPO_ROOT, 'src/App.tsx'),
                ),
            ).toThrow('Use build.parser: "oxc" or "babel"');
            return;
        }

        const cases = [
            {
                filename: 'playground/vite-react/src/App.tsx',
                expected: ['className=', 'min-h-screen', 'bg-linear-to-br'],
            },
            {
                filename: 'playground/nextjs-ssr/components/server-card.tsx',
                expected: ['className=', 'p-6', 'rounded-xl'],
            },
            {
                filename: 'apps/docs/src/components/Demo.tsx',
                expected: ['className=', 'demo-dot', 'rounded-xl'],
            },
        ];

        for (const testCase of cases) {
            const id = join(REPO_ROOT, testCase.filename);
            const source = readFileSync(id, 'utf8');
            const result = prePlugin.transform.call({ warn: vi.fn() }, source, id) as {
                code: string;
            };

            expect(result.code, testCase.filename).not.toContain(' sz=');
            for (const expected of testCase.expected) {
                expect(result.code, testCase.filename).toContain(expected);
            }
        }
    });

    it('keeps Rust runtime helper output blocked in server components', () => {
        const prePlugin = createRustTransform();
        const source = `
            // leading comment before directive should not hide the server boundary
            'use server';
            export function Card({ styles, className }) {
                return <div className={className} sz={styles} />;
            }
        `;
        const id = join(REPO_ROOT, 'app/actions.tsx');

        if (!nativeRustAvailable) {
            expect(() => prePlugin.transform.call({ warn: vi.fn() }, source, id)).toThrow(
                'Use build.parser: "oxc" or "babel"',
            );
            return;
        }

        expect(() => prePlugin.transform.call({ warn: vi.fn() }, source, id)).toThrow(
            'csszyxRSCViolation: _sz imported in Server Component',
        );
    });

    it('round-trips Rust parser output through the transform cache when native is available', () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-rust-cache-'));
        try {
            const source = 'const App=()=> <div sz={{ p: 4, bg: "red-500" }} />;';
            const id = join(root, 'src/App.tsx');
            const prePlugin = createRustTransform({ cache: true, root });

            if (!nativeRustAvailable) {
                expect(() => prePlugin.transform.call({ warn: vi.fn() }, source, id)).toThrow(
                    'Use build.parser: "oxc" or "babel"',
                );
                expect(existsSync(resolveTransformCacheDir(root))).toBe(false);
                return;
            }

            const first = prePlugin.transform.call({ warn: vi.fn() }, source, id) as {
                code: string;
            };
            expect(first.code).toContain('className="p-4 bg-red-500"');

            const cacheRoot = resolveTransformCacheDir(root);
            const cached = readTransformCache(cacheRoot, rustCacheInput({ filename: id, source }));
            expect(cached?.code).toBe(first.code);
            expect(cached?.classes).toEqual(new Set(['p-4', 'bg-red-500']));

            const nextPlugin = createRustTransform({ cache: true, root });
            const second = nextPlugin.transform.call({ warn: vi.fn() }, source, id) as {
                code: string;
            };
            expect(second.code).toBe(first.code);
        } finally {
            rmSync(root, { force: true, recursive: true });
        }
    });
});
