/**
 * Remaining plugin-hook branches driven through the real vite plugin objects:
 * the virtual-module `load` hook (checksum + theme-groups defaults), the
 * `watchChange` delete path, the `transformIndexHtml` recovery-manifest
 * injection, and the `buildEnd` unscoped-monorepo content-scope warning.
 */
import fsDefault, * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { unplugin, vitePlugin } from '../src/unplugin.js';
import {
    RESOLVED_THEME_GROUPS_VIRTUAL_ID,
    RESOLVED_VIRTUAL_CHECKSUM_ID,
} from '../src/virtual-modules.js';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

interface Harness {
    root: string;
    invoke: (hook: string, ...args: unknown[]) => Promise<unknown>;
}

function harness(options = {}, root?: string): Harness {
    const dir = root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-hooks-extra-'));
    if (!root) tempDirs.push(dir);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const plugins = vitePlugin(options);
    const ctx = { warn() {}, error() {} };
    const invoke = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
        const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
        if (!plugin) return undefined;
        const hook = (plugin as Record<string, unknown>)[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(ctx, args) : undefined;
    };
    return { root: dir, invoke };
}

describe('virtual-module load hook', () => {
    it('returns null when the raw loader is asked for an unrelated module', () => {
        const plugin = unplugin.raw({}, { framework: 'vite' }) as unknown as {
            load: (id: string) => unknown;
        };
        expect(plugin.load('unrelated-module')).toBeNull();
    });
    it('loads the checksum-only virtual module', async () => {
        const h = harness();
        await h.invoke('configResolved', { root: h.root, command: 'build' });
        const source = (await h.invoke('load', RESOLVED_VIRTUAL_CHECKSUM_ID)) as string;
        expect(source).toContain('export const checksum');
    });

    it('loads the theme-groups virtual module with empty defaults when no theme was scanned', async () => {
        const h = harness();
        await h.invoke('configResolved', { root: h.root, command: 'build' });
        const source = (await h.invoke('load', RESOLVED_THEME_GROUPS_VIRTUAL_ID)) as string;
        // With no parsed theme, every group falls back to an empty array.
        expect(source).toContain('[]');
    });

    it('leaves unknown virtual modules to the remaining plugin chain', async () => {
        const h = harness();
        await h.invoke('configResolved', { root: h.root, command: 'build' });
        // unplugin normalizes the source hook's `null` pass-through to undefined
        // on the Vite adapter surface.
        await expect(h.invoke('load', '\0csszyx:unknown')).resolves.toBeUndefined();
    });
});

describe('watchChange delete', () => {
    it('prunes module records for a deleted file without throwing', async () => {
        const h = harness();
        await h.invoke('configResolved', { root: h.root, command: 'build' });
        const file = path.join(h.root, 'src/Gone.tsx');
        await h.invoke('transform', 'export const A = () => <div sz={{ p: 4 }} />;', file);
        await expect(h.invoke('watchChange', file, { event: 'delete' })).resolves.toBeUndefined();
    });
});

describe('transformIndexHtml recovery injection', () => {
    it('does not mistake a custom html-prefixed element for the document root', async () => {
        const h = harness({ build: { cache: false } });
        await h.invoke('configResolved', { root: h.root, command: 'build' });
        const source = 'export default function Root() { return <htmlish sz={{ p: 4 }} />; }';
        const result = (await h.invoke(
            'transform',
            source,
            path.join(h.root, 'src/layout.tsx'),
        )) as { code: string };
        expect(result.code).toContain('<htmlish');
        expect(result.code).toContain('p-4');
        expect(result.code).not.toContain('data-sz-checksum');
    });
    it('handles an HTML fragment without an opening body or head', async () => {
        const h = harness({ build: { cache: false } });
        await h.invoke('configResolved', { root: h.root, command: 'build' });
        await h.invoke(
            'transform',
            'const A = () => <div szRecover="csr" sz={{ p: 4 }} />;',
            path.join(h.root, 'src/App.tsx'),
        );
        const result = await h.invoke('transformIndexHtml', '<div id="root"></div>');
        expect(result).toContain('<div id="root"></div>');
        expect(result).toContain('csszyx');
    });

    it('uses the current directory when the host supplies no root', async () => {
        const h = harness({ build: { cache: false } });
        vi.spyOn(process, 'cwd').mockReturnValue(h.root);
        await h.invoke('configResolved', { command: 'build' });
        const transformed = await h.invoke(
            'transform',
            'const A = () => <div sz={{ p: 4 }} />;',
            path.join(h.root, 'src/App.tsx'),
        );
        expect(transformed).toMatchObject({ code: expect.stringContaining('p-4') });
    });
    it('injects a recovery manifest once szRecover tokens have been collected', async () => {
        const h = harness({ build: { cache: false } });
        await h.invoke('configResolved', { root: h.root, command: 'build' });
        // A szRecover attribute registers a recovery token in plugin state.
        await h.invoke(
            'transform',
            'const A = () => <div szRecover="csr" sz={{ p: 4 }} />;',
            path.join(h.root, 'src/App.tsx'),
        );
        const html = '<!doctype html><html><head></head><body><div id="app"></div></body></html>';
        const result = (await h.invoke('transformIndexHtml', html)) as string;
        expect(result).toContain('csszyx');
        // The output differs from the input because hydration data was injected.
        expect(result).not.toBe(html);
    });

    it('reports stripped dev-only recovery sites in production', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const h = harness({ build: { cache: false } });
        await h.invoke('configResolved', { root: h.root, command: 'build' });
        await h.invoke(
            'transform',
            'const A = () => <div szRecover="dev-only" sz={{ p: 4 }} />;',
            path.join(h.root, 'src/DevOnly.tsx'),
        );
        const html = '<html><head></head><body></body></html>';
        const result = (await h.invoke('transformIndexHtml', html)) as string;
        // A second HTML entry of the same build: the tokens are the build's,
        // so the line is said once, not once per page.
        await h.invoke('transformIndexHtml', html);

        expect(result).not.toContain('__SZ_RECOVERY_MANIFEST__');
        expect(
            warn.mock.calls
                .map(call => String(call[0]))
                .filter(line => line.startsWith('[csszyx] csr-recovery-dev-only:')),
        ).toEqual([
            '[csszyx] csr-recovery-dev-only:\n' +
                '  The production manifest leaves out 1 `szRecover="dev-only"` token(s), so recovery for those elements is off in production.\n' +
                '  help: use `szRecover="csr"` on any of them whose recovery must run in production.\n' +
                '  note: this is expected in a production build; the tokens are at src/DevOnly.tsx:1:21.\n' +
                '  docs: https://csszyx.com/e/csr-recovery-dev-only',
        ]);
    });
});

