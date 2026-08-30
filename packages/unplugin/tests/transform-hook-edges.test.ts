/**
 * Branch edges of the pre-plugin `transform` hook driven through the real vite
 * plugin object: the non-source/non-css early return, the Vue and Svelte SFC
 * adapter branches, and the CSS `@source` injection path (tailwind entry +
 * content scope + an injectable discovered class).
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

type Ctx = { warn: (m: string) => void; error: (m: string) => void };

interface Booted {
    root: string;
    transform: (code: string, id: string) => Promise<unknown>;
}

async function boot(options = {}, files: Record<string, string> = {}): Promise<Booted> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-transform-edge-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    // On disk before `configResolved`: the build settles the mangle map from
    // the prescan, so a module the prescan never walked never reaches the map.
    for (const [file, source] of Object.entries(files)) {
        fs.writeFileSync(path.join(root, file), source, 'utf8');
    }
    const plugins = vitePlugin(options);
    const ctx: Ctx = { warn() {}, error() {} };
    const invoke = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
        const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
        if (!plugin) return undefined;
        const hook = (plugin as Record<string, unknown>)[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(ctx, args) : undefined;
    };
    await invoke('configResolved', { root, command: 'build' });
    return {
        root,
        transform: (code: string, id: string) => invoke('transform', code, id),
    };
}

describe('transform hook branch edges', () => {
    it('skips a file that is neither a source nor a CSS module', async () => {
        const { root, transform } = await boot();
        const result = await transform('binary-bytes', path.join(root, 'src/logo.png'));
        // unplugin v3 short-circuits transformInclude misses to undefined;
        // bundlers treat undefined and null the same (no-op).
        expect(result).toBeUndefined();
    });

    it('transforms sz props in a Vue SFC', async () => {
        const { root, transform } = await boot();
        const result = (await transform(
            '<template><div :sz="{ p: 4 }" /></template>',
            path.join(root, 'src/Comp.vue'),
        )) as { code: string } | null;
        expect(result).not.toBeNull();
        expect(result?.code).toContain('p-4');
        expect(result?.code).not.toContain(':sz=');
    });

    it('transforms sz props in a Svelte component', async () => {
        const { root, transform } = await boot();
        const result = (await transform(
            '<div sz="{{ p: 4 }}"></div>',
            path.join(root, 'src/Comp.svelte'),
        )) as { code: string } | null;
        expect(result).not.toBeNull();
        expect(result?.code).toContain('p-4');
    });

    it('injects a @source directive into a scoped tailwind entry once a class is discovered', async () => {
        const { root, transform } = await boot();
        // First transform an sz source so a discovered class exists in state.
        await transform(
            'export const App = () => <div sz={{ m: 3 }} />;',
            path.join(root, 'src/App.tsx'),
        );
        const css = '@import "tailwindcss" source(none);\n@source ".";\n';
        const result = (await transform(css, path.join(root, 'src/styles.css'))) as {
            code: string;
        } | null;
        expect(result).not.toBeNull();
        expect(result?.code).toContain('@source');
        // The injected directive points at the generated safelist file.
        expect(result?.code).toContain('.csszyx/csszyx-classes.txt');
    });

    it('injects the color-var runtime helper when a dynamic color is used', async () => {
        const { root, transform } = await boot();
        const result = (await transform(
            'const A = () => <div sz={{ color: dynamicColor }} />;',
            path.join(root, 'src/Dyn.tsx'),
        )) as { code: string } | null;
        expect(result).not.toBeNull();
        expect(result?.code).toContain('__szColorVar');
        expect(result?.code).toContain("from '@csszyx/runtime'");
    });

    // The spacing/unit-var cases pin the oxc parser: the default rust lane
    // resolves to whatever engine binary is installed, which may predate the
    // __szSpacingVar/__szUnitVar emission these cases exercise.
    it('injects the spacing-var runtime helper when a dynamic spacing value is used', async () => {
        const { root, transform } = await boot({ build: {} });
        const result = (await transform(
            'export const A = ({w}) => <div sz={{ w }} />;',
            path.join(root, 'src/DynSpacing.tsx'),
        )) as { code: string } | null;
        expect(result).not.toBeNull();
        expect(result?.code).toContain('__szSpacingVar');
        expect(result?.code).toContain("from '@csszyx/runtime'");
        // The other dynamic-value helpers are not used, so not imported.
        expect(result?.code).not.toContain('__szColorVar');
        expect(result?.code).not.toContain('__szUnitVar');
    });

    it('injects the unit-var runtime helper when a dynamic angle value is used', async () => {
        const { root, transform } = await boot({ build: {} });
        const result = (await transform(
            'export const B = ({angle}) => <div sz={{ rotate: angle }} />;',
            path.join(root, 'src/DynUnit.tsx'),
        )) as { code: string } | null;
        expect(result).not.toBeNull();
        expect(result?.code).toContain('__szUnitVar');
        expect(result?.code).toContain("from '@csszyx/runtime'");
        expect(result?.code).not.toContain('__szSpacingVar');
    });

    it('appends the spacing-var helper to an existing @csszyx/runtime import', async () => {
        const { root, transform } = await boot({ build: {} });
        const result = (await transform(
            "import { _sz } from '@csszyx/runtime';\nconst A = ({w}) => <div sz={{ w }} />;",
            path.join(root, 'src/DynSpacing2.tsx'),
        )) as { code: string } | null;
        expect(result).not.toBeNull();
        // The helper is merged into the existing import clause, not a new line.
        expect(result?.code).toMatch(
            /import\s*\{[^}]*_sz[^}]*__szSpacingVar[^}]*\}\s*from\s*'@csszyx\/runtime'/,
        );
    });

    it('does not re-import an already-imported unit-var helper', async () => {
        const { root, transform } = await boot({ build: {} });
        const result = (await transform(
            "import { __szUnitVar } from '@csszyx/runtime';\nconst B = ({ms}) => <div sz={{ duration: ms }} />;",
            path.join(root, 'src/DynUnit2.tsx'),
        )) as { code: string } | null;
        expect(result).not.toBeNull();
        // The compiled call site remains, but no second import is added:
        // exactly one import clause names the helper (the pre-existing one).
        expect(result?.code).toContain('__szUnitVar(');
        expect(result?.code.match(/import\s*\{[^}]*__szUnitVar[^}]*\}/g)).toHaveLength(1);
    });

    it('injects the szcn and szPart helpers for an array/szv sz prop', async () => {
        const { root, transform } = await boot();
        const result = (await transform(
            'const A = () => <div sz={[base, { p: 4 }]} />;',
            path.join(root, 'src/Arr.tsx'),
        )) as { code: string } | null;
        expect(result).not.toBeNull();
        expect(result?.code).toContain('_szcn');
        expect(result?.code).toContain('_szPart');
    });

    it('appends the color-var helper to an existing @csszyx/runtime import', async () => {
        const { root, transform } = await boot();
        const result = (await transform(
            "import { _sz } from '@csszyx/runtime';\nconst A = () => <div sz={{ color: dynamicColor }} />;",
            path.join(root, 'src/Dyn2.tsx'),
        )) as { code: string } | null;
        expect(result).not.toBeNull();
        // The helper is merged into the existing import clause, not a new line.
        expect(result?.code).toMatch(
            /import\s*\{[^}]*_sz[^}]*__szColorVar[^}]*\}\s*from\s*'@csszyx\/runtime'/,
        );
    });

    it('extracts classes from a non-sz className expression without rewriting the code', async () => {
        const { root, transform } = await boot();
        // A nested `{}` inside the expression and a single-quoted branch string
        // exercise the balanced-brace scan and the single-quote capture group.
        const code =
            'export const X = () => <div className="static-a static-b"><span className={flag ? styles({}) : \'dyn-single more-cls\'} /></div>;';
        const result = (await transform(code, path.join(root, 'src/Plain.tsx'))) as {
            code: string;
        } | null;
        // The file is scanned for the safelist (both static and expression
        // class strings) but its author classes are returned untouched.
        expect(result).not.toBeNull();
        expect(result?.code).toBe(code);
    });

    it('does not inject into a CSS module that never imports tailwind', async () => {
        const { root, transform } = await boot();
        await transform(
            'export const App = () => <div sz={{ m: 3 }} />;',
            path.join(root, 'src/App.tsx'),
        );
        const result = await transform('.foo { color: red; }', path.join(root, 'src/plain.css'));
        expect(result).toBeNull();
    });

    it('injects the minified checksum attribute into a layout <html> tag', async () => {
        const { root, transform } = await boot({ production: { minify: true } });
        const code =
            'export default function RootLayout(){return <html lang="en"><body>x</body></html>;}';
        const result = (await transform(code, path.join(root, 'app/layout.tsx'))) as {
            code: string;
        } | null;
        expect(result).not.toBeNull();
        // production.minify shortens the attribute name to data-sz-cs and injects
        // the checksum placeholder. Nothing executable: the inline installer a
        // strict CSP refuses (field-reported) is gone from every lane.
        expect(result?.code).toContain('data-sz-cs="___CSSZYX_CHECKSUM___"');
        expect(result?.code).not.toContain('window.__csszyx');
    });

    it('injects the inert census into a layout so the map is readable from the DOM', async () => {
        const { root, transform } = await boot(
            { production: { mangle: true } },
            { 'src/A.tsx': 'export const A = () => <div sz={{ p: 4 }} />;' },
        );
        const code =
            'export default function RootLayout(){return <html lang="en"><body>x</body></html>;}';
        const result = (await transform(code, path.join(root, 'app/layout.tsx'))) as {
            code: string;
        } | null;
        // Data, not script: this is the payload `verifyMangleMapIntegrity()`
        // reads from the DOM, and it is what makes a mangled class traceable
        // back to its original name in devtools without a rebuild. The vite
        // lane emits it from `transformIndexHtml`; this lane had neither.
        expect(result?.code).toContain('id="__CSSZYX_MANGLE_MAP__"');
        expect(result?.code).toContain('type="application/json"');
        expect(result?.code).toContain('___CSSZYX_CENSUS___');
    });

    it('never installs the map from the layout, even on a mangled build with a census', async () => {
        const { root, transform } = await boot(
            { production: { mangle: true } },
            { 'src/A.tsx': 'export const A = () => <div sz={{ p: 4 }} />;' },
        );
        const code =
            'export default function RootLayout(){return <html lang="en"><body>x</body></html>;}';
        const result = (await transform(code, path.join(root, 'app/layout.tsx'))) as {
            code: string;
        } | null;
        // The map reaches the page through the bundle on every lane; the
        // layout carries the checksum attribute and inert data only.
        expect(result?.code).toContain('data-sz-checksum="___CSSZYX_CHECKSUM___"');
        expect(result?.code).not.toContain('window.__csszyx');
        expect(result?.code).not.toMatch(/<script(?![^>]*application\/json)/i);
    });

    it('injects the checksum attribute into a layout with no <body> tag', async () => {
        const { root, transform } = await boot();
        // No <body>: the body-tag lookup returns null and only the <html>
        // attribute is injected.
        const code = 'export default function Doc(){return <html lang="en"></html>;}';
        const result = (await transform(code, path.join(root, 'app/layout.tsx'))) as {
            code: string;
        } | null;
        expect(result).not.toBeNull();
        expect(result?.code).toContain('data-sz-checksum="___CSSZYX_CHECKSUM___"');
        expect(result?.code).not.toContain('window.__csszyx');
    });

    it('does not scan past an unterminated layout html opening tag', async () => {
        const { root, transform } = await boot();
        const code = 'export default function Doc(){return <html';
        const result = (await transform(code, path.join(root, 'app/layout.tsx'))) as {
            code: string;
        } | null;
        expect(result?.code).toBe(code);
    });

    it('skips body-prefixed custom elements before the real body tag', async () => {
        const { root, transform } = await boot();
        const code =
            'export default function Doc(){return <html><bodyguard /><body>x</body></html>;}';
        const result = (await transform(code, path.join(root, 'app/layout.tsx'))) as {
            code: string;
        } | null;
        expect(result?.code).toContain('<html data-sz-checksum="___CSSZYX_CHECKSUM___">');
        expect(result?.code).toContain('<bodyguard /><body><script id="__CSSZYX_MANGLE_MAP__"');
    });
});
