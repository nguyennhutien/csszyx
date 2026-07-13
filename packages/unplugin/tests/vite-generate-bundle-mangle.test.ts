/**
 * The vite post-plugin `generateBundle` mangle pass, driven directly on a
 * synthetic rollup bundle after the pre-plugin transform has populated the
 * discovered-class state. Covers CSS-selector rewriting, JS-chunk class
 * mangling, the manifest emission, and the placeholder-only replacement path
 * taken when mangling is disabled.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface EmittedFile {
    type: string;
    fileName: string;
    source: string;
}

interface Harness {
    root: string;
    transform: (code: string, id: string) => Promise<unknown>;
    generateBundle: (bundle: Record<string, unknown>) => Promise<EmittedFile[]>;
}

async function boot(options = {}): Promise<Harness> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-genbundle-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    const plugins = vitePlugin(options);
    const find = (hookName: string) => {
        const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
        if (!plugin) return undefined;
        const hook = (plugin as Record<string, unknown>)[hookName];
        return (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
    };
    const baseCtx = { warn() {}, error() {} };
    await find('configResolved')?.apply(baseCtx, [{ root, command: 'build' }]);
    return {
        root,
        transform: async (code, id) => find('transform')?.apply(baseCtx, [code, id]),
        generateBundle: async bundle => {
            const emitted: EmittedFile[] = [];
            const ctx = { ...baseCtx, emitFile: (f: EmittedFile) => emitted.push(f) };
            await find('generateBundle')?.apply(ctx, [{}, bundle]);
            return emitted;
        },
    };
}

describe('vite generateBundle mangle pass', () => {
    it('rewrites CSS selectors and JS class strings for discovered classes', async () => {
        const h = await boot({
            production: { mangle: true },
            build: { parser: 'oxc', cache: false },
        });
        await h.transform(
            'export const App = () => <div sz={{ m: 3 }} />;',
            path.join(h.root, 'src/App.tsx'),
        );

        const cssAsset = { type: 'asset', fileName: 'style.css', source: '.m-3{margin:0.75rem}' };
        const jsChunk = { type: 'chunk', fileName: 'app.js', code: 'var c={className:"m-3"};' };
        const bundle = { 'style.css': cssAsset, 'app.js': jsChunk };

        const emitted = await h.generateBundle(bundle);

        // The manifest asset is always emitted and carries the mangle map.
        const manifest = emitted.find(f => f.fileName === 'csszyx-manifest.json');
        if (!manifest) throw new Error('manifest asset was not emitted');
        const parsed = JSON.parse(manifest.source) as { mangleMap?: Record<string, string> };
        expect(parsed.mangleMap).toBeDefined();
        const token = parsed.mangleMap?.['m-3'];
        expect(token).toBeTruthy();

        // CSS selector and JS string are both rewritten to the mangled token.
        expect(cssAsset.source).not.toContain('.m-3{');
        expect(cssAsset.source).toContain(`.${token}`);
        expect(jsChunk.code).toContain(`"${token}"`);
        expect(jsChunk.code).not.toContain('"m-3"');
    });

    it('swallows a CSS syntax error while mangling a malformed CSS asset', async () => {
        const h = await boot({
            production: { mangle: true },
            build: { parser: 'oxc', cache: false },
        });
        await h.transform(
            'export const App = () => <div sz={{ m: 3 }} />;',
            path.join(h.root, 'src/App.tsx'),
        );

        // Unclosed rule → the CSS mangler throws a CssSyntaxError, which the
        // generateBundle hook must catch and leave the asset untouched.
        const brokenCss = { type: 'asset', fileName: 'broken.css', source: '.m-3 { color: ' };
        const bundle = { 'broken.css': brokenCss };
        await expect(h.generateBundle(bundle)).resolves.toBeDefined();
        // The malformed source is preserved unchanged.
        expect(brokenCss.source).toBe('.m-3 { color: ');
    });

    it('replaces the checksum placeholder in JS chunks even when mangling is disabled', async () => {
        const h = await boot({
            production: { mangle: false },
            build: { parser: 'oxc', cache: false },
        });
        await h.transform(
            'export const App = () => <div sz={{ m: 3 }} />;',
            path.join(h.root, 'src/App.tsx'),
        );

        const jsChunk = {
            type: 'chunk',
            fileName: 'app.js',
            code: 'var checksum="___CSSZYX_CHECKSUM___";',
        };
        await h.generateBundle({ 'app.js': jsChunk });

        expect(jsChunk.code).not.toContain('___CSSZYX_CHECKSUM___');
        expect(jsChunk.code).toContain('var checksum="');
    });

    it('replaces checksum, mangle-map and var-map placeholders in a plain chunk', async () => {
        const h = await boot({
            production: { mangle: false },
            build: { parser: 'oxc', cache: false },
        });
        await h.transform(
            'export const App = () => <div sz={{ m: 3 }} />;',
            path.join(h.root, 'src/App.tsx'),
        );

        const jsChunk = {
            type: 'chunk',
            fileName: 'app.js',
            code: 'var c=___CSSZYX_CHECKSUM___;var m=___CSSZYX_MANGLE_MAP___;var vm=___CSSZYX_VAR_MANGLE_MAP___;',
        };
        await h.generateBundle({ 'app.js': jsChunk });

        expect(jsChunk.code).not.toContain('___CSSZYX_MANGLE_MAP___');
        expect(jsChunk.code).not.toContain('___CSSZYX_VAR_MANGLE_MAP___');
        expect(jsChunk.code).not.toContain('___CSSZYX_CHECKSUM___');
        // The mangle map serializes to a JSON object literal.
        expect(jsChunk.code).toContain('var m={');
    });

    it('double-escapes the placeholder maps inside an eval-wrapped chunk', async () => {
        const h = await boot({
            production: { mangle: false },
            build: { parser: 'oxc', cache: false },
        });
        await h.transform(
            'export const App = () => <div sz={{ m: 3 }} />;',
            path.join(h.root, 'src/App.tsx'),
        );

        const jsChunk = {
            type: 'chunk',
            fileName: 'app.js',
            code: 'eval("var m=___CSSZYX_MANGLE_MAP___;var vm=___CSSZYX_VAR_MANGLE_MAP___;var c=___CSSZYX_CHECKSUM___;")',
        };
        await h.generateBundle({ 'app.js': jsChunk });

        expect(jsChunk.code).not.toContain('___CSSZYX_MANGLE_MAP___');
        expect(jsChunk.code).not.toContain('___CSSZYX_VAR_MANGLE_MAP___');
        // The eval branch escapes the JSON quotes for the outer double-quoted string.
        expect(jsChunk.code).toContain('eval(');
        expect(jsChunk.code).toContain('\\"');
    });
});