describe('buildEnd unresolvable-spread warning', () => {
    it('surfaces an unresolvable sz spread collected during transform', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const h = harness({ build: { cache: false } });
        await h.invoke('configResolved', { root: h.root, command: 'build' });
        await h.invoke(
            'transform',
            'const A = () => <div sz={{ p: 4, ...rest }} />;',
            path.join(h.root, 'src/Spread.tsx'),
        );
        await h.invoke('buildEnd');
        const message = warn.mock.calls.map(c => String(c[0])).join('\n');
        expect(message).toContain('[csszyx] unresolvable-spread: src/Spread.tsx:1:');
        expect(message).toContain('spreads a value the build cannot read');
    });
});

describe('buildEnd unscoped-monorepo content-scope warning', () => {
    it('warns when an unscoped tailwind entry sits inside a workspace', async () => {
        // Build a workspace: <mono>/pnpm-workspace.yaml with the project at
        // <mono>/packages/web so isMonorepoPackage walks up and finds it.
        const mono = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-mono-be-')));
        tempDirs.push(mono);
        fs.writeFileSync(path.join(mono, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n');
        // Under apps/ (not packages/) so the CSS entry is not hard-ignored.
        const root = path.join(mono, 'apps', 'web');
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const h = harness({}, root);
        await h.invoke('configResolved', { root, command: 'build' });
        // An unscoped tailwind CSS entry: imports tailwindcss, no source() scope.
        await h.invoke('transform', '@import "tailwindcss";\n', path.join(root, 'src/app.css'));
        await h.invoke('buildEnd');

        const message = warn.mock.calls.map(c => String(c[0])).join('\n');
        expect(message).toContain('UNSCOPED in a monorepo');
    });
});

describe('buildEnd unscoped content scope outside a monorepo', () => {
    it('answers the workspace question once, and stays quiet on every build end', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const h = harness();
        await h.invoke('configResolved', { root: h.root, command: 'build' });
        await h.invoke('transform', '@import "tailwindcss";\n', path.join(h.root, 'src/app.css'));
        const exists = vi.spyOn(fsDefault, 'existsSync');
        const workspaceProbes = (): number =>
            exists.mock.calls.filter(([file]) => String(file).endsWith('pnpm-workspace.yaml'))
                .length;
        await h.invoke('buildEnd');
        const firstWalk = workspaceProbes();
        await h.invoke('buildEnd');
        // The walk up the directory tree ran on the first build end only.
        expect(firstWalk).toBeGreaterThan(0);
        expect(workspaceProbes()).toBe(firstWalk);
        expect(warn.mock.calls.map(c => String(c[0])).join('\n')).not.toContain(
            'UNSCOPED in a monorepo',
        );
    });
});

describe('Tailwind entry @source injection', () => {
    it('does not append the safelist directive to an entry that already has it', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const h = harness();
        await h.invoke('configResolved', { root: h.root, command: 'build' });
        await h.invoke(
            'transform',
            'export const A = () => <div sz={{ p: 4 }} />;',
            path.join(h.root, 'src/App.tsx'),
        );
        const entry = path.join(h.root, 'src/app.css');
        const first = (await h.invoke('transform', '@import "tailwindcss";\n', entry)) as {
            code: string;
        };
        expect(first.code).toMatch(/@source "[^"]+";\n$/);
        // The bundler hands the injected text back, as on a second pass.
        expect(await h.invoke('transform', first.code, entry)).toBeNull();
    });
});

describe('buildEnd skipped workspace-package warning', () => {
    it('reports sz source that needs compileSources opt-in', async () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-skip-be-')));
        tempDirs.push(root);
        const packageSource = path.join(root, 'packages', 'ui', 'src', 'Card.tsx');
        fs.mkdirSync(path.dirname(packageSource), { recursive: true });
        fs.writeFileSync(packageSource, 'export const Card = () => <div sz={{ p: 4 }} />;');

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const h = harness({}, root);
        await h.invoke('configResolved', { root, command: 'build' });
        await h.invoke('buildEnd');

        const message = warn.mock.calls.map(call => String(call[0])).join('\n');
        expect(message).toContain('compileSources');
        expect(message).toContain('packages/ui/src/Card.tsx');
    });
});
