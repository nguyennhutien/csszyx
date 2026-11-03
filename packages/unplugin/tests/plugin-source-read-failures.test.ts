import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';
import { vitePlugin } from '../src/unplugin.js';
import { RESOLVED_THEME_GROUPS_VIRTUAL_ID } from '../src/virtual-modules.js';
import { callHooks } from './tailwind-project.js';

const unavailable = vi.hoisted(() => ({ file: '' }));
vi.mock('../src/stable-file-snapshot.js', async original => {
    const actual = await original<typeof import('../src/stable-file-snapshot.js')>();
    return {
        ...actual,
        readStableTextFileSnapshotSync: (file: string) => {
            if (file === unavailable.file)
                throw new Error('stylesheet disappeared after discovery');
            return actual.readStableTextFileSnapshotSync(file);
        },
    };
});
const roots: string[] = [];
afterEach(() => {
    unavailable.file = '';
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('does not invent theme tokens or aliases when a discovered stylesheet becomes unreadable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-unreadable-style-'));
    // Outside the project root, so the project's own stylesheet walk does not
    // read it: only the `scanCss` read, which fails here, can see the file.
    const cssDir = mkdtempSync(join(tmpdir(), 'csszyx-unreadable-style-css-'));
    roots.push(root, cssDir);
    const css = join(cssDir, 'tokens.css');
    writeFileSync(css, '@theme { --color-unavailable: red; } :root { --brand-primary: red; }');
    unavailable.file = css;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugins = vitePlugin({
        build: { parser: 'wasm', cache: false, scanCss: css },
        production: { mangleGlobalVars: { enabled: true, tokens: ['--brand-primary'] } },
    });
    const hook = callHooks(plugins as never);
    await expect(hook('configResolved', { root, command: 'build' })).rejects.toMatchObject({
        code: 'mangle-global-vars-plan-invalid',
        message: expect.stringContaining('--brand-primary is not defined'),
    });
    const groups = await hook('load', RESOLVED_THEME_GROUPS_VIRTUAL_ID);
    expect(groups).toContain('[]');
    expect(String(groups)).not.toContain('unavailable');
    const post = plugins[2] as unknown as {
        generateBundle: (
            this: { emitFile: ReturnType<typeof vi.fn> },
            options: unknown,
            bundle: unknown,
        ) => void;
    };
    const emitFile = vi.fn();
    expect(() => post.generateBundle.call({ emitFile }, {}, {})).toThrow(
        expect.objectContaining({
            code: 'mangle-global-vars-plan-invalid',
            message: expect.stringContaining('--brand-primary is not defined'),
        }),
    );
    expect(emitFile).not.toHaveBeenCalled();
});

/**
 * Resolve one `/packages/` module through the plugin and collect the warnings
 * the build ends with.
 *
 * @param files - Project-relative files to write first.
 * @param module - Project-relative module the bundler resolves.
 * @returns Every warning printed.
 */
async function packagesSkipWarnings(
    files: Record<string, string>,
    module: string,
): Promise<string> {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-missing-package-module-'));
    roots.push(root);
    for (const [relative, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, relative)), { recursive: true });
        writeFileSync(join(root, relative), content);
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugins = vitePlugin({ build: { parser: 'wasm', cache: false } });
    const hook = callHooks(plugins as never);
    await hook('configResolved', { root, command: 'build' });
    const pre = plugins[0] as unknown as { transformInclude: (id: string) => boolean };
    expect(pre.transformInclude(join(root, module))).toBe(false);
    await hook('buildEnd');
    return warn.mock.calls.flat().join('\n');
}

const SZV_EXPORT =
    "import { szv } from 'csszyx';\nexport const button = szv({ base: { p: 4 } });\n";

it('reports a resolved package module that exports szv factories', async () => {
    const printed = await packagesSkipWarnings(
        { 'packages/ui/Button.ts': SZV_EXPORT },
        'packages/ui/Button.ts',
    );
    expect(printed).toContain('compile-sources-skipped');
    expect(printed).toContain('packages/ui/Button.ts');
});

it('leaves a missing package module to the bundler, out of the skipped-file warning', async () => {
    // The prescan still finds Button.ts, so the warning is printed; the module
    // the bundler resolved cannot be read, and is left out of it.
    const printed = await packagesSkipWarnings(
        { 'packages/ui/Button.ts': SZV_EXPORT },
        'packages/ui/Missing.ts',
    );
    expect(printed).toContain('packages/ui/Button.ts');
    expect(printed).not.toContain('Missing.ts');
});
