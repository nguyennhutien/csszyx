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

import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadNativeBinding } from '../../core/native/index.js';
import { vitePlugin } from '../src/unplugin.js';

const FIXTURE_FILES: Record<string, string> = {
    'index.html': `<!doctype html>
<html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>
`,
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
    'src/main.ts': `
import { szcn } from '@csszyx/runtime';
document.body.textContent = szcn('text-brand', 'text-red-500');
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

    beforeAll(async () => {
        loadNativeBinding(resolve(__dirname, '../../core-linux-arm64-gnu'));
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
            build: {
                minify: false,
                rollupOptions: { external: ['@csszyx/runtime', 'csszyx', 'tailwindcss'] },
            },
        });

        const assetsDir = join(root, 'dist', 'assets');
        bundle = readdirSync(assetsDir)
            .filter(f => f.endsWith('.js'))
            .map(f => readFileSync(join(assetsDir, f), 'utf8'))
            .join('\n');
        expect(bundle.length).toBeGreaterThan(0);
    }, 60_000);

    it('the registration call ships inside the bundle', () => {
        expect(bundle).toContain('registerSzcnGroups');
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
});
