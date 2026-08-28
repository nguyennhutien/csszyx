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
 *   1. the native and wasm builds produce identical artifacts (JS + CSS + HTML map);
 *   2. the injected mangle map is bijective and covers every owned class;
 *   3. owned classes are actually mangled OUT of the JS bundle and the CSS
 *      selectors, and the map decodes every token back to its original;
 *   4. non-owned (app) classes are never touched;
 *   5. szcn dedupes mangled tokens through the real `__csszyx.decode` bridge
 *      built from the extracted map (the field acceptance for merge parity).
 */
import { clearMangleRegistry, installMangleRuntime, szcn } from '@csszyx/runtime';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadNativeBinding } from '../../core/native/index.js';
import { escapeJsonForInlineScript } from '../src/inline-script-escape.js';
import { buildViteApp, cleanupViteAppBuilds } from './vite-app-build.js';

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

/**
 * Build the fixture app with production mangling and extract the artifacts.
 *
 * @param parser - engine under test.
 * @returns normalized JS + CSS output and the mangle map from the built HTML.
 */
async function buildWithMangle(parser: 'rust' | 'wasm'): Promise<MangleArtifacts> {
    const built = await buildViteApp({
        name: `mangle-rt-${parser}`,
        files: FIXTURE_FILES,
        plugin: { build: { parser }, production: { mangle: true } },
    });
    // The canonical payload is the inert __CSSZYX_MANGLE_MAP__ census: it is
    // the one form present in every delivery mode.
    if (built.map === null) {
        throw new Error(`no mangle map census injected into the built HTML (${parser})`);
    }
    return { js: built.js, css: built.css, map: built.map };
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
    let wasm: MangleArtifacts;
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
            wasm = await buildWithMangle('wasm');
        } finally {
            warnSpy.mockRestore();
        }
    }, 60_000);

    afterAll(() => {
        cleanupViteAppBuilds();
    });

    it('both engine builds produce the identical mangle map', () => {
        expect(rust.map).toEqual(wasm.map);
    });

    it('both engine builds produce identical JS and CSS artifacts', () => {
        expect(rust.js).toBe(wasm.js);
        expect(rust.css).toBe(wasm.css);
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

    it('the bundle registers the runtime mangle map itself, never through window.__csszyx', () => {
        // Field-reported twice: an embedded build served by a host shell never
        // loads the transformed index.html, and a strict CSP refuses an inline
        // installer. The bundle itself must therefore carry the registration —
        // through the runtime registry, not a debug global.
        expect(rust.js, 'registry install must be bundled').toContain('installMangleRuntime(');
        expect(rust.js, 'no window global by default').not.toMatch(/window\.__csszyx\s*=/);
        expect(rust.js).toContain('exposeDebugGlobal: false');
        // The bundled map must be the FINAL map — the same entries the census
        // carries — substituted after the mangle passes, so its keys are
        // original class names, not re-mangled tokens.
        expect(collapseWhitespace(rust.js), 'bundled map must be the final census map').toContain(
            collapseWhitespace(escapeJsonForInlineScript(JSON.stringify(rust.map))),
        );
        expect(rust.js, 'placeholders must be substituted').not.toContain('___CSSZYX_');
        expect(wasm.js, 'registration must be parser-independent').toContain(
            'installMangleRuntime(',
        );
    });

    it('szcn dedupes mangled tokens through the registry built from the map', () => {
        // Install exactly what the bundled module installs at runtime.
        installMangleRuntime({ mangleMap: rust.map, checksum: 'round-trip' });
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
            clearMangleRegistry();
        }
    });
});
