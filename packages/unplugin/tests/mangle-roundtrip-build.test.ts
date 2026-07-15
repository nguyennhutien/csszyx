/**
 * Production-mangle round-trip over a REAL vite app build, per engine.
 *
 * The mangle layer has plenty of unit nets (css-mangler, ownership, hybrid
 * hazards, Pass 1–4) but had no whole-pipeline net: nothing built an app with
 * mangling on and asserted that the map injected into the HTML, the rewritten
 * CSS selectors, and the mangled class strings in the JS bundle all agree —
 * per engine AND across engines. Two historical field reports (prod-mangle
 * hybrid breakage) came from exactly this layer.
 *
 * Round-trip contract asserted here:
 *   1. rust and oxc produce identical artifacts (JS + CSS + HTML map);
 *   2. the injected mangle map is bijective and covers every owned class;
 *   3. owned classes are actually mangled OUT of the JS bundle and the CSS
 *      selectors, and the map decodes every token back to its original;
 *   4. non-owned (app) classes are never touched;
 *   5. szcn dedupes mangled tokens through the real `__csszyx.decode` bridge
 *      built from the extracted map (the field acceptance for merge parity).
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
import { basename, join } from 'node:path';

import { szcn } from '@csszyx/runtime';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadNativeBinding } from '../../core/native/index.js';
import { vitePlugin } from '../src/unplugin.js';

const FIXTURE_FILES: Record<string, string> = {
    'index.html': `<!doctype html>
<html><head></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>
`,
    'src/main.ts': `
import './styles.css';
import { App } from './App.tsx';
// Side effect so the component (and its class strings) survive tree-shaking.
document.body.textContent = JSON.stringify(App({ wide: false }));
`,
    // `p-4` is deliberately shared by sz and a mixed raw clsx string. It must
    // stay readable while sz-only utilities still take the optimized path.
    'src/App.tsx': `
const clsx = (...values) => values.filter(Boolean).join(' ');
export const App = ({ wide }) => (
    <div className={clsx('p-4 dems-panel', wide ? 'wide-panel' : undefined)} sz={{ p: 4, m: 3, mx: 0 }}>
        <span sz={{ mx: 4, color: 'red-500', hover: { bg: 'zinc-100' } }} />
    </div>
);
`,
    // Handwritten rules for owned classes — the css-mangler must rewrite these
    // selectors to the mangled tokens; the app-owned selector stays.
    'src/styles.css': `
.mx-0 { margin-left: 0; }
.mx-4 { margin-left: 1rem; }
.p-4 { padding: 1rem; }
.m-3 { margin: .75rem; }
.text-red-500 { color: red; }
.dems-panel { border: 1px solid; }
`,
};

interface MangleArtifacts {
    js: string;
    css: string;
    map: Record<string, string>;
}

const tempDirs: string[] = [];

/**
 * Build the fixture app with production mangling and extract the artifacts.
 *
 * @param parser - engine under test.
 * @returns normalized JS + CSS output and the mangle map from the built HTML.
 */
