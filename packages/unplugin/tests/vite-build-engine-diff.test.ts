/**
 * Real-build engine diff: run `vite build` twice over the same fixture app —
 * once per engine — and assert BOTH artifacts match: the emitted bundle and the
 * safelist. The prescan parity harness covers the scan pipeline; this covers
 * the layer it cannot see — what the transform actually EMITS into production
 * output (the vui 0.10.10 CRITICAL was exactly there: the oxc static path
 * deleted className expressions from the bundle while every scan looked fine).
 *
 * No browser, no playground: programmatic vite, a dependency-free JSX factory
 * injected via esbuild, and csszyx runtime imports left external.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadNativeBinding } from '../../core/native/index.js';
import { vitePlugin } from '../src/unplugin.js';

const FIXTURE_FILES: Record<string, string> = {
    // Field shape: className EXPRESSION + static sz — the expression must
    // survive into the production bundle as a runtime merge.
    'src/App.tsx': `
export const App = ({ isMobile }) => (
    <div className={isMobile ? undefined : 'dems-panel'} sz={{ p: 4 }}>
        <span sz={{ color: 'red-500', hover: { bg: 'zinc-100' } }} />
        <div sz={{
            '[&_.tab-item-header]': { py: '0!' },
            '[&>span]': { text: 'sm' },
            '[&[data-state="open"]]': { bg: 'brand' },
        }} />
    </div>
);
`,
    // Plain-JSX module flavour (the scan-level .js trap lives in the prescan
    // parity harness; rolldown itself requires explicit config for JSX in .js,
    // which is an app-level concern).
    'src/toolbar.jsx': `
export const Toolbar = () => <div className="toolbar" sz={{ mx: 0 }} />;
`,
    // szv table behind `satisfies` — extraction must survive TS wrappers.
    'src/tags.ts': `
import { szv } from '@csszyx/runtime';
export const tagSz = szv({ variants: { c: {
    blue: { bg: 'tag-blue-bg' },
    red: { bg: 'tag-red-bg' },
} satisfies Record<string, object> } });
`,
    'src/main.ts': `
import { App } from './App.tsx';
import { Toolbar } from './toolbar.jsx';
import { tagSz } from './tags.ts';
export default { App, Toolbar, tagSz };
`,
};

interface BuildArtifacts {
    bundle: string;
    safelistTokens: string[];
}

const tempDirs: string[] = [];

/**
 * vite-build the fixture app with one parser and collect the artifacts.
 *
 * @param parser - engine under test.
 * @returns concatenated JS output + sorted safelist tokens.
 */
async function buildWith(parser: 'rust' | 'wasm'): Promise<BuildArtifacts> {
    const root = mkdtempSync(join(tmpdir(), `csszyx-build-diff-${parser}-`));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    for (const [file, source] of Object.entries(FIXTURE_FILES)) {
        writeFileSync(join(root, file), source, 'utf8');
    }

    await build({
        root,
        logLevel: 'silent',
        plugins: [vitePlugin({ build: { parser, cache: false } })],
        // Dependency-free JSX so the fixture needs no react install; csszyx
        // runtime imports stay external so the diff sees the raw emission.
        esbuild: {
            jsx: 'transform',
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            jsxInject: 'const h = (t, p, ...c) => ({ t, p, c }); const Fragment = "f";',
        },
        build: {
            minify: false,
            lib: { entry: join(root, 'src/main.ts'), formats: ['es'], fileName: 'bundle' },
            rollupOptions: {
                external: ['@csszyx/runtime', 'csszyx', 'react', 'react/jsx-runtime'],
            },
        },
    });

    const distDir = join(root, 'dist');
    // Lib-mode ES output lands as .mjs when the fixture has no package.json
    // `type` field — accept both flavours, and never let an empty read pass
    // (''.toBe('') would make every diff assertion vacuous).
    const bundle = readdirSync(distDir)
        .filter(f => f.endsWith('.js') || f.endsWith('.mjs'))
        .sort()
        .map(f => readFileSync(join(distDir, f), 'utf8'))
        .join('\n');
    if (bundle.length === 0) {
        throw new Error(`vite build (${parser}) produced no JS output in ${distDir}`);
    }
    // The bundler embeds the (per-run) temp dir in region comments and jsx
    // debug filenames — normalize it so the diff sees only real emission
    // differences.
    const normalizedBundle = bundle.split(basename(root)).join('FIXTURE-ROOT');
    const safelistHtml = readFileSync(join(root, 'csszyx-classes.html'), 'utf8');
    const rawCandidates = safelistHtml.split('<!-- csszyx exact scanner candidates -->\n')[1] ?? '';
    const safelistTokens = [...new Set(rawCandidates.split(/\s+/).filter(Boolean))].sort();
    return { bundle: normalizedBundle, safelistTokens };
}

describe('vite production build — engine diff (native vs wasm)', () => {
    let rust: BuildArtifacts;
    let wasm: BuildArtifacts;

    beforeAll(async () => {
        loadNativeBinding();
        rust = await buildWith('rust');
        wasm = await buildWith('wasm');
    }, 60_000);

    afterAll(() => {
        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('emits an identical bundle from both engines', () => {
        expect(rust.bundle).toBe(wasm.bundle);
    });

    it('emits an identical safelist from both engines', () => {
        expect(rust.safelistTokens).toEqual(wasm.safelistTokens);
    });

    it('the className expression survives into the bundle as a merge', () => {
        // The vui CRITICAL regression, asserted at the artifact that actually
        // ships: the panel class must still be reachable at runtime.
        expect(rust.bundle).toContain('dems-panel');
        expect(rust.bundle).toContain('_szMerge(');
    });

    it('static sz objects are fully lowered — no sz props left in the bundle', () => {
        expect(rust.bundle).not.toMatch(/\bsz:/);
        expect(rust.bundle).not.toMatch(/\bszs:/);
    });

    it('the safelist covers utilities from every fixture file', () => {
        for (const token of [
            'p-4',
            'text-red-500',
            'hover:bg-zinc-100',
            '[&_.tab-item-header]:py-0!',
            '[&>span]:text-sm',
            '[&[data-state="open"]]:bg-brand',
            'mx-0',
            'bg-tag-blue-bg',
            'bg-tag-red-bg',
        ]) {
            expect(rust.safelistTokens).toContain(token);
        }
    });
});
