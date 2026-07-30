/**
 * Cross-module szv precompile over a REAL vite production build, per engine.
 *
 * The compiler-level suites inject the registry through options; this net
 * exercises the actual pipeline — prescan discovers the styles module, the
 * registry records its factories, the importing file's specifier resolves,
 * the engines rewrite, and the emitted bundle carries the table, the
 * build-time string, the pick call, and the szr import retargeted at the
 * core entry. A break anywhere in that chain (path normalization, prescan
 * ordering, options plumbing) is invisible to the unit nets and lands here.
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
import { join } from 'node:path';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { vitePlugin } from '../src/unplugin.js';

const FIXTURE_FILES: Record<string, string> = {
    'index.html': `<!doctype html>
<html><head></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>
`,
    'src/main.ts': `
import { App } from './App.tsx';
document.body.textContent = JSON.stringify(App({ sel: { pad: 'lg' } }));
`,
    // The design-system module: exported factory, fully literal config.
    'src/styles.ts': `
import { szv } from '@csszyx/runtime';
export const cardSz = szv({
    base: { rounded: 'lg' },
    variants: { pad: { sm: { p: 2 }, lg: { p: 8 } } },
});
`,
    // The consumer: single-clause szr import (the shape people write), one
    // static and one dynamic selection on the IMPORTED factory.
    'src/App.tsx': `
import { szr } from '@csszyx/runtime';
import { cardSz } from './styles.ts';
export const App = ({ sel }) => szr(cardSz({ pad: 'sm' }), cardSz(sel));
`,
};

const tempDirs: string[] = [];

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/**
 * Build the fixture app in production and return the joined JS output.
 *
 * @param parser - Engine under test.
 * @returns Emitted JS bundle text.
 */
async function buildFixture(parser: 'rust' | 'oxc' | 'babel'): Promise<string> {
    const root = mkdtempSync(join(realpathSync(tmpdir()), `csszyx-szv-xm-${parser}-`));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    for (const [file, source] of Object.entries(FIXTURE_FILES)) {
        writeFileSync(join(root, file), source, 'utf8');
    }

    await build({
        root,
        logLevel: 'silent',
        plugins: [vitePlugin({ build: { parser, cache: false } })],
        esbuild: {
            jsx: 'transform',
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            jsxInject: 'const h = (t, p, ...c) => ({ t, p, c }); const Fragment = "f";',
        },
        build: {
            minify: false,
            // Runtime stays external so the emitted import statements — the
            // artifact under test — survive verbatim into the bundle.
            rollupOptions: { external: ['@csszyx/runtime', '@csszyx/runtime/core'] },
        },
    });

    const assetsDir = join(root, 'dist', 'assets');
    const js = readdirSync(assetsDir)
        .filter(file => file.endsWith('.js'))
        .map(file => readFileSync(join(assetsDir, file), 'utf8'))
        .join('\n');
    expect(js.length).toBeGreaterThan(0);
    return js;
}

describe.each(['rust', 'oxc', 'babel'] as const)('%s build', parser => {
    it('rewrites the imported factory end to end', { timeout: 120_000 }, async () => {
        const js = await buildFixture(parser);
        // The static selection collapsed at build time.
        expect(js).toContain('"rounded-lg p-2"');
        // The dynamic selection picks from the emitted table.
        expect(js).toContain('__szvT_cardSz');
        expect(js).toContain('__szvPick(');
        // Composition: every szr argument became a string, so the szr
        // import moved to the compiler-free core entry.
        expect(js).toContain('@csszyx/runtime/core');
        // And the factory call itself is gone from the consumer.
        expect(js).not.toContain('cardSz({');
    });
});
