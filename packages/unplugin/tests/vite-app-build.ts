/**
 * Build a small Vite application through the REAL plugin and read the
 * artifacts back.
 *
 * Several suites need the whole pipeline rather than a hook: the mangle
 * round-trip, the CSP contract of the emitted HTML, and the module-graph
 * delivery of the runtime mangle map. Each of them used to carry its own copy
 * of the temp-root + Tailwind `source(none)` + `vite build` dance; this is the
 * one copy.
 *
 * NOT a `.test.ts` file, like `fixture-root.ts`: vitest must not collect it.
 */
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { PartialCsszyxConfig } from '@csszyx/types';
import { compile } from '@tailwindcss/node';
import { build, type Plugin } from 'vite';
import { SAFELIST_HEADER } from '../src/safelist-format.js';
import { vitePlugin } from '../src/unplugin.js';

export { executableInlineScripts } from './executable-inline-scripts.js';

/** Artifacts of one fixture build. */
export interface ViteAppBuild {
    /** Fixture root (already realpath'd). */
    root: string;
    /** Built `dist/index.html`. */
    html: string;
    /** Every emitted JS chunk, concatenated, with the temp root normalized. */
    js: string;
    /** Every emitted CSS asset, concatenated. */
    css: string;
    /** The class map read from the inert `__CSSZYX_MANGLE_MAP__` census, or null. */
    map: Record<string, string> | null;
}

/** What to build. */
export interface ViteAppBuildOptions {
    /** Temp-root prefix, unique per suite. */
    name: string;
    /** Fixture files, paths relative to the root. */
    files: Record<string, string>;
    /** Plugin options; `build.cache` is forced off so runs never share state. */
    plugin?: PartialCsszyxConfig;
}

const tempDirs: string[] = [];

/**
 * Compile the fixture's `source(none)` stylesheet from csszyx's exact safelist.
 *
 * Tailwind receives candidates only through the safelist csszyx writes, which
 * is the deployment shape that had the hybrid-mangle hazards.
 *
 * @param root Fixture root containing .csszyx/csszyx-classes.txt.
 * @returns Vite transform plugin standing in for Tailwind's final CSS phase.
 */
export function tailwindSourceNonePlugin(root: string): Plugin {
    return {
        name: 'fixture-tailwind-source-none',
        enforce: 'pre',
        async transform(code, id) {
            if (!id.endsWith('/src/styles.css')) return null;
            const compiler = await compile(code, {
                base: process.cwd(),
                onDependency: () => undefined,
            });
            const safelist = readFileSync(join(root, '.csszyx/csszyx-classes.txt'), 'utf8');
            const candidates = safelist.slice(SAFELIST_HEADER.length).split(/\s+/).filter(Boolean);
            return { code: compiler.build(candidates), map: null };
        },
    };
}

/**
 * The class map carried by the inert JSON census tag, or null when absent.
 *
 * Builds with variable mangling namespace the keys (`class:` / `var:`); the
 * prefix is stripped so callers see plain class names.
 *
 * @param html Built HTML.
 * @returns Original class → token, or null when the census tag is missing.
 */
export function readMangleMapFromHtml(html: string): Record<string, string> | null {
    const source = html.match(
        /<script id="__CSSZYX_MANGLE_MAP__" type="application\/json">([^<]*)<\/script[^>]*>/i,
    )?.[1];
    if (source === undefined) return null;
    const payload = JSON.parse(source) as Record<string, string>;
    return Object.fromEntries(
        Object.entries(payload)
            .filter(([key]) => !key.startsWith('var:'))
            .map(([key, value]) => [key.replace(/^class:/, ''), value]),
    );
}

/**
 * Write the fixture, build it, and read the artifacts.
 *
 * @param options What to build.
 * @returns The built artifacts.
 */
export async function buildViteApp(options: ViteAppBuildOptions): Promise<ViteAppBuild> {
    // realpath the temp root so the path handed to vite matches the realpath
    // vite's build-html plugin resolves internally. On macOS os.tmpdir() is a
    // /var -> /private/var symlink; without this the emitted index.html name is
    // computed relative to the un-realpath'd root and escapes the bundle dir.
    const root = mkdtempSync(join(realpathSync(tmpdir()), `csszyx-${options.name}-`));
    tempDirs.push(root);
    for (const [file, source] of Object.entries(options.files)) {
        mkdirSync(join(root, dirname(file)), { recursive: true });
        writeFileSync(join(root, file), source, 'utf8');
    }

    const plugin = options.plugin ?? {};
    await build({
        root,
        logLevel: 'silent',
        plugins: [
            vitePlugin({ ...plugin, build: { ...plugin.build, cache: false } }),
            tailwindSourceNonePlugin(root),
        ],
        esbuild: {
            jsx: 'transform',
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            jsxInject: 'const h = (t, p, ...c) => ({ t, p, c }); const Fragment = "f";',
        },
        build: {
            minify: false,
            rollupOptions: { external: [/^@csszyx\/runtime(?:\/|$)/, 'csszyx'] },
        },
    });

    const assetsDir = join(root, 'dist', 'assets');
    const assets = readdirSync(assetsDir).sort();
    const readAll = (ext: string): string =>
        assets
            .filter(f => f.endsWith(ext))
            .map(f => readFileSync(join(assetsDir, f), 'utf8'))
            .join('\n');
    const js = readAll('.js').split(basename(root)).join('FIXTURE-ROOT');
    const css = readAll('.css');
    if (js.length === 0 || css.length === 0) {
        throw new Error(`vite build produced empty assets in ${assetsDir}`);
    }
    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
    return { root, html, js, css, map: readMangleMapFromHtml(html) };
}

/** Remove every temp root this process built. Call from `afterAll`. */
export function cleanupViteAppBuilds(): void {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
}
