/**
 * The vite plugin's output mangle passes, driven directly on synthetic rollup
 * artifacts after the prescan has populated the discovered-class state. Covers
 * CSS-selector rewriting, JS-chunk class mangling, the manifest emission, and
 * the placeholder-only replacement path taken when mangling is disabled.
 *
 * Each pass lives in the last hook that still runs before its artifact's
 * filename hash is computed, which is why they are in three different places:
 * CSS in a `transform` (Vite hashes a stylesheet from what it collects there),
 * JS in `renderChunk` (Rollup hashes a chunk from what that hook returns), and
 * only the fixed-name manifest assets in `generateBundle`. Driving them from
 * `generateBundle` — as this suite used to — is exactly the mistake that
 * shipped assets whose names described their un-mangled bytes.
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

const APP_SOURCE = 'export const App = () => <div sz={{ m: 3 }} />;';

interface EmittedFile {
    type: string;
    fileName: string;
    source: string;
}

interface Harness {
    root: string;
    transformCss: (code: string, id: string) => Promise<string>;
    renderChunk: (chunk: { code: string }) => Promise<void>;
    generateBundle: (bundle: Record<string, unknown>) => Promise<EmittedFile[]>;
}

type Hook = ((...args: unknown[]) => unknown) | undefined;

/**
 * Boot the vite plugin array against a fixture root and expose its hooks.
 *
 * The module lands on disk before `configResolved` because a production build
 * settles the mangle map from the prescan: a class the prescan never walked is
 * not in the map, and would fail the late-census check at `buildEnd`.
 *
 * @param options csszyx plugin options.
 * @returns Hook drivers bound to one plugin instance.
 */
async function boot(options = {}): Promise<Harness> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-genbundle-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/App.tsx'), APP_SOURCE, 'utf8');
    const plugins = vitePlugin(options) as Array<Record<string, unknown>>;
    const hookOf = (pluginName: string, hookName: string): Hook => {
        const plugin = plugins.find(p => p?.name === pluginName);
        const hook = plugin?.[hookName];
        return (
            typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
        ) as Hook;
    };
    const baseCtx = { warn() {}, error() {} };
    for (const name of ['csszyx:pre', 'csszyx:css-mangle']) {
        await hookOf(name, 'configResolved')?.apply(baseCtx, [{ root, command: 'build' }]);
    }
    return {
        root,
        transformCss: async (code, id) => {
            const result = (await hookOf('csszyx:css-mangle', 'transform')?.apply(baseCtx, [
                code,
                id,
            ])) as { code: string } | null | undefined;
            return result?.code ?? code;
        },
        // Writes the rewritten source back onto the caller's chunk so the
        // assertions read like the bundle Rollup goes on to hash.
        renderChunk: async chunk => {
            await hookOf('csszyx:post', 'renderStart')?.apply(baseCtx, []);
            const result = (await hookOf('csszyx:post', 'renderChunk')?.apply(baseCtx, [
                chunk.code,
            ])) as { code: string } | null | undefined;
            if (result) chunk.code = result.code;
        },
        generateBundle: async bundle => {
            const emitted: EmittedFile[] = [];
            const ctx = { ...baseCtx, emitFile: (f: EmittedFile) => emitted.push(f) };
            await hookOf('csszyx:post', 'generateBundle')?.apply(ctx, [{}, bundle]);
            return emitted;
        },
    };
}

