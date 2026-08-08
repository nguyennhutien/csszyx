/**
 * The umbrella has to be importable from application code.
 *
 * `reference/runtime.mdx` teaches `import { szr, szcn } from 'csszyx'`, and
 * that line did not build in a browser bundle: the main entry re-exports the
 * COMPILER, which reaches `@csszyx/core/native`, a Node-only subpath. Bundlers
 * fail at RESOLVE — before tree-shaking gets a chance — so "just don't import
 * `transform`" was never a workaround.
 *
 * These tests bundle the real package specifier through esbuild's browser
 * platform, which applies the same condition set (`browser`, `module`,
 * `import`) that Vite/webpack/rollup apply to client code. Asserting the
 * package.json shape instead would only restate the fix; bundling exercises
 * the whole module graph, which is where the defect actually lived.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { build, type Metafile } from 'esbuild';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * Bundles a snippet as browser code, resolving bare specifiers from the repo
 * root so `csszyx` goes through its published `exports` map rather than a
 * relative path into `src/`.
 *
 * @param contents Module source to bundle.
 * @returns The bundle's metafile, whose `inputs` name every file pulled in.
 */
async function bundleForBrowser(contents: string): Promise<Metafile> {
    const result = await build({
        stdin: { contents, loader: 'ts', resolveDir: repoRoot },
        bundle: true,
        platform: 'browser',
        format: 'esm',
        write: false,
        metafile: true,
        // wasm-bindgen's bundler target imports the binary as a module; without
        // a loader esbuild fails on it for a reason unrelated to what is under
        // test here, which would make a pass/fail impossible to interpret.
        loader: { '.wasm': 'binary' },
        // The root tsconfig maps `@csszyx/*` at `packages/*/src`, which no
        // bundler applies to a dependency inside node_modules. Blanking it
        // keeps every hop on the published `exports` maps — the resolution
        // this test exists to pin.
        tsconfigRaw: '{}',
    });
    return result.metafile;
}

describe('csszyx browser entry', () => {
    it('bundles the authoring helpers as browser code', async () => {
        const metafile = await bundleForBrowser(
            "import { szcn, szr, szv } from 'csszyx';\nexport const used = [szcn, szr, szv];\n",
        );

        expect(Object.keys(metafile.inputs).length).toBeGreaterThan(0);
    });

    it('keeps the WASM core out of the browser graph', async () => {
        const metafile = await bundleForBrowser(
            "import { szcn } from 'csszyx';\nexport const used = szcn;\n",
        );

        // Re-exporting `@csszyx/core` costs ~337 kB here and does not shake
        // out: wasm-bindgen's generated module runs `__wbindgen_start()` at
        // load, so the binary is a live dependency of merely naming the entry.
        const wasmInputs = Object.keys(metafile.inputs).filter(input =>
            input.includes('packages/core/pkg'),
        );

        expect(wasmInputs).toEqual([]);
    });

    it('routes browser consumers to an entry the node entry does not share', () => {
        const manifest = JSON.parse(
            readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
        ) as { exports: Record<string, Record<string, string>> };
        const root = manifest.exports['.'];

        // The node entry keeps the compiler and plugin surface (pinned by
        // exports.test.ts). Browsers cannot run either, so the two conditions
        // must not collapse onto the same file.
        expect(root.browser).toBeDefined();
        expect(root.browser).not.toBe(root.import);
    });
});
