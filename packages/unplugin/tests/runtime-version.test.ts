import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CsszyxError } from '@csszyx/compiler/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNextPrebuild } from '../src/next-prebuild.js';
import { runNextTurboLoader } from '../src/next-turbo-loader.js';
import {
    assertRuntimeMatchesPlugin,
    installedRuntime,
    RuntimeVersionSkewError,
} from '../src/runtime-version.js';
import { vitePlugin } from '../src/unplugin.js';

const PLUGIN_VERSION = (
    JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as {
        version: string;
    }
).version;

const roots: string[] = [];

afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A project root, optionally with an installed runtime whose entry sits one
 * directory below a nested `package.json` that names no package, as a
 * `dist/package.json` carrying only `type` does.
 *
 * @param runtimeVersion - The runtime's version; omitted for a project without one.
 * @returns The root.
 */
function project(runtimeVersion?: string): string {
    // Resolution returns real paths, and macOS keeps the temporary directory
    // behind a symlink (`/var` → `/private/var`).
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-runtime-version-')));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), '{"name":"app","private":true}');
    if (runtimeVersion !== undefined) {
        const dir = join(root, 'node_modules/@csszyx/runtime');
        mkdirSync(join(dir, 'dist'), { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({
                name: '@csszyx/runtime',
                version: runtimeVersion,
                main: 'dist/index.js',
            }),
        );
        writeFileSync(join(dir, 'dist/package.json'), '{"type":"commonjs"}');
        writeFileSync(join(dir, 'dist/index.js'), 'module.exports = {};');
    }
    return root;
}

describe('installedRuntime', () => {
    it('reads the manifest that names the runtime, past a nested one that does not', () => {
        const root = project('9.9.9');
        expect(installedRuntime(root)).toEqual({
            version: '9.9.9',
            dir: join(root, 'node_modules/@csszyx/runtime'),
        });
    });

    it('is null for a project that resolves no runtime', () => {
        expect(installedRuntime(project())).toBeNull();
    });

    it('is null when no manifest up the tree names the runtime', () => {
        const root = project('9.9.9');
        writeFileSync(
            join(root, 'node_modules/@csszyx/runtime/package.json'),
            '{"name":"something-else","main":"dist/index.js"}',
        );
        expect(installedRuntime(root)).toBeNull();
    });
});

describe('assertRuntimeMatchesPlugin', () => {
    it('passes a runtime of the same release', () => {
        expect(() =>
            assertRuntimeMatchesPlugin({ root: project('1.2.3'), pluginVersion: '1.2.3' }),
        ).not.toThrow();
    });

    it('passes a project without a runtime', () => {
        expect(() =>
            assertRuntimeMatchesPlugin({ root: project(), pluginVersion: '1.2.3' }),
        ).not.toThrow();
    });

    it('skips the check when the plugin could not read its own version', () => {
        expect(() =>
            assertRuntimeMatchesPlugin({ root: project('1.2.2'), pluginVersion: '0.0.0' }),
        ).not.toThrow();
    });

    it('refuses a runtime from another release, naming both and what to install', () => {
        const root = project('1.2.2');
        let thrown: unknown;
        try {
            assertRuntimeMatchesPlugin({ root, pluginVersion: '1.2.3' });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(RuntimeVersionSkewError);
        expect((thrown as RuntimeVersionSkewError).code).toBe('runtime-version-skew');
        expect(thrown).toBeInstanceOf(CsszyxError);
        expect((thrown as RuntimeVersionSkewError).args).toEqual({
            pluginVersion: '1.2.3',
            runtimeVersion: '1.2.2',
            runtimeDir: join(root, 'node_modules/@csszyx/runtime'),
        });
        expect((thrown as Error).message).toBe(
            `[csszyx] runtime-version-skew: @csszyx/unplugin 1.2.3 found @csszyx/runtime 1.2.2 at ${join(root, 'node_modules/@csszyx/runtime')}\n` +
                'help: install @csszyx/runtime@1.2.3; the build and the runtime lower sz objects with rules from the same release',
        );
    });
});

describe('the plugin at build start', () => {
    /**
     * Create the Vite plugin rooted at a project and run its `buildStart`.
     *
     * @param root - The project root.
     * @returns The settled `buildStart`.
     */
    async function startAt(root: string): Promise<void> {
        const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
        const plugins = vitePlugin();
        cwd.mockRestore();
        await (
            plugins as unknown as Array<{ buildStart?: () => Promise<void> }>
        )[0]?.buildStart?.();
    }

    it('stops the build on a runtime from another release', async () => {
        await expect(startAt(project('0.0.1'))).rejects.toBeInstanceOf(RuntimeVersionSkewError);
    });

    it('starts with the runtime of its own release', async () => {
        await expect(startAt(project(PLUGIN_VERSION))).resolves.toBeUndefined();
    });
});

describe('the Next prebuild, which Turbopack runs instead of a plugin buildStart', () => {
    /**
     * Run a prebuild over no files, returning what it threw.
     *
     * @param root - The project root.
     * @returns The error, or undefined.
     */
    function prebuildError(root: string): unknown {
        try {
            runNextPrebuild({ files: [], explicitRoot: root, cwd: root, mode: 'production' });
        } catch (error) {
            return error;
        }
        return undefined;
    }

    it('stops on a runtime from another release', () => {
        expect(prebuildError(project('0.0.1'))).toBeInstanceOf(RuntimeVersionSkewError);
    });

    it('does not stop on the runtime of its own release', () => {
        expect(prebuildError(project(PLUGIN_VERSION))).not.toBeInstanceOf(RuntimeVersionSkewError);
    });
});

describe('the Turbopack loader, which a dev session can run without the prebuild', () => {
    it('stops on a runtime from another release', () => {
        const root = project('0.0.1');
        expect(() =>
            runNextTurboLoader('export default () => null;\n', {
                resourcePath: join(root, 'app/page.tsx'),
                rootContext: root,
                context: join(root, 'app'),
                mode: 'development',
                addDependency() {},
            }),
        ).toThrow(RuntimeVersionSkewError);
    });
});
