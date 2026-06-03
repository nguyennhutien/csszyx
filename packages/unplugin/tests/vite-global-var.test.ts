import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

describe('vite global variable aliases', () => {
    it('emits matching source, CSS, manifest, and map aliases in a production build', async () => {
        const root = createFixture();

        await runVite(root);

        const output = readOutputFiles(join(root, 'dist'));
        const css = output.find(file => file.path.endsWith('.css'))?.text ?? '';
        const html = output.find(file => file.path.endsWith('index.html'))?.text ?? '';
        const js = output.find(file => file.path.endsWith('.js'))?.text ?? '';
        const manifest = readJson(join(root, 'dist/csszyx-manifest.json')) as {
            mangleMap?: Record<string, string>;
            varMangleMap?: Record<string, string>;
            globalVarAliases?: Record<string, string>;
        };
        const globalVarMap = readJson(join(root, 'dist/.csszyx/global-var-map.json'));

        expect(js).toContain('className:`card z`');
        expect(js).not.toContain('bg-(--brand-primary)');
        expect(manifest.mangleMap?.['bg-(---gz)']).toBe('z');
        expect(css).toContain('---gz:var(--brand-primary)');
        expect(css).toContain('color:var(---gz)');
        expect(html).toContain('data-sz-checksum=');
        expect(html).toContain('"var:--brand-primary":"---gz"');
        expect(html).toContain('var vm={"--brand-primary":"---gz"}');
        expect(manifest.varMangleMap).toEqual({ '--brand-primary': '---gz' });
        expect(manifest.globalVarAliases).toEqual({ '--brand-primary': '---gz' });
        expect(globalVarMap).toEqual({ '--brand-primary': '---gz' });
    });
});

function createFixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-vite-global-var-'));
    tempDirs.push(root);
    const src = join(root, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(
        join(root, 'index.html'),
        [
            '<html>',
            '<head></head>',
            '<body>',
            '<div id="root"></div>',
            '<script type="module" src="/src/App.tsx"></script>',
            '</body>',
            '</html>',
        ].join(''),
    );
    writeFileSync(
        join(src, 'App.tsx'),
        [
            "import './style.css';",
            "import { createRoot } from 'react-dom/client';",
            'const App = () => <div className="card" sz={{ bg: "--brand-primary" }} />;',
            "createRoot(document.getElementById('root')!).render(<App />);",
        ].join('\n'),
    );
    writeFileSync(
        join(src, 'style.css'),
        ':root{--brand-primary:red}.card{color:var(--brand-primary)}',
    );
    return root;
}

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
                build: { cache: false, parser: 'oxc' },
                production: {
                    mangleGlobalVars: {
                        enabled: true,
                        tokens: ['--brand-primary'],
                    },
                },
            }) as PluginOption[]),
        ],
        build: {
            emptyOutDir: true,
            minify: true,
            outDir: 'dist',
        },
    });
}

function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function readOutputFiles(root: string): Array<{ path: string; text: string }> {
    const files: Array<{ path: string; text: string }> = [];
    for (const file of listFiles(root)) {
        files.push({ path: file, text: readFileSync(file, 'utf8') });
    }
    return files;
}

function listFiles(root: string): string[] {
    return readdirSync(root)
        .flatMap(entry => {
            const file = resolve(root, entry);
            return statSync(file).isDirectory() ? listFiles(file) : [file];
        })
        .sort();
}
