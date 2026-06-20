import {
    mkdirSync,
    mkdtempSync,
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
 * Builds a fixture with one sz file (csszyx-owned class) and one non-sz file
 * whose author `className` literals reach the regex fallback scan.
 * @returns The fixture root directory.
 */
function createFixture(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-mangle-ownership-')));
    tempDirs.push(root);
    const src = join(root, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(
        join(root, 'index.html'),
        '<html><head></head><body><div id="root"></div><script type="module" src="/src/App.tsx"></script></body></html>',
    );
    // sz file → csszyx OWNS `p-4`; it is eligible to mangle.
    writeFileSync(
        join(src, 'App.tsx'),
        [
            "import { createRoot } from 'react-dom/client';",
            "import { Author } from './Author';",
            'const App = () => <div sz={{ p: 4 }}><Author /></div>;',
            "createRoot(document.getElementById('root')!).render(<App />);",
        ].join('\n'),
    );
    // Non-sz file → `flex` / `main-body` are AUTHOR classes (an external stylesheet
    // could own `.flex` / `.main-body`); they must never be mangled.
    writeFileSync(
        join(src, 'Author.tsx'),
        'export const Author = () => <div className="main-body flex">author</div>;',
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
        plugins: [...(vitePlugin({ build: { cache: false, parser: 'oxc' } }) as PluginOption[])],
        build: { emptyOutDir: true, minify: true, outDir: 'dist' },
    });
}

describe('mangle ownership', () => {
    it('mangles csszyx-owned sz classes but never author className literals', async () => {
        const root = createFixture();
        await runVite(root);

        const manifest = readJson(join(root, 'dist/csszyx-manifest.json')) as {
            mangleMap?: Record<string, string>;
        };
        const mangleMap = manifest.mangleMap ?? {};

        // The sz-generated class is owned → present in the mangle map.
        expect(mangleMap['p-4']).toBeDefined();
        // Author classes reached the safelist but must NOT be mangle-map keys,
        // otherwise an external stylesheet's `.flex` / `.main-body` rule would
        // stop matching the renamed DOM.
        expect(mangleMap.flex).toBeUndefined();
        expect(mangleMap['main-body']).toBeUndefined();
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
