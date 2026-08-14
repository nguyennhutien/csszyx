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
 *   1. rust, oxc, and babel produce identical artifacts (JS + CSS + HTML map);
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
import { compile } from '@tailwindcss/node';
import { build, type Plugin } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadNativeBinding } from '../../core/native/index.js';
import { escapeJsonForInlineScript } from '../src/inline-script-escape.js';
import { vitePlugin } from '../src/unplugin.js';

const FIXTURE_FILES: Record<string, string> = {
    'index.html': `<!doctype html>
<html><head></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>
`,
    'src/main.ts': `
import './styles.css';
import { szr } from '@csszyx/runtime';
import { App } from './App.tsx';
// Side effect so the component (and its class strings) survive tree-shaking.
document.body.textContent = JSON.stringify(App({ wide: false }));
// Runtime helper consumer: the build must deliver the mangle map to this
// module through the bundle itself, not only through the HTML document.
document.body.dataset.cls = szr({ mx: 0 });
// A user eval CALL in the bundle must not trip the webpack-eval-devtool
// escaping heuristic: the bundled map sits in identifier position, and
// double-escaping it there is a syntax error in the emitted chunk.
export const dyn = () => eval('0');
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
    // Tailwind receives candidates only through csszyx's generated safelist.
    // The custom app-owned selector must stay readable.
    'src/styles.css': `
@import "tailwindcss" source(none);
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
 * Compile the fixture's source(none) stylesheet from csszyx's exact safelist.
 *
 * @param root Fixture root containing csszyx-classes.html.
 * @returns Vite transform plugin standing in for Tailwind's final CSS phase.
 */
function tailwindSourceNonePlugin(root: string): Plugin {
    return {
        name: 'fixture-tailwind-source-none',
        enforce: 'pre',
        async transform(code, id) {
            if (!id.endsWith('/src/styles.css')) return null;
            const compiler = await compile(code, {
                base: process.cwd(),
                onDependency: () => undefined,
            });
            const safelist = readFileSync(join(root, 'csszyx-classes.html'), 'utf8');
            const candidates = (
                safelist.split('<!-- csszyx exact scanner candidates -->\n')[1] ?? ''
            )
                .split(/\s+/)
                .filter(Boolean);
            return { code: compiler.build(candidates), map: null };
        },
    };
}

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
        plugins: [
            vitePlugin({ build: { parser, cache: false }, production: { mangle: true } }),
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
    // The canonical payload is the __CSSZYX_MANGLE_MAP__ JSON tag: on
    // class-only builds the installer re-reads it instead of embedding a
    // second `var m={…}` literal, so the tag is the only form present in
    // every variant. Builds with variable mangling namespace its keys with
    // `class:`; strip that so the assertions below see plain class names.
    const mapSource = html.match(
        /<script id="__CSSZYX_MANGLE_MAP__" type="application\/json">([^<]*)<\/script>/,
    )?.[1];
    if (!mapSource) {
        throw new Error(`no mangle map script injected into the built HTML (${parser})`);
    }
    const payload = JSON.parse(mapSource) as Record<string, string>;
    const map = Object.fromEntries(
        Object.entries(payload)
            .filter(([key]) => !key.startsWith('var:'))
            .map(([key, value]) => [key.replace(/^class:/, ''), value]),
    );
    return { js, css, map };
}

const OWNED_CLASSES = ['m-3', 'mx-0', 'mx-4', 'text-red-500', 'hover:bg-zinc-100'];

/**
 * Drop every space, tab and newline so a JS object literal reads as its JSON.
 *
 * The chunk rewrite runs in `renderChunk` — before the filename hash is taken,
 * which is the whole point — and the bundler pretty-prints what that hook
 * returns. The bundled map is therefore the same entries in the same order as
 * the HTML tag, laid out over several lines rather than as one compact literal.
 * Class names and tokens contain no whitespace, so collapsing it compares the
 * payload without depending on the printer.
 *
 * @param text Source text.
 * @returns The text with all whitespace removed.
 */
function collapseWhitespace(text: string): string {
    return text.replaceAll(/[\t\n\r ]/g, '');
}

/**
 * Blank out the self-installed map literal so the rest of the chunk can be
 * checked for class names that escaped mangling.
 *
 * @param js Bundled JavaScript.
 * @param map The final class → token map.
 * @returns The chunk with the bundled map replaced by a marker.
 */
function withoutBundledMap(js: string, map: Record<string, string>): string {
    const literal = collapseWhitespace(escapeJsonForInlineScript(JSON.stringify(map)));
    return collapseWhitespace(js).split(literal).join('__BUNDLED_MAP__');
}

describe('production mangle — real-build round-trip (all parsers)', () => {
    let rust: MangleArtifacts;
    let oxc: MangleArtifacts;
    let babel: MangleArtifacts;
    const buildWarnings: string[] = [];

    beforeAll(async () => {
        loadNativeBinding();
        const originalWarn = console.warn;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
            buildWarnings.push(args.map(String).join(' '));
            originalWarn(...args);
        });
        try {
            rust = await buildWithMangle('rust');
            oxc = await buildWithMangle('oxc');
            babel = await buildWithMangle('babel');
        } finally {
            warnSpy.mockRestore();
        }
    }, 60_000);

    afterAll(() => {
        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('all parsers produce the identical mangle map', () => {
        expect(rust.map).toEqual(oxc.map);
        expect(rust.map).toEqual(babel.map);
    });

    it('all parsers produce identical JS and CSS artifacts', () => {
        expect(rust.js).toBe(oxc.js);
        expect(rust.css).toBe(oxc.css);
        expect(rust.css).toBe(babel.css);
    });

    it('source(none) safelisting emits every owned CSS rule without hybrid hazards', () => {
        expect(
            buildWarnings.filter(message => message.includes('production mangle found')),
        ).toEqual([]);
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
        // The self-installed runtime map legitimately carries every original
        // name as a key; remove that one literal before asserting no other
        // un-mangled occurrence survives in code.
        const jsSansMap = withoutBundledMap(rust.js, rust.map);
        for (const cls of OWNED_CLASSES) {
            const token = rust.map[cls];
            expect(token).toBeTruthy();
            expect(jsSansMap, `${cls} must not ship un-mangled`).not.toContain(`"${cls}"`);
            expect(jsSansMap, `token for ${cls} must be referenced`).toContain(token as string);
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

    it('the bundle self-installs the runtime mangle map for pages without the HTML script', () => {
        // Field-reported: an embedded build served by a host shell never loads
        // the transformed index.html, so the inline map script is absent and
        // runtime-resolved classes reach the DOM unmangled while the CSS ships
        // mangled. The bundle itself must therefore carry the installer.
        expect(rust.js, 'self-installer must be bundled').toMatch(/window\.__csszyx\s*=/);
        expect(rust.js, 'installer must never clobber the HTML script').toMatch(
            /typeof window\s*!==\s*["']undefined["']\s*&&\s*!window\.__csszyx/,
        );
        // The bundled map must be the FINAL map — the same entries the HTML
        // script carries — substituted after the mangle passes, so its keys
        // are original class names, not re-mangled tokens.
        expect(collapseWhitespace(rust.js), 'bundled map must be the final HTML map').toContain(
            collapseWhitespace(escapeJsonForInlineScript(JSON.stringify(rust.map))),
        );
        expect(rust.js, 'placeholders must be substituted').not.toContain('___CSSZYX_');
        expect(oxc.js, 'installer must be parser-independent').toMatch(/window\.__csszyx\s*=/);
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