describe('vite output mangle passes', () => {
    it('rewrites CSS selectors and JS class strings for discovered classes', async () => {
        const h = await boot({
            production: { mangle: true },
            build: { emitManifest: true, parser: 'oxc', cache: false },
        });

        const css = await h.transformCss('.m-3{margin:0.75rem}', path.join(h.root, 'style.css'));
        const jsChunk = { code: 'var c={className:"m-3"};' };
        await h.renderChunk(jsChunk);
        const emitted = await h.generateBundle({});

        // The manifest asset is always emitted and carries the mangle map.
        const manifest = emitted.find(f => f.fileName === 'csszyx-manifest.json');
        if (!manifest) throw new Error('manifest asset was not emitted');
        const parsed = JSON.parse(manifest.source) as { mangleMap?: Record<string, string> };
        expect(parsed.mangleMap).toBeDefined();
        const token = parsed.mangleMap?.['m-3'];
        expect(token).toBeTruthy();

        // CSS selector and JS string are both rewritten to the mangled token.
        expect(css).not.toContain('.m-3{');
        expect(css).toContain(`.${token}`);
        expect(jsChunk.code).toContain(`"${token}"`);
        expect(jsChunk.code).not.toContain('"m-3"');
    });

    it('leaves CSS assets alone in generateBundle once the transform rewrote them', async () => {
        const h = await boot({
            production: { mangle: true },
            build: { emitManifest: true, parser: 'oxc', cache: false },
        });

        // A stylesheet the transform pass already mangled reaches the bundle
        // under a name computed from those bytes. Touching it here would move
        // the bytes out from under the name — the bug this split exists to fix.
        const cssAsset = { type: 'asset', fileName: 'style.css', source: '.m-3{margin:0.75rem}' };
        await h.generateBundle({ 'style.css': cssAsset });

        expect(cssAsset.source).toBe('.m-3{margin:0.75rem}');
    });

    it('swallows a CSS syntax error while mangling a malformed stylesheet', async () => {
        const h = await boot({
            production: { mangle: true },
            build: { emitManifest: true, parser: 'oxc', cache: false },
        });

        // Unclosed rule → the CSS mangler throws a CssSyntaxError, which the
        // transform must catch and leave the stylesheet untouched.
        const broken = '.m-3 { color: ';
        await expect(h.transformCss(broken, path.join(h.root, 'broken.css'))).resolves.toBe(broken);
    });

    it('replaces the checksum placeholder in JS chunks even when mangling is disabled', async () => {
        const h = await boot({
            production: { mangle: false },
            build: { emitManifest: true, parser: 'oxc', cache: false },
        });

        const jsChunk = { code: 'var checksum="___CSSZYX_CHECKSUM___";' };
        await h.renderChunk(jsChunk);

        expect(jsChunk.code).not.toContain('___CSSZYX_CHECKSUM___');
        expect(jsChunk.code).toContain('var checksum="');
    });

    it('replaces checksum, mangle-map and var-map placeholders in a plain chunk', async () => {
        const h = await boot({
            production: { mangle: false },
            build: { emitManifest: true, parser: 'oxc', cache: false },
        });

        const jsChunk = {
            code: 'var c=___CSSZYX_CHECKSUM___;var m=___CSSZYX_MANGLE_MAP___;var vm=___CSSZYX_VAR_MANGLE_MAP___;',
        };
        await h.renderChunk(jsChunk);

        expect(jsChunk.code).not.toContain('___CSSZYX_MANGLE_MAP___');
        expect(jsChunk.code).not.toContain('___CSSZYX_VAR_MANGLE_MAP___');
        expect(jsChunk.code).not.toContain('___CSSZYX_CHECKSUM___');
        // The mangle map serializes to a JSON object literal.
        expect(jsChunk.code).toContain('var m={');
    });

    it('double-escapes the placeholder maps inside an eval-wrapped chunk', async () => {
        const h = await boot({
            production: { mangle: false },
            build: { emitManifest: true, parser: 'oxc', cache: false },
        });

        // Realistic webpack eval-devtool shape: the wrapper always stamps a
        // `//# sourceURL=webpack…` pragma inside the eval string. That pragma
        // is what identifies the wrapping — see the raw-eval test below.
        const jsChunk = {
            code: 'eval("var m=___CSSZYX_MANGLE_MAP___;var vm=___CSSZYX_VAR_MANGLE_MAP___;var c=___CSSZYX_CHECKSUM___;\\n//# sourceURL=webpack://app/./src/App.tsx")',
        };
        await h.renderChunk(jsChunk);

        expect(jsChunk.code).not.toContain('___CSSZYX_MANGLE_MAP___');
        expect(jsChunk.code).not.toContain('___CSSZYX_VAR_MANGLE_MAP___');
        // The eval branch escapes the JSON quotes for the outer double-quoted string.
        expect(jsChunk.code).toContain('eval(');
        expect(jsChunk.code).toContain('\\"');
    });

    it('keeps the map raw in a production chunk that merely CALLS eval', async () => {
        const h = await boot({
            production: { mangle: false },
            build: { emitManifest: true, parser: 'oxc', cache: false },
        });

        // A user eval CALL in the same chunk as the bundled mangle-runtime
        // module, whose map sits in identifier position (`const m = {…}`).
        // Double-escaping here would emit `const m = {\"…\"}` — a syntax
        // error that breaks the whole chunk at load.
        const jsChunk = {
            code: 'const dyn = () => eval("1");\nconst m = ___CSSZYX_MANGLE_MAP___;\nconst vm = ___CSSZYX_VAR_MANGLE_MAP___;\n',
        };
        await h.renderChunk(jsChunk);

        expect(jsChunk.code).not.toContain('___CSSZYX_MANGLE_MAP___');
        expect(jsChunk.code).not.toContain('\\"');
        // The inserted map must be directly parseable JS — extract and parse it.
        const inserted = jsChunk.code.match(/const m = (\{[^;]*\});/)?.[1];
        expect(inserted).toBeDefined();
        expect(() => JSON.parse(inserted as string)).not.toThrow();
    });
});
