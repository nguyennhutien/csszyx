import { getNativePackageName, loadNativeBinding } from '@csszyx/core/native';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import { RESOLVED_VIRTUAL_MODULE_ID } from '../src/virtual-modules.js';

type TransformHook = {
    load?: (id: string) => unknown;
    transform: (this: { warn: (message: string) => void }, code: string, id: string) => unknown;
};

const ORIGINAL_ENV = process.env.CSSZYX_PARSER;
const ORIGINAL_VAR_MAP_MAX_BYTES = process.env.CSSZYX_VAR_MANGLE_MAP_MAX_BYTES;

// The Rust parser branch needs the host platform's optional native package to
// contain a built addon before the unplugin can dispatch to it. CI should run
// `pnpm --filter @csszyx/core native:build -- --native-engine` ahead of these
// tests so this suite exercises the real install-style package-name path. When
// the addon is missing, the rust-mode tests assert the documented
// unavailable-error contract instead.
let nativeRustAvailable = false;

beforeAll(() => {
    const packageName = getNativePackageName();
    try {
        loadNativeBinding(packageName);
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
    if (ORIGINAL_VAR_MAP_MAX_BYTES === undefined) {
        delete process.env.CSSZYX_VAR_MANGLE_MAP_MAX_BYTES;
    } else {
        process.env.CSSZYX_VAR_MANGLE_MAP_MAX_BYTES = ORIGINAL_VAR_MAP_MAX_BYTES;
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
        const [prePlugin] = vitePlugin({
            build: { parser: 'babel' },
        }) as TransformHook[];
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
        const [prePlugin] = vitePlugin({
            build: { parser: 'babel' },
        }) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('const App=()=>');
        expect(result.code).toContain('className="p-4"');
    });

    it('passes production.mangleVars into the oxc compiler path', () => {
        const [prePlugin] = vitePlugin({
            build: { parser: 'oxc', cache: false },
            production: { mangleVars: true },
        }) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = ({ pad }) => <section><div sz={{ p: pad }} /><span sz={{ p: pad }} /></section>;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain(
            '<section style={{"--cz": `calc(${pad} * var(--spacing))`}}>',
        );
        expect(result.code).toContain('<div className="p-(--cz)" />');
        expect(result.code).toContain('<span className="p-(--cz)" />');
    });

    it('passes production.mangleVarHoistMaxDepth into the oxc compiler path', () => {
        const [prePlugin] = vitePlugin({
            build: { parser: 'oxc', cache: false },
            production: { mangleVars: true, mangleVarHoistMaxDepth: 1 },
        }) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = ({ pad }) => <section><div><span sz={{ p: pad }} /></div><button sz={{ p: pad }} /></section>;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).not.toContain('<section style={{"--cz"');
        expect(result.code).toContain(
            '<span className="p-(--sz)" style={{"--sz": `calc(${pad} * var(--spacing))`}} />',
        );
        expect(result.code).toContain(
            '<button className="p-(--sz)" style={{"--sz": `calc(${pad} * var(--spacing))`}} />',
        );
    });

    it('replaces per-file CSS variable metadata instead of append-only accumulation', () => {
        const [prePlugin] = vitePlugin({
            build: { parser: 'oxc', cache: false },
            production: { mangleVars: true },
        }) as TransformHook[];

        prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = ({ pad }) => <div sz={{ p: pad }} />;',
            '/repo/src/App.tsx',
        );
        prePlugin.transform.call(
            { warn: vi.fn() },
            'const Card = ({ gap }) => <div sz={{ gap }} />;',
            '/repo/src/Card.tsx',
        );
        const initialModuleSource = String(prePlugin.load?.(RESOLVED_VIRTUAL_MODULE_ID));
        expect(initialModuleSource).toContain('"--_sz-p": "--sz"');
        expect(initialModuleSource).toContain('"--_sz-gap": "--sz"');

        prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = () => <div />;',
            '/repo/src/App.tsx',
        );
        const moduleSource = String(prePlugin.load?.(RESOLVED_VIRTUAL_MODULE_ID));

        expect(moduleSource).not.toContain('"--_sz-p"');
        expect(moduleSource).toContain('"--_sz-gap": "--sz"');
    });

    it('fails loudly when CSS variable metadata exceeds the safety cap', () => {
        process.env.CSSZYX_VAR_MANGLE_MAP_MAX_BYTES = '16';
        const [prePlugin] = vitePlugin({
            build: { parser: 'oxc', cache: false },
            production: { mangleVars: true },
        }) as TransformHook[];

        prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = ({ pad }) => <div sz={{ p: pad }} />;',
            '/repo/src/App.tsx',
        );

        expect(() => prePlugin.load?.(RESOLVED_VIRTUAL_MODULE_ID)).toThrow(
            'CSS variable mangle map',
        );
    });

    it('passes production.mangleVars into the Rust compiler path', () => {
        const [prePlugin] = vitePlugin({
            build: { parser: 'rust', cache: false },
            production: { mangleVars: true },
        }) as TransformHook[];

        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = ({ pad }) => <section><div sz={{ p: pad }} /><span sz={{ p: pad }} /></section>;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain(
            '<section style={{"--cz": `calc(${pad} * var(--spacing))`}}>',
        );
        expect(result.code).toContain('<div className="p-(--cz)" />');
        expect(result.code).toContain('<span className="p-(--cz)" />');
    });

    it('lets build.parser opt into the Rust engine explicitly', () => {
        if (!nativeRustAvailable) {
            // No host addon present — assert the explicit unavailable-error
            // contract so users hitting this path know the parser flipped on
            // but the binding is missing for their platform.
            const [prePlugin] = vitePlugin({
                build: { parser: 'rust' },
            }) as TransformHook[];
            expect(() =>
                prePlugin.transform.call(
                    { warn: vi.fn() },
                    'const App=()=> <div sz={{ p: 4 }} />;',
                    '/repo/src/App.tsx',
                ),
            ).toThrow('Use build.parser: "oxc" or "babel"');
            return;
        }

        const [prePlugin] = vitePlugin({
            build: { parser: 'rust' },
        }) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('className="p-4"');
        expect(result.code).not.toContain(' sz=');
    });

    it('injects runtime imports when the rust engine emits fallback helpers', () => {
        if (!nativeRustAvailable) {
            const [prePlugin] = vitePlugin({
                build: { parser: 'rust' },
            }) as TransformHook[];
            expect(() =>
                prePlugin.transform.call(
                    { warn: vi.fn() },
                    'export const App = () => <div sz={{ p: 4 }} />;',
                    '/repo/src/App.tsx',
                ),
            ).toThrow('Use build.parser: "oxc" or "babel"');
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
            'export const Runtime = ({ styles }) => <div sz={styles} />;',
            'export const MergeRuntime = ({ styles }) => <div className="existing" sz={styles} />;',
            'export const MergeDynamic = ({ styles }) => <div className={getClass()} sz={styles} />;',
        ].join('\n');
        const [prePlugin] = vitePlugin({
            build: { parser: 'rust' },
        }) as TransformHook[];

        const result = prePlugin.transform.call({ warn: vi.fn() }, source, '/repo/src/App.tsx') as {
            code: string;
        };

        expect(result.code).toContain('_sz({ ...BASE, ...(big ? { p: 8 } : {}) })');
        expect(result.code).toContain('_sz(styles)');
        expect(result.code).toContain('_szMerge("existing", _sz(styles))');
        expect(result.code).toContain('_szMerge(getClass(), _sz(styles))');
        expect(result.code).toMatch(
            /import\s+\{[^}]*\b_sz\b[^}]*\}\s+from\s+['"]@csszyx\/runtime['"]/,
        );
        expect(result.code).toMatch(
            /import\s+\{[^}]*\b_szMerge\b[^}]*\}\s+from\s+['"]@csszyx\/runtime['"]/,
        );
    });

    it('lets CSSZYX_PARSER=rust override build.parser=babel', () => {
        process.env.CSSZYX_PARSER = 'rust';

        if (!nativeRustAvailable) {
            const [prePlugin] = vitePlugin({
                build: { parser: 'babel' },
            }) as TransformHook[];
            expect(() =>
                prePlugin.transform.call(
                    { warn: vi.fn() },
                    'const App=()=> <div sz={{ p: 4 }} />;',
                    '/repo/src/App.tsx',
                ),
            ).toThrow('Use build.parser: "oxc" or "babel"');
            return;
        }

        const [prePlugin] = vitePlugin({
            build: { parser: 'babel' },
        }) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('className="p-4"');
        expect(result.code).not.toContain(' sz=');
    });
});
