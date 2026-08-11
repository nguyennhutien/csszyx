/**
 * Imported static sz objects in a live dev server.
 *
 * The build suite covers a one-shot prescan, where every import already exists
 * when the walk runs. A dev session is the harder shape: the registry is filled
 * once at startup and then has to keep up with edits. Two of those edits change
 * what the importer must compile to, and neither changes the importer's own
 * text in a way that reveals it.
 *
 * Both cases are driven against a real Vite dev server rather than the pure
 * registry helpers, because what is under test is not the probing rules — it is
 * WHICH modules the plugin decides to read, and when.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];
const servers: ViteDevServer[] = [];

afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A dev server resolves imports for real and the workspace runtime is not
 * reachable from a temp dir. Only the transform output is under test.
 */
const RUNTIME_STUB = `
export const szr = (v) => v;
export const szv = (c) => () => c;
export const _sz = (v) => v;
export const __szvPick = (t, s) => t;
export const __szvPick1 = (t, d, v) => t;
`;

/** Authors sz, but names no style module. */
const APP_WITHOUT_IMPORT = `
export const App = () => <div sz={{ m: 3 }} />;
`;

/** The same component once it imports a shared style object. */
const APP_WITH_IMPORT = `
import { cardSz } from './styles';
export const App = () => [<div sz={{ m: 3 }} />, <div sz={cardSz} />];
`;

/** One dev session, with the fixture already on disk. */
interface Session {
    root: string;
    /** Transform the importer, invalidating it first the way a watcher would. */
    transform: () => Promise<string>;
    /** Tell the server a file changed, as the file watcher does. */
    touch: (relative: string) => Promise<void>;
    /** Rewrite a file and announce it. */
    edit: (relative: string, source: string) => Promise<void>;
}

/**
 * Start a dev server over a two-module fixture.
 *
 * @param app - Initial contents of the importing component.
 * @returns Handles for driving one session.
 */
async function session(app: string): Promise<Session> {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'csszyx-sz-dev-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><html><body><script type="module" src="/src/App.tsx"></script></body></html>',
        'utf8',
    );
    writeFileSync(join(root, 'src/runtime-stub.ts'), RUNTIME_STUB, 'utf8');
    writeFileSync(join(root, 'src/styles.ts'), 'export const cardSz = { p: 7 };\n', 'utf8');
    writeFileSync(join(root, 'src/App.tsx'), app, 'utf8');

    const server = await createServer({
        root,
        logLevel: 'silent',
        server: { middlewareMode: true },
        esbuild: {
            jsx: 'transform',
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            jsxInject: 'const h = (t, p, ...c) => ({ t, p, c }); const Fragment = "f";',
        },
        resolve: {
            alias: {
                '@csszyx/runtime/core': join(root, 'src/runtime-stub.ts'),
                '@csszyx/runtime': join(root, 'src/runtime-stub.ts'),
            },
        },
        plugins: [vitePlugin({ build: { parser: 'rust', cache: false, importedStaticSz: true } })],
    });
    servers.push(server);

    const touch = async (relative: string): Promise<void> => {
        await server.watcher.emit('change', join(root, relative));
    };
    return {
        root,
        touch,
        edit: async (relative, source) => {
            writeFileSync(join(root, relative), source, 'utf8');
            await touch(relative);
        },
        transform: async () => {
            const module = server.moduleGraph.getModuleById(join(root, 'src/App.tsx'));
            if (module) server.moduleGraph.invalidateModule(module);
            const result = await server.transformRequest('/src/App.tsx').catch(() => null);
            return result?.code ?? '';
        },
    };
}

describe('a dev session', () => {
    it('compiles an imported object that was already imported at startup', async () => {
        // The control. Without it, a failure below could equally mean the dev
        // lane never supports imported objects, which is a different defect.
        const dev = await session(APP_WITH_IMPORT);
        expect(await dev.transform()).toContain('p-7');
    }, 120_000);

    it('compiles an import the developer adds mid session', async () => {
        // Which modules are worth reading is decided by demand, and the demand
        // pass runs during the prescan — so a provider nothing imported at
        // startup is in no registry. The importer then falls back, and the only
        // recovery is touching the provider, which nothing tells the author to
        // do. It lands at the worst moment: right after opting in, when a
        // limitation is indistinguishable from the feature being broken.
        const dev = await session(APP_WITHOUT_IMPORT);
        expect(await dev.transform()).not.toContain('p-7');

        await dev.edit('src/App.tsx', APP_WITH_IMPORT);
        expect(await dev.transform()).toContain('p-7');
    }, 120_000);

    it('serves an edited provider, not the value it had at startup', async () => {
        // The sibling staleness: the importer's own text never changes, so
        // nothing about it says the class it compiles to is now different.
        const dev = await session(APP_WITH_IMPORT);
        expect(await dev.transform()).toContain('p-7');

        await dev.edit('src/styles.ts', 'export const cardSz = { p: 9 };\n');
        const after = await dev.transform();
        expect(after).toContain('p-9');
        expect(after).not.toContain('p-7');
    }, 120_000);
});
