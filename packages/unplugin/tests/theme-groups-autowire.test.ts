/**
 * Zero-wiring theme groups: a real vite build over an app that defines custom
 * tokens ONLY in `@theme` CSS and calls szcn — no import, no config. The build
 * must inject the generated registration module into the szcn-using code so
 * the runtime dedupes classes built from those tokens.
 *
 * Guards the whole auto-detect chain at once: theme scan (`--color-*`,
 * `--text-*`, `--font-weight-*`, `--font-*` with the weight-before-family
 * ordering trap) → virtual module generation → szcn-module import injection.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadNativeBinding } from '../../core/native/index.js';
import { vitePlugin } from '../src/unplugin.js';

const FIXTURE_FILES: Record<string, string> = {
    'src/theme.css': `
@import 'tailwindcss';
@theme {
    --color-brand: oklch(0.7 0.1 250);
    --text-huge: 4rem;
    --font-display: 'Inter', sans-serif;
    --font-weight-chunky: 900;
}
`,
    // The ONLY wiring the app does: define tokens in @theme and call szcn.
    // The exports are computed INSIDE the built bundle, so importing the dist
    // file proves the whole chain executed: scan → generated registration →
    // injected import → szcn actually deduping the custom tokens.
    'src/main.ts': `
import { szcn } from '@csszyx/runtime';
export const customColorOverride = szcn('text-brand', 'text-red-500');
export const customSizeOverride = szcn('text-base', 'text-huge');
export const customFamilyVsWeight = szcn('font-display', 'font-chunky');
`,
};

const tempDirs: string[] = [];

afterAll(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('theme groups auto-wiring (real vite build, zero app wiring)', () => {
    let bundle: string;
    let builtModule: {
        customColorOverride: string;
        customSizeOverride: string;
        customFamilyVsWeight: string;
    };

    beforeAll(async () => {
        loadNativeBinding();
        const root = mkdtempSync(join(tmpdir(), 'csszyx-theme-auto-'));
        tempDirs.push(root);
        mkdirSync(join(root, 'src'), { recursive: true });
        for (const [file, source] of Object.entries(FIXTURE_FILES)) {
            writeFileSync(join(root, file), source, 'utf8');
        }

        await build({
            root,
            logLevel: 'silent',
            plugins: [
                vitePlugin({
                    build: { cache: false, scanCss: ['src/theme.css'] },
                    production: { mangle: false },
                }),
            ],
            resolve: {
                // Inline the workspace runtime so the built file is
                // self-contained and executable from the temp dir.
                alias: { '@csszyx/runtime': resolve(__dirname, '../../runtime/src/index.ts') },
            },
            build: {
                minify: false,
                lib: { entry: join(root, 'src/main.ts'), formats: ['es'], fileName: 'bundle' },
                rollupOptions: { external: ['tailwindcss'] },
            },
        });

        const distDir = join(root, 'dist');
        const files = readdirSync(distDir).filter(f => f.endsWith('.js') || f.endsWith('.mjs'));
        bundle = files.map(f => readFileSync(join(distDir, f), 'utf8')).join('\n');
        expect(bundle.length).toBeGreaterThan(0);
        const entryFile = files.find(f => f.startsWith('bundle')) ?? files[0];
        builtModule = (await import(
            pathToFileURL(join(distDir, entryFile as string)).href
        )) as typeof builtModule;
    }, 60_000);

    it('the registration call ships inside the bundle', () => {
        expect(bundle).toContain('setSzcnGroups');
    });

    it('every theme category reaches its group, weights not mis-filed as families', () => {
        // Whitespace-tolerant: the bundler may pretty-print the payload.
        const entry = (key: string, token: string): RegExp =>
            new RegExp(`"${key}":\\s*\\[\\s*"${token}"\\s*\\]`);
        expect(bundle).toMatch(entry('colors', 'brand'));
        expect(bundle).toMatch(entry('textSizes', 'huge'));
        expect(bundle).toMatch(entry('fontFamilies', 'display'));
        expect(bundle).toMatch(entry('fontWeights', 'chunky'));
    });

    it('EXECUTING the bundle proves szcn dedupes the custom tokens at runtime', () => {
        // Not just "the registration shipped" — the built code ran it and the
        // merge results below were computed inside the bundle.
        expect(builtModule.customColorOverride).toBe('text-red-500');
        expect(builtModule.customSizeOverride).toBe('text-huge');
        expect(builtModule.customFamilyVsWeight).toBe('font-display font-chunky');
    });
});

describe('zero-config @theme auto-scan (no scanCss, real vite build)', () => {
    it('discovers @theme static tokens without scanCss and dedupes at runtime', async () => {
        // vui finding 7, both halves at once: scanCss is UNSET (the plugin must
        // discover the theme CSS itself) and the block uses the `static` option
        // keyword (which the scanner used to skip). The bundle must still ship
        // a registration that makes the later custom color win.
        loadNativeBinding();
        const root = mkdtempSync(join(tmpdir(), 'csszyx-theme-noscan-'));
        tempDirs.push(root);
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(
            join(root, 'src/theme.css'),
            `@import 'tailwindcss';
@theme static {
    --color-sub: oklch(0.7 0.05 250);
    --color-danger: oklch(0.6 0.2 25);
}
`,
            'utf8',
        );
        writeFileSync(
            join(root, 'src/main.ts'),
            `import { szcn } from '@csszyx/runtime';
export const slotOverride = szcn('text-sub', 'text-danger');
`,
            'utf8',
        );

        await build({
            root,
            logLevel: 'silent',
            plugins: [
                vitePlugin({
                    build: { cache: false },
                    production: { mangle: false },
                }),
            ],
            resolve: {
                alias: { '@csszyx/runtime': resolve(__dirname, '../../runtime/src/index.ts') },
            },
            build: {
                minify: false,
                lib: { entry: join(root, 'src/main.ts'), formats: ['es'], fileName: 'bundle' },
                rollupOptions: { external: ['tailwindcss'] },
            },
        });

        const distDir = join(root, 'dist');
        const files = readdirSync(distDir).filter(f => f.endsWith('.js') || f.endsWith('.mjs'));
        const bundle = files.map(f => readFileSync(join(distDir, f), 'utf8')).join('\n');
        expect(bundle).toContain('setSzcnGroups');
        expect(bundle).toMatch(/"colors":\s*\[\s*"danger",\s*"sub"\s*\]/);

        const entryFile = files.find(f => f.startsWith('bundle')) ?? files[0];
        const builtModule = (await import(
            pathToFileURL(join(distDir, entryFile as string)).href
        )) as { slotOverride: string };
        expect(builtModule.slotOverride).toBe('text-danger');
    }, 60_000);
});

describe('HMR: editing @theme reloads the generated registration module', () => {
    it('invalidates the virtual module when a scanned CSS file changes', () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-theme-hmr-'));
        tempDirs.push(root);
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src/theme.css'), '@theme { --color-brand: red; }', 'utf8');
        writeFileSync(
            join(root, 'src/App.tsx'),
            'export const A = () => <div sz={{ p: 4 }} />;',
            'utf8',
        );

        type HotUpdateHook = {
            configResolved?: (config: { root: string }) => void;
            handleHotUpdate?: (ctx: unknown) => void;
        };
        const [prePlugin] = vitePlugin({
            build: { cache: false, scanCss: ['src/theme.css'] },
        }) as HotUpdateHook[];
        prePlugin?.configResolved?.({ root });

        const invalidated: string[] = [];
        const fakeModule = { id: '\0virtual:csszyx/theme-groups' };
        prePlugin?.handleHotUpdate?.({
            file: join(root, 'src/theme.css'),
            server: {
                config: { root },
                moduleGraph: {
                    getModuleById: (id: string) =>
                        id === '\0virtual:csszyx/theme-groups' ? fakeModule : undefined,
                    invalidateModule: (mod: { id: string }) => {
                        invalidated.push(mod.id);
                    },
                },
            },
        });

        expect(
            invalidated,
            'a theme edit must reload the registration module, or the dev server serves stale groups until restart',
        ).toContain('\0virtual:csszyx/theme-groups');
    });
});

describe('scanCss narrows type augmentation, not merge correctness', () => {
    it('registers @theme tokens from a stylesheet scanCss does not list', async () => {
        // `scanCss` exists to say which CSS drives `.csszyx/theme.d.ts`. It was
        // also switching OFF project-wide @theme discovery, so a second
        // stylesheet's tokens never reached szcn — and the failure is silent:
        // both classes survive, and whichever the stylesheet emits last wins
        // instead of the one the author wrote last. A project with a design
        // system file plus a page file is the ordinary case.
        loadNativeBinding();
        const root = mkdtempSync(join(tmpdir(), 'csszyx-theme-partial-'));
        tempDirs.push(root);
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(
            join(root, 'src/typed.css'),
            `@import 'tailwindcss';
@theme {
    --color-typed: oklch(0.7 0.05 250);
}
`,
            'utf8',
        );
        writeFileSync(
            join(root, 'src/design-system.css'),
            `@theme {
    --color-unlisted: oklch(0.6 0.2 25);
}
`,
            'utf8',
        );
        writeFileSync(
            join(root, 'src/main.ts'),
            `import { szcn } from '@csszyx/runtime';
export const acrossFiles = szcn('text-typed', 'text-unlisted');
`,
            'utf8',
        );

        await build({
            root,
            logLevel: 'silent',
            plugins: [
                vitePlugin({
                    // Only ONE of the two stylesheets is listed.
                    build: { cache: false, scanCss: ['src/typed.css'] },
                    production: { mangle: false },
                }),
            ],
            resolve: {
                alias: { '@csszyx/runtime': resolve(__dirname, '../../runtime/src/index.ts') },
            },
            build: {
                minify: false,
                lib: { entry: join(root, 'src/main.ts'), formats: ['es'], fileName: 'bundle' },
                rollupOptions: { external: ['tailwindcss'] },
            },
        });

        const distDir = join(root, 'dist');
        const files = readdirSync(distDir).filter(f => f.endsWith('.js') || f.endsWith('.mjs'));
        const bundle = files.map(f => readFileSync(join(distDir, f), 'utf8')).join('\n');
        expect(bundle).toMatch(/"colors":\s*\[\s*"typed",\s*"unlisted"\s*\]/);

        const entryFile = files.find(f => f.startsWith('bundle')) ?? files[0];
        const builtModule = (await import(
            pathToFileURL(join(distDir, entryFile as string)).href
        )) as { acrossFiles: string };
        expect(builtModule.acrossFiles).toBe('text-unlisted');
    }, 60_000);
});
