import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { type PluginOption, build as viteBuild } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { vitePlugin } from '../src/unplugin.js';
import { executableInlineScripts } from './executable-inline-scripts.js';

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
        expect(css).toContain('---gy:var(--brand-secondary)');
        expect(css).toContain('color:var(---gz)');
        expect(css).toContain('border-color:var(---gy)');
        expect(html).toContain('data-sz-checksum=');
        expect(html).toContain('"var:--brand-primary":"---gz"');
        expect(html).toContain('"var:--brand-secondary":"---gy"');
        // The runtime map travels inside the bundle (the default delivery);
        // the HTML carries only the inert census and no executable script.
        expect(executableInlineScripts(html)).toEqual([]);
        // Quote-agnostic: the minifier is free to pick `'`, `"` or a template
        // literal for the map's strings.
        expect(js.replace(/\s/g, '').replace(/[`']/g, '"')).toContain(
            '"--brand-primary":"---gz","--brand-secondary":"---gy"',
        );
        expect(manifest.varMangleMap).toEqual({
            '--brand-primary': '---gz',
            '--brand-secondary': '---gy',
        });
        expect(manifest.globalVarAliases).toEqual({
            '--brand-primary': '---gz',
            '--brand-secondary': '---gy',
        });
        expect(globalVarMap).toEqual({
            '--brand-primary': '---gz',
            '--brand-secondary': '---gy',
        });

        // The deterministic build-output assertions above are the unit
        // coverage for this feature. The browser checks below verify runtime
        // computed styles and only run where a Chromium binary is installed
        // (local dev and the Playwright-provisioned E2E job). The plain unit
        // `test` job does not install browsers, so skip the runtime portion
        // there instead of failing on a missing executable.
        if (!isChromiumInstalled()) {
            return;
        }

        const server = await serveStatic(join(root, 'dist'));
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.goto(server.url);
            await page.getByTestId('global-card').waitFor();

            await expect
                .poll(() =>
                    page
                        .getByTestId('global-card')
                        .evaluate(element => getComputedStyle(element).color),
                )
                .toBe('rgb(255, 0, 0)');
            await expect
                .poll(() =>
                    page
                        .getByTestId('global-card')
                        .evaluate(element => getComputedStyle(element).borderTopColor),
                )
                .toBe('rgb(0, 0, 255)');
            await expect
                .poll(() => page.evaluate(() => window.__csszyx?.decodeGlobalVar?.('---gz')))
                .toBe('--brand-primary');
            await expect
                .poll(() => page.evaluate(() => window.__csszyx?.decodeGlobalVar?.('---gy')))
                .toBe('--brand-secondary');
        } finally {
            await browser.close();
            await server.close();
        }
    });

    it('keeps JS source maps when global variable aliases rewrite source transforms', async () => {
        const root = createFixture();

        await runVite(root, { sourcemap: true });

        const output = readOutputFiles(join(root, 'dist'));
        const js = output.find(file => file.path.endsWith('.js'))?.text ?? '';
        const jsMapFile = output.find(file => file.path.endsWith('.js.map'));
        expect(js).toContain('className:`card z`');
        expect(js).not.toContain('bg-(--brand-primary)');
        expect(jsMapFile).toBeDefined();

        const jsMap = JSON.parse(jsMapFile?.text ?? '{}') as {
            version?: number;
            sources?: string[];
            sourcesContent?: string[];
        };
        expect(jsMap.version).toBe(3);
        expect(jsMap.sources?.some(source => source.endsWith('src/App.tsx'))).toBe(true);
        // The sz transform returns `map: null`, which the rollup contract
        // defines as "this plugin intentionally has no sourcemap" — the chain
        // stops at our stage and sourcesContent holds the csszyx-transformed
        // module (aliased global var, sz prop folded into className), not the
        // authored source. rolldown <=1.0.x (vite 8.0) ignored that contract
        // and kept the authored text; vite 8.1+ enforces it. Restoring the
        // authored source here requires emitting a real map from the sz
        // transform (tracked as a backlog item).
        expect(jsMap.sourcesContent?.join('\n')).toContain('className="card bg-(---gz)"');
    });
});

function isChromiumInstalled(): boolean {
    try {
        return existsSync(chromium.executablePath());
    } catch {
        return false;
    }
}

function createFixture(): string {
    // realpath the temp root so the path handed to vite matches the realpath
    // vite's build-html plugin resolves internally. On macOS os.tmpdir() is a
    // /var -> /private/var symlink; without this the emitted index.html name is
    // computed relative to the un-realpath'd root and escapes the bundle dir.
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-vite-global-var-')));
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
            'const App = () => <div data-testid="global-card" className="card" sz={{ bg: "--brand-primary" }}>token</div>;',
            "createRoot(document.getElementById('root')!).render(<App />);",
        ].join('\n'),
    );
    writeFileSync(
        join(src, 'style.css'),
        [
            ':root{--brand-primary:red;--brand-secondary:blue}',
            '.card{color:var(--brand-primary);border-color:var(--brand-secondary);border-style:solid;border-width:1px}',
        ].join(''),
    );
    return root;
}

async function runVite(root: string, options: { sourcemap?: boolean } = {}): Promise<void> {
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
                build: { emitManifest: true, cache: false },
                production: {
                    mangle: true,
                    // The browser checks below inspect the registry through
                    // `window.__csszyx`, which a build only exposes on request.
                    mangleDebugGlobal: true,
                    mangleGlobalVars: {
                        enabled: true,
                        tokens: ['--brand-primary', '--brand-secondary'],
                    },
                },
            }) as PluginOption[]),
        ],
        build: {
            emptyOutDir: true,
            minify: true,
            outDir: 'dist',
            sourcemap: options.sourcemap,
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

async function serveStatic(root: string): Promise<{ url: string; close: () => Promise<void> }> {
    const server = createServer((request, response) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const relativePath =
            pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
        const file = resolve(root, relativePath);
        if (!file.startsWith(root)) {
            response.writeHead(403).end();
            return;
        }
        try {
            response.setHeader('content-type', contentType(file));
            response.end(readFileSync(file));
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise<void>(resolveListen => {
        server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Expected a TCP server address');
    }
    return {
        url: `http://127.0.0.1:${address.port}/`,
        close: () => closeServer(server),
    };
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolveClose, reject) => {
        server.close(error => {
            if (error) {
                reject(error);
                return;
            }
            resolveClose();
        });
    });
}

function contentType(file: string): string {
    switch (extname(file)) {
        case '.html':
            return 'text/html; charset=utf-8';
        case '.js':
            return 'text/javascript; charset=utf-8';
        case '.css':
            return 'text/css; charset=utf-8';
        case '.json':
            return 'application/json; charset=utf-8';
        default:
            return 'application/octet-stream';
    }
}
