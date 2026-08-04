/**
 * Option-driven branches in the plugin factory: the `include` allowlist filter
 * (matched and unmatched), and the one-time `compileSources` warning for entries
 * that do not resolve to a real directory.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { build } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

type PrePlugin = {
    configResolved?: (c: { root: string; command: string }) => void;
    transformInclude(id: string): boolean;
    transform(this: { warn(m: string): void }, code: string, id: string): unknown;
};

describe('include filter', () => {
    it('only admits source files that match the include patterns', () => {
        const [pre] = vitePlugin({ include: [/src\/App\.tsx$/] }) as unknown as [PrePlugin];
        expect(pre.transformInclude('/project/src/App.tsx')).toBe(true);
        // A real source file that does not match the include list is rejected.
        expect(pre.transformInclude('/project/src/Other.tsx')).toBe(false);
    });
});

describe('production option validation', () => {
    it('rejects an unknown mangle-map delivery lane instead of widening it', () => {
        expect(() => vitePlugin({ production: { mangleMapDelivery: 'htlm' as never } })).toThrow(
            /mangleMapDelivery must be 'both', 'html' or 'bundle'/,
        );
    });
});

describe('compileSources resolution warning', () => {
    it('warns once about entries that do not resolve to a directory', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-compilesrc-'));
        tempDirs.push(root);
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const [pre] = vitePlugin({
            compileSources: ['does-not-exist', 'also-missing'],
        }) as unknown as [PrePlugin];
        pre.configResolved?.({ root, command: 'build' });

        // Any transform triggers the lazy compileSources resolution + warning.
        pre.transform.call(
            { warn() {} },
            'export const App = () => <div sz={{ p: 4 }} />;',
            path.join(root, 'src/App.tsx'),
        );

        const message = warn.mock.calls.map(c => String(c[0])).join('\n');
        expect(message).toContain('compileSources');
        expect(message).toContain('did not resolve to a');
        expect(message).toContain('does-not-exist');
    });
});

describe('manifest emission', () => {
    /**
     * Build the fixture and list what landed in the output directory.
     *
     * @param emitManifest - The option under test, or undefined for the default.
     * @returns Emitted asset file names.
     */
    const buildAssets = async (emitManifest?: boolean): Promise<string[]> => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-manifest-'));
        tempDirs.push(root);
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.writeFileSync(
            path.join(root, 'index.html'),
            '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>',
            'utf8',
        );
        fs.writeFileSync(
            path.join(root, 'src/main.ts'),
            "export const A = () => ({ cls: 'x' });\ndocument.body.textContent = String(A().cls);\n",
            'utf8',
        );
        await build({
            root,
            logLevel: 'silent',
            plugins: [
                vitePlugin(
                    emitManifest === undefined
                        ? { build: { parser: 'oxc', cache: false } }
                        : { build: { emitManifest, parser: 'oxc', cache: false } },
                ),
            ],
            build: { minify: false },
        });
        return fs.readdirSync(path.join(root, 'dist'));
    };

    it('does not emit the manifest by default', async () => {
        // Only `@csszyx/dynamic` reads it, and it carries the whole class census
        // to answer questions about the few classes `dynamic()` renders — on a
        // measured 668-class census that is ~2 kB gz against a few hundred bytes
        // of injection spared. Off unless asked for.
        expect(await buildAssets()).not.toContain('csszyx-manifest.json');
    }, 120_000);

    it('emits it when the build asks for it', async () => {
        expect(await buildAssets(true)).toContain('csszyx-manifest.json');
    }, 120_000);
});

describe('unknown option reporting', () => {
    it('warns when the plugin is handed an option it will never read', () => {
        // The reported case: `compilePackages` became `compileSources` before
        // 0.12.0, and passing the old name produced no CSS for the workspace
        // package and not one word from the build.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vitePlugin({ compilePackages: ['vui'] } as never);
        const logged = warn.mock.calls.map(call => call.map(String).join(' ')).join('\n');
        expect(logged).toContain('not recognized');
        expect(logged).toContain('`compilePackages` was replaced by `compileSources`');
    });

    it('stays silent for a config that only uses real options', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vitePlugin({ compileSources: ['../packages/vui'], quiet: 'nudges' });
        const logged = warn.mock.calls.map(call => call.map(String).join(' ')).join('\n');
        expect(logged).not.toContain('not recognized');
    });
});
