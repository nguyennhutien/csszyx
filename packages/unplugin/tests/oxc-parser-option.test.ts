import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getNativePackageName, loadNativeBinding } from '@csszyx/core/native';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

type TransformHook = {
    transform: (this: { warn: (message: string) => void }, code: string, id: string) => unknown;
};

const ORIGINAL_ENV = process.env.CSSZYX_PARSER;

// The Rust parser branch needs the host platform's native addon to be
// loaded before the unplugin can dispatch to it. CI must `pnpm --filter
// @csszyx/core native:build -- --native-engine` ahead of these tests. We
// preload here so `build.parser: "rust"` resolves through the real
// engine; when the addon is missing the loader throws and the rust-mode
// tests assert the documented unavailable-error contract instead.
let nativeRustAvailable = false;

beforeAll(() => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const packageName = getNativePackageName();
    const platformDir = packageName
        ? path.resolve(here, `../../${packageName.split('/').pop()}`)
        : null;
    try {
        try {
            loadNativeBinding();
        } catch {
            if (!platformDir) {
                throw new Error('No supported native package for this platform');
            }
            loadNativeBinding(platformDir);
        }
        nativeRustAvailable = true;
    } catch {
        nativeRustAvailable = false;
    }
});

afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
        delete process.env.CSSZYX_PARSER;
    } else {
        process.env.CSSZYX_PARSER = ORIGINAL_ENV;
    }
});

describe('csszyx parser selection', () => {
    it('uses oxc by default', () => {
        const [prePlugin] = vitePlugin() as TransformHook[];
        const warn = vi.fn();
        const result = prePlugin.transform.call(
            { warn },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('const App=()=>');
        expect(result.code).toContain('className="p-4"');
        expect(result.code).not.toContain(' sz=');
        expect(warn).not.toHaveBeenCalled();
    });

    it('lets build.parser opt back into Babel', () => {
        const [prePlugin] = vitePlugin({ build: { parser: 'babel' } }) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('const App = () =>');
        expect(result.code).toContain('className="p-4"');
    });

    it('lets CSSZYX_PARSER=babel override the default', () => {
        process.env.CSSZYX_PARSER = 'babel';
        const [prePlugin] = vitePlugin() as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('const App = () =>');
        expect(result.code).toContain('className="p-4"');
    });

    it('lets CSSZYX_PARSER=oxc override build.parser=babel', () => {
        process.env.CSSZYX_PARSER = 'oxc';
        const [prePlugin] = vitePlugin({ build: { parser: 'babel' } }) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('const App=()=>');
        expect(result.code).toContain('className="p-4"');
    });

    it('lets build.parser opt into the Rust engine explicitly', () => {
        if (!nativeRustAvailable) {
            // No host addon present — assert the explicit unavailable-error
            // contract so users hitting this path know the parser flipped on
            // but the binding is missing for their platform.
            const [prePlugin] = vitePlugin({ build: { parser: 'rust' } }) as TransformHook[];
            expect(() =>
                prePlugin.transform.call(
                    { warn: vi.fn() },
                    'const App=()=> <div sz={{ p: 4 }} />;',
                    '/repo/src/App.tsx',
                ),
            ).toThrow('transformRust: not implemented yet');
            return;
        }

        const [prePlugin] = vitePlugin({ build: { parser: 'rust' } }) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('className="p-4"');
        expect(result.code).not.toContain(' sz=');
    });

    it('injects the _sz runtime import when the rust engine emits a runtime fallback', () => {
        if (!nativeRustAvailable) {
            const [prePlugin] = vitePlugin({ build: { parser: 'rust' } }) as TransformHook[];
            expect(() =>
                prePlugin.transform.call(
                    { warn: vi.fn() },
                    'export const App = () => <div sz={{ p: 4 }} />;',
                    '/repo/src/App.tsx',
                ),
            ).toThrow('transformRust: not implemented yet');
            return;
        }

        // Conditional spread is the canonical R4.5 shape: the Rust engine
        // emits `className={_sz(<original>)}` and flips usesRuntime=true.
        // The unplugin's runtime-helpers pass must read that flag and add
        // the matching `_sz` import from @csszyx/runtime — without it the
        // emitted code references an undefined symbol at runtime, which
        // is the kind of silent end-to-end break that's invisible to
        // unit tests on either side of the boundary.
        const source = [
            'const BASE = { p: 4 } as const;',
            'export const App = ({ big }: { big: boolean }) =>',
            '    <div sz={{ ...BASE, ...(big ? { p: 8 } : {}) }} />;',
        ].join('\n');
        const [prePlugin] = vitePlugin({ build: { parser: 'rust' } }) as TransformHook[];

        const result = prePlugin.transform.call({ warn: vi.fn() }, source, '/repo/src/App.tsx') as {
            code: string;
        };

        expect(result.code).toContain('_sz({ ...BASE, ...(big ? { p: 8 } : {}) })');
        expect(result.code).toMatch(
            /import\s+\{[^}]*\b_sz\b[^}]*\}\s+from\s+['"]@csszyx\/runtime['"]/,
        );
    });

    it('lets CSSZYX_PARSER=rust override build.parser=babel', () => {
        process.env.CSSZYX_PARSER = 'rust';

        if (!nativeRustAvailable) {
            const [prePlugin] = vitePlugin({ build: { parser: 'babel' } }) as TransformHook[];
            expect(() =>
                prePlugin.transform.call(
                    { warn: vi.fn() },
                    'const App=()=> <div sz={{ p: 4 }} />;',
                    '/repo/src/App.tsx',
                ),
            ).toThrow('transformRust: not implemented yet');
            return;
        }

        const [prePlugin] = vitePlugin({ build: { parser: 'babel' } }) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('className="p-4"');
        expect(result.code).not.toContain(' sz=');
    });
});