async function buildWithMangle(parser: 'rust' | 'oxc' | 'babel'): Promise<MangleArtifacts> {
    // realpath the temp root so the path handed to vite matches the realpath
    // vite's build-html plugin resolves internally. On macOS os.tmpdir() is a
    // /var -> /private/var symlink; without this the emitted index.html name is
    // computed relative to the un-realpath'd root and escapes the bundle dir
    // (same guard as vite-global-var.test.ts).
    const root = mkdtempSync(join(realpathSync(tmpdir()), `csszyx-mangle-rt-${parser}-`));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    for (const [file, source] of Object.entries(FIXTURE_FILES)) {
        writeFileSync(join(root, file), source, 'utf8');
    }

    await build({
        root,
        logLevel: 'silent',
        plugins: [vitePlugin({ build: { parser, cache: false }, production: { mangle: true } })],
        esbuild: {
            jsx: 'transform',
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            jsxInject: 'const h = (t, p, ...c) => ({ t, p, c }); const Fragment = "f";',
        },
        build: {
            minify: false,
            rollupOptions: { external: ['@csszyx/runtime', 'csszyx'] },
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
        throw new Error(`vite build (${parser}) produced empty assets in ${assetsDir}`);
    }

    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
    const mapSource = html.match(/var m=(\{[^;]*?\});/)?.[1];
    if (!mapSource) {
        throw new Error(`no mangle map script injected into the built HTML (${parser})`);
    }
    return { js, css, map: JSON.parse(mapSource) as Record<string, string> };
}

const OWNED_CLASSES = ['m-3', 'mx-0', 'mx-4', 'text-red-500', 'hover:bg-zinc-100'];

describe('production mangle — real-build round-trip (rust vs oxc)', () => {
    let rust: MangleArtifacts;
    let oxc: MangleArtifacts;
    let babel: MangleArtifacts;

    beforeAll(async () => {
        loadNativeBinding();
        rust = await buildWithMangle('rust');
        oxc = await buildWithMangle('oxc');
        babel = await buildWithMangle('babel');
    }, 60_000);

    afterAll(() => {
        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('both engines produce the identical mangle map', () => {
        expect(rust.map).toEqual(oxc.map);
        expect(rust.map).toEqual(babel.map);
    });

    it('both engines produce identical JS and CSS artifacts', () => {
        expect(rust.js).toBe(oxc.js);
        expect(rust.css).toBe(oxc.css);
        expect(rust.css).toBe(babel.css);
    });

    it('the map covers every owned class and is bijective', () => {
        for (const cls of OWNED_CLASSES) {
            expect(Object.keys(rust.map), `map must contain ${cls}`).toContain(cls);
        }
        const tokens = Object.values(rust.map);
        expect(new Set(tokens).size, 'mangled tokens must not collide').toBe(tokens.length);
        expect(rust.map['p-4'], 'shared raw/sz class must remain readable').toBeUndefined();
    });

    it('owned classes are mangled out of the JS bundle, tokens are in', () => {
        for (const cls of OWNED_CLASSES) {
            const token = rust.map[cls];
            expect(token).toBeTruthy();
            expect(rust.js, `${cls} must not ship un-mangled`).not.toContain(`"${cls}"`);
            expect(rust.js, `token for ${cls} must be referenced`).toContain(token as string);
        }
    });

    it('CSS selectors are rewritten per the same map; app classes untouched', () => {
        for (const cls of ['m-3', 'mx-0', 'mx-4', 'text-red-500']) {
            const token = rust.map[cls];
            expect(rust.css, `selector .${cls} must be rewritten`).not.toContain(`.${cls} `);
            expect(rust.css, `selector for ${cls} token must exist`).toContain(`.${token}`);
        }
        expect(rust.css, 'non-owned app selector must survive').toContain('.dems-panel');
        expect(rust.js, 'non-owned app class string must survive').toContain('dems-panel');
        expect(rust.css, 'shared selector must survive').toContain('.p-4');
        expect(rust.js, 'mixed clsx token must survive').toContain('p-4 dems-panel');
    });

    it('szcn dedupes mangled tokens through the decode bridge built from the map', () => {
        // Reconstruct exactly what the injected inline script builds at runtime
        // (in a browser `window` IS `globalThis`, which is what szcn reads).
        const reverse = new Map(Object.entries(rust.map).map(([orig, tok]) => [tok, orig]));
        (globalThis as { __csszyx?: unknown }).__csszyx = {
            mangleMap: rust.map,
            decode: (token: string) => reverse.get(token),
            encode: (cls: string) => rust.map[cls],
        };
        try {
            const mx0 = rust.map['mx-0'] as string;
            const mx4 = rust.map['mx-4'] as string;
            // Same utility, later wins — while both stay mangled in the output.
            expect(szcn(mx0, mx4)).toBe(mx4);
            expect(szcn(mx4, mx0)).toBe(mx0);
            // Different utilities co-exist.
            const red = rust.map['text-red-500'] as string;
            expect(szcn(mx0, red)).toBe(`${mx0} ${red}`);
        } finally {
            (globalThis as { __csszyx?: unknown }).__csszyx = undefined;
        }
    });
});
