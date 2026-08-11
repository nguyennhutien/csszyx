import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PluginOption, build as viteBuild } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const requireFromHere = createRequire(import.meta.url);
const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/**
 * Builds a fixture with one app sz file (csszyx-owned class) and one raw-only
 * `compileSources` package whose author `className` literals must reach prescan.
 * @returns The fixture root directory.
 */
function createFixture(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-mangle-ownership-')));
    tempDirs.push(root);
    const src = join(root, 'src');
    const vuiSrc = join(root, 'packages/vui/src');
    mkdirSync(src, { recursive: true });
    mkdirSync(vuiSrc, { recursive: true });
    writeFileSync(
        join(root, 'index.html'),
        '<html><head></head><body><div id="root"></div><script type="module" src="/src/App.tsx"></script></body></html>',
    );
    // sz file → csszyx owns both classes, but `p-4` also has a raw consumer.
    writeFileSync(
        join(src, 'App.tsx'),
        [
            "import { createRoot } from 'react-dom/client';",
            "import { mangleMap } from 'virtual:csszyx/mangle-map';",
            "import { Author } from '../packages/vui/src/Author';",
            'document.documentElement.dataset.fixtureMap = JSON.stringify(mangleMap);',
            'const App = () => <div sz={{ p: 4, m: 3 }}><Author /></div>;',
            "createRoot(document.getElementById('root')!).render(<App />);",
        ].join('\n'),
    );
    // Mixed known/unknown clsx string reproduces the hybrid orphan: `p-4` is also
    // sz-owned, while `main-body` is raw-only. Both must keep authored spelling.
    writeFileSync(
        join(vuiSrc, 'Author.tsx'),
        [
            "const clsx = (...values: string[]) => values.join(' ');",
            "export const Author = () => <div className={clsx('z p-4 main-body')}>author</div>;",
        ].join('\n'),
    );
    return root;
}

/**
 * Runs a production vite build (class mangling on by default) over the fixture.
 * @param root The fixture root directory.
 */
async function runVite(root: string): Promise<void> {
    await viteBuild({
        root,
        logLevel: 'silent',
        resolve: {
            alias: [
                {
                    find: 'react/jsx-runtime',
                    replacement: requireFromHere.resolve('react/jsx-runtime'),
                },
                {
                    find: 'react/jsx-dev-runtime',
                    replacement: requireFromHere.resolve('react/jsx-dev-runtime'),
                },
                {
                    find: 'react-dom/client',
                    replacement: requireFromHere.resolve('react-dom/client'),
                },
                { find: 'react', replacement: requireFromHere.resolve('react') },
            ],
        },
        plugins: [
            ...(vitePlugin({
                build: { emitManifest: true, cache: false, parser: 'oxc' },
                compileSources: ['packages/vui/src'],
                production: { mangle: true },
            }) as PluginOption[]),
        ],
        build: { emptyOutDir: true, minify: true, outDir: 'dist' },
    });
}

describe('mangle ownership', () => {
    it('preserves shared raw classes from an opted-in workspace package', async () => {
        const root = createFixture();
        await runVite(root);

        const manifest = readJson(join(root, 'dist/csszyx-manifest.json')) as {
            mangleMap?: Record<string, string>;
        };
        const mangleMap = manifest.mangleMap ?? {};

        // The sz-only class remains eligible for the optimization.
        expect(mangleMap['m-3']).toBeDefined();
        expect(mangleMap['m-3']).not.toBe('z');
        // The shared raw/sz class is excluded, even inside a mixed clsx string.
        expect(mangleMap['p-4']).toBeUndefined();
        expect(mangleMap['main-body']).toBeUndefined();

        const bundle = readBuiltJavaScript(root);
        expect(bundle).toContain('p-4');
        expect(bundle).toContain('main-body');
        expect(bundle).toContain('z p-4 main-body');
        expect(bundle).not.toMatch(/["']p-4["']\s*:/);
    });
});

/**
 * Reads and parses a JSON file.
 * @param path Absolute file path.
 * @returns Parsed JSON.
 */
function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Reads the fixture's emitted JavaScript chunks.
 *
 * @param root Fixture root directory.
 * @returns Concatenated production JavaScript.
 */
function readBuiltJavaScript(root: string): string {
    const assetsDir = join(root, 'dist/assets');
    return readdirSync(assetsDir)
        .filter(file => file.endsWith('.js'))
        .sort()
        .map(file => readFileSync(join(assetsDir, file), 'utf8'))
        .join('\n');
}
