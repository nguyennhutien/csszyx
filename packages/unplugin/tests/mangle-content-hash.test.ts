/**
 * Content-hash coverage for the production mangle passes.
 *
 * The mangle rewrites used to run in `generateBundle`, which Rollup/Vite reach
 * only AFTER every filename hash is fixed. Two builds that differ only by
 * `production.mangle` therefore emitted the same `index-<hash>.css` with
 * different bytes, and a CDN or browser cache kept serving the stale file
 * forever.
 *
 * The contract asserted here is the one a "did it mangle?" test cannot see:
 * different bytes MUST mean a different name. Each case builds the same
 * fixture twice, changing one mangle option, and requires the emitted asset
 * names to move with the bytes.
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

import type { PartialCsszyxConfig } from '@csszyx/types';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];

afterAll(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** One emitted asset: the hashed name the browser caches, and its bytes. */
interface EmittedAsset {
    name: string;
    text: string;
}

/** Every hashed asset a build wrote, split by kind. */
interface BuildOutput {
    css: EmittedAsset[];
    js: EmittedAsset[];
}

const FIXTURE_FILES: Record<string, string> = {
    'index.html':
        '<!doctype html><html><head></head><body><div id="app"></div>' +
        '<script type="module" src="/src/main.ts"></script></body></html>\n',
    'src/main.ts':
        "import './styles.css';\nimport { App } from './App.tsx';\n" +
        'document.body.textContent = JSON.stringify(App());\n',
    'src/App.tsx': 'export const App = () => <div sz={{ m: 3, mx: 4 }} />;\n',
    // Hand-written stand-in for Tailwind's output: the selectors csszyx owns
    // are present, so a mangled build genuinely rewrites this file's bytes.
    'src/styles.css':
        '.m-3{margin:0.75rem}\n.mx-4{margin-inline:1rem}\n.app-shell{display:block}\n',
};

const GLOBAL_VAR_FILES: Record<string, string> = {
    'index.html':
        '<!doctype html><html><head></head><body><div id="app"></div>' +
        '<script type="module" src="/src/main.ts"></script></body></html>\n',
    'src/main.ts': "import './styles.css';\nexport const ready = true;\n",
    'src/styles.css':
        ':root{--brand-primary:red}\n.card{color:var(--brand-primary);display:block}\n',
};

/**
 * Write a fixture project into a fresh temp root.
 *
 * @param files Relative path to file contents.
 * @returns Absolute fixture root.
 */
function createFixture(files: Record<string, string>): string {
    // realpath so the root handed to vite matches the one vite's build-html
    // plugin resolves internally (macOS /var -> /private/var).
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'csszyx-hash-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    for (const [file, source] of Object.entries(files)) {
        writeFileSync(join(root, file), source, 'utf8');
    }
    return root;
}

/**
 * Build one fixture and read back every hashed asset it emitted.
 *
 * Both halves of a comparison build from the SAME root into different output
 * directories: a second temp root would leak its own path into the chunk (dev
 * JSX source annotations carry it), which changes the hash for a reason that
 * has nothing to do with mangling.
 *
 * @param root Fixture root shared by both halves of the comparison.
 * @param outDir Output directory for this half.
 * @param options csszyx plugin options under test.
 * @returns Emitted CSS and JS assets.
 */
async function buildFixture(
    root: string,
    outDir: string,
    options: PartialCsszyxConfig,
): Promise<BuildOutput> {
    await build({
        root,
        logLevel: 'silent',
        plugins: [vitePlugin({ build: { parser: 'oxc', cache: false }, ...options })],
        esbuild: {
            jsx: 'transform',
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            jsxInject: 'const h = (t, p, ...c) => ({ t, p, c }); const Fragment = "f";',
        },
        build: {
            minify: false,
            outDir,
            emptyOutDir: true,
            rollupOptions: { external: ['@csszyx/runtime', 'csszyx'] },
        },
    });

    const assetsDir = join(root, outDir, 'assets');
    const assets = readdirSync(assetsDir)
        .sort()
        .map(name => ({ name, text: readFileSync(join(assetsDir, name), 'utf8') }));
    return {
        css: assets.filter(asset => asset.name.endsWith('.css')),
        js: assets.filter(asset => asset.name.endsWith('.js')),
    };
}

/**
 * Assert that two builds of one source moved their filenames with their bytes.
 *
 * @param before Assets from the reference build.
 * @param after Assets from the build with the mangle option flipped.
 * @param kind Asset kind, for the failure message.
 */
function expectHashCoversBytes(before: EmittedAsset[], after: EmittedAsset[], kind: string): void {
    expect(before.length, `${kind}: reference build emitted nothing`).toBeGreaterThan(0);
    expect(after.length, `${kind}: compared build emitted nothing`).toBeGreaterThan(0);
    const beforeText = before.map(asset => asset.text).join('\n');
    const afterText = after.map(asset => asset.text).join('\n');
    expect(afterText, `${kind}: the option under test changed no bytes`).not.toBe(beforeText);

    const beforeByName = new Map(before.map(asset => [asset.name, asset.text]));
    for (const asset of after) {
        const reused = beforeByName.get(asset.name);
        if (reused === undefined) continue;
        expect(
            asset.text,
            `${kind}: ${asset.name} kept its name while its bytes changed — the ` +
                'content hash does not cover the mangled output',
        ).toBe(reused);
    }
}

describe('production mangle is covered by the content hash', () => {
    it('gives the CSS asset a different name when class mangling changes its bytes', async () => {
        const root = createFixture(FIXTURE_FILES);
        const plain = await buildFixture(root, 'dist/plain', { production: { mangle: false } });
        const mangled = await buildFixture(root, 'dist/mangled', { production: { mangle: true } });

        expect(plain.css[0]?.text).toContain('.m-3');
        expect(mangled.css[0]?.text).not.toContain('.m-3{');
        expectHashCoversBytes(plain.css, mangled.css, 'css');
    }, 60_000);

    it('gives the JS chunk a different name under mangleMapDelivery html', async () => {
        const root = createFixture(FIXTURE_FILES);
        const plain = await buildFixture(root, 'dist/plain', {
            production: { mangle: false, mangleMapDelivery: 'html' },
        });
        const mangled = await buildFixture(root, 'dist/mangled', {
            production: { mangle: true, mangleMapDelivery: 'html' },
        });

        expect(mangled.js[0]?.text).not.toContain('"m-3 mx-4"');
        expectHashCoversBytes(plain.js, mangled.js, 'js');
    }, 60_000);

    it('gives the JS chunk a different name under mangleMapDelivery both', async () => {
        const root = createFixture(FIXTURE_FILES);
        const plain = await buildFixture(root, 'dist/plain', {
            production: { mangle: false, mangleMapDelivery: 'both' },
        });
        const mangled = await buildFixture(root, 'dist/mangled', {
            production: { mangle: true, mangleMapDelivery: 'both' },
        });

        expectHashCoversBytes(plain.js, mangled.js, 'js');
    }, 60_000);

    it('gives the CSS asset a different name when mangleGlobalVars alone rewrites it', async () => {
        const root = createFixture(GLOBAL_VAR_FILES);
        const plain = await buildFixture(root, 'dist/plain', { production: { mangle: false } });
        const aliased = await buildFixture(root, 'dist/aliased', {
            production: {
                mangle: false,
                mangleGlobalVars: { enabled: true, tokens: ['--brand-primary'] },
            },
        });

        expect(aliased.css[0]?.text).toContain('---g');
        expectHashCoversBytes(plain.css, aliased.css, 'css');
    }, 60_000);
});
