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

async function boot(options = {}): Promise<Booted> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-transform-edge-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
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
    it('returns null for a file that is neither a source nor a CSS module', async () => {
        const { root, transform } = await boot();
        const result = await transform('binary-bytes', path.join(root, 'src/logo.png'));
        expect(result).toBeNull();
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
        expect(result?.code).toContain('csszyx-classes.html');
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
        // the checksum placeholder and the debug script after <body>.
        expect(result?.code).toContain('data-sz-cs="___CSSZYX_CHECKSUM___"');
        expect(result?.code).toContain('window.__csszyx');
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
});
