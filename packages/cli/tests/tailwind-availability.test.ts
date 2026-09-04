/**
 * `generate-types` reads a Tailwind v3 JavaScript config through Tailwind's
 * own `resolveConfig`. Tailwind is an optional peer of this package, so the
 * command has to find out, before it reads a config, whether the package it is
 * about to import is there, is the right major, and loads.
 *
 * Three states, three different answers. Folding "absent" and "v4" into one
 * "install tailwindcss" message would tell a v4 project to downgrade for a
 * command it does not need.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
    isModuleNotFound,
    locateTailwind,
    resolveTailwindV3,
    type TailwindLoader,
    tailwindLoaderFor,
} from '../src/scanner/tailwind-availability.js';

/**
 * A loader that answers as a given install would.
 *
 * @param state - What the fake install contains.
 * @returns A loader for `resolveTailwindV3`.
 */
function loaderFor(
    state:
        | { kind: 'absent' }
        | { kind: 'present'; version: string; entry?: () => Promise<unknown> },
): TailwindLoader {
    return {
        async version() {
            if (state.kind === 'absent') {
                throw Object.assign(new Error("Cannot find package 'tailwindcss'"), {
                    code: 'ERR_MODULE_NOT_FOUND',
                });
            }
            return state.version;
        },
        async resolveConfig() {
            if (state.kind === 'absent') {
                throw Object.assign(new Error("Cannot find package 'tailwindcss'"), {
                    code: 'ERR_MODULE_NOT_FOUND',
                });
            }
            if (state.entry) return state.entry();
            return (config: unknown) => config;
        },
    };
}

describe('isModuleNotFound', () => {
    it('accepts both resolver codes, because Yarn PnP throws the other one', () => {
        expect(isModuleNotFound({ code: 'ERR_MODULE_NOT_FOUND' })).toBe(true);
        expect(isModuleNotFound({ code: 'MODULE_NOT_FOUND' })).toBe(true);
        expect(isModuleNotFound({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })).toBe(false);
        expect(isModuleNotFound(new Error('boom'))).toBe(false);
        expect(isModuleNotFound(null)).toBe(false);
    });
});

describe('resolveTailwindV3', () => {
    it('returns resolveConfig when a v3 install loads', async () => {
        const { resolveConfig, version } = await resolveTailwindV3(
            loaderFor({ kind: 'present', version: '3.4.19' }),
        );
        expect(version).toBe('3.4.19');
        expect(resolveConfig({ theme: {} })).toEqual({ theme: {} });
    });

    it('tells an absent install to add v3, and why it was not installed for it', async () => {
        await expect(resolveTailwindV3(loaderFor({ kind: 'absent' }))).rejects.toThrow(
            /needs Tailwind CSS v3, and this project has none installed/,
        );
        const error = await resolveTailwindV3(loaderFor({ kind: 'absent' })).catch(e => e);
        expect(error.state).toBe('absent');
        expect(error.message).toContain('npm  install -D tailwindcss@3');
        expect(error.message).toContain('optional peer');
        // A v4 project reading this must not be told to downgrade.
        expect(error.message).toContain('Do not install v3');
    });

    it('tells a v4 install that nothing is broken and not to downgrade', async () => {
        const error = await resolveTailwindV3(
            loaderFor({ kind: 'present', version: '4.3.3' }),
        ).catch(e => e);
        expect(error.state).toBe('wrong-major');
        expect(error.version).toBe('4.3.3');
        expect(error.message).toContain('this project has 4.3.3');
        expect(error.message).toContain('Nothing is broken');
        expect(error.message).toContain(
            'npx -p tailwindcss@3 -p @csszyx/cli csszyx generate-types',
        );
        expect(error.message).not.toContain('npm  install -D tailwindcss@3');
    });

    it('reports a v3 whose entry does not load, with the reason', async () => {
        const error = await resolveTailwindV3(
            loaderFor({
                kind: 'present',
                version: '3.4.19',
                entry: async () => {
                    throw Object.assign(new Error('No "exports" main defined'), {
                        code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
                    });
                },
            }),
        ).catch(e => e);
        expect(error.state).toBe('broken');
        expect(error.version).toBe('3.4.19');
        expect(error.message).toContain('found Tailwind CSS 3.4.19 but could not load');
        expect(error.message).toContain('No "exports" main defined');
        expect(error.message).toContain('reinstall');
    });

    // The version probe has located a v3, so whatever loading its entry then
    // throws is a fact about that install, not about the caller: a damaged
    // file throws a code-less SyntaxError, and a loader may throw a bare
    // value. Gating the reinstall message on an error code let both fall
    // through as a raw failure with no next step.
    it('reports whatever a located v3 entry throws as a broken install', async () => {
        const thrown: unknown[] = [
            new SyntaxError('Unexpected end of input'),
            new TypeError('resolveConfig is not a function'),
            'nope',
        ];
        for (const failure of thrown) {
            const error = await resolveTailwindV3(
                loaderFor({
                    kind: 'present',
                    version: '3.4.19',
                    entry: async () => {
                        throw failure;
                    },
                }),
            ).catch(e => e);
            expect(error.state).toBe('broken');
            expect(error.message).toContain('found Tailwind CSS 3.4.19 but could not load');
            expect(error.message).toContain(
                failure instanceof Error ? failure.message : String(failure),
            );
        }
    });

    it('treats a missing dependency from a located v3 entry as broken', async () => {
        const error = await resolveTailwindV3(
            loaderFor({
                kind: 'present',
                version: '3.4.19',
                entry: async () => {
                    throw Object.assign(new Error('not found'), { code: 'MODULE_NOT_FOUND' });
                },
            }),
        ).catch(e => e);
        expect(error.state).toBe('broken');
        expect(error.reason).toBe('not found');
    });

    it('rethrows a version probe failure that is not a missing module', async () => {
        const boom = new Error('EACCES: permission denied');
        await expect(
            resolveTailwindV3({
                version: async () => {
                    throw boom;
                },
                resolveConfig: async () => () => ({}),
            }),
        ).rejects.toBe(boom);
    });

    it('answers for the working directory when no loader is given', async () => {
        const state = (outcome: unknown): string =>
            outcome instanceof Error
                ? String((outcome as { state?: string }).state)
                : (outcome as { version: string }).version;
        const [bare, explicit] = await Promise.all([
            resolveTailwindV3().catch(e => e),
            resolveTailwindV3(tailwindLoaderFor(process.cwd())).catch(e => e),
        ]);
        expect(state(bare)).toBe(state(explicit));
    });

    it('reports an entry that loads but exports no function', async () => {
        const error = await resolveTailwindV3(
            loaderFor({ kind: 'present', version: '3.4.19', entry: async () => ({}) }),
        ).catch(e => e);
        expect(error.message).toContain('did not export a function');
    });

    it('resolves the real v3 this package installs for its own tests', async () => {
        // The package root is the project: its v3 devDependency answers. The
        // working directory would not do — under the repository-level test
        // run it is the workspace root, whose Tailwind is v4.
        const { version, resolveConfig } = await resolveTailwindV3(
            tailwindLoaderFor(join(import.meta.dirname, '..')),
        );
        expect(version.startsWith('3.')).toBe(true);
        const resolved = resolveConfig({ theme: { extend: { colors: { brand: '#123' } } } }) as {
            theme: { colors: Record<string, unknown> };
        };
        expect(resolved.theme.colors.brand).toBe('#123');
    });
});

describe('tailwindLoaderFor', () => {
    const roots: string[] = [];
    afterEach(() => {
        for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    /**
     * The anchor `locateTailwind` resolves a project's Tailwind from.
     *
     * @param root - The project root.
     * @returns The URL of its `package.json`.
     */
    function anchor(root: string): string {
        return pathToFileURL(join(root, 'package.json')).href;
    }

    /**
     * A project directory, optionally with a Tailwind of a given version
     * installed in its own `node_modules`.
     *
     * @param version - The installed version, or none.
     * @returns The project root.
     */
    function project(version?: string): string {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-tailwind-loader-'));
        roots.push(root);
        writeFileSync(join(root, 'package.json'), '{ "name": "app", "private": true }');
        if (version) {
            const pkg = join(root, 'node_modules', 'tailwindcss');
            mkdirSync(pkg, { recursive: true });
            writeFileSync(
                join(pkg, 'package.json'),
                JSON.stringify({ name: 'tailwindcss', version, main: 'lib/index.js' }),
            );
            writeFileSync(
                join(pkg, 'resolveConfig.js'),
                'module.exports = (config) => ({ ...config, resolvedBy: "project" });',
            );
        }
        return root;
    }

    // `npx @csszyx/cli generate-types` runs the CLI from a tree that has no
    // Tailwind in it; the project's own install is the one the command is
    // asked about, so it is read first.
    it("reads the project's Tailwind before the one next to the CLI", async () => {
        const { version, resolveConfig } = await resolveTailwindV3(
            tailwindLoaderFor(project('3.9.9')),
        );
        expect(version).toBe('3.9.9');
        expect(resolveConfig({ theme: {} })).toEqual({ theme: {}, resolvedBy: 'project' });
    });

    it("uses the CLI-side v3 when the project's install is a different major", async () => {
        const { version } = await resolveTailwindV3(tailwindLoaderFor(project('4.3.3')));
        expect(version.startsWith('3.')).toBe(true);
    });

    it('falls back to the Tailwind next to the CLI when the project has none', async () => {
        // In this workspace that is the v3 devDependency of the package.
        const { version } = await resolveTailwindV3(tailwindLoaderFor(project()));
        expect(version.startsWith('3.')).toBe(true);
    });

    it('is absent when neither the project nor the CLI has one', async () => {
        const error = await resolveTailwindV3(tailwindLoaderFor(project(), false)).catch(e => e);
        expect(error.state).toBe('absent');
    });

    it('reports the project major when CLI fallback is disabled', async () => {
        const error = await resolveTailwindV3(tailwindLoaderFor(project('4.3.3'), false)).catch(
            e => e,
        );
        expect(error.state).toBe('wrong-major');
        expect(error.version).toBe('4.3.3');
    });

    // The fallback exists to improve on the project's answer, never to
    // replace it with a failure of its own: a broken install beside the CLI
    // must not discard the version the project actually has.
    it('keeps the project answer when the fallback anchor cannot be read', async () => {
        const projectRoot = project('4.3.3');
        const broken = project('3.4.19');
        writeFileSync(
            join(broken, 'node_modules', 'tailwindcss', 'package.json'),
            JSON.stringify({ name: 'tailwindcss', version: '3.4.19', exports: {} }),
        );
        const located = locateTailwind([anchor(projectRoot), anchor(broken)]);
        expect(located.version).toBe('4.3.3');
    });

    // Two installs, neither of them v3: the project's is the one the
    // diagnostic names, or it tells a v5 project it has the CLI's v4.
    it('names the project major when no candidate is v3', async () => {
        const located = locateTailwind([anchor(project('5.0.1')), anchor(project('4.3.3'))]);
        expect(located.version).toBe('5.0.1');
    });

    it('prefers a v3 candidate wherever it sits in the order', async () => {
        const located = locateTailwind([anchor(project('4.3.3')), anchor(project('3.4.19'))]);
        expect(located.version).toBe('3.4.19');
    });

    // An exports map that hides `package.json` is a fact about that install,
    // not an absence: reading it as absent would tell the project to install
    // what it already has.
    it('reports a resolver failure that is not a missing module as is', async () => {
        const root = project('3.4.19');
        const manifest = join(root, 'node_modules', 'tailwindcss', 'package.json');
        writeFileSync(
            manifest,
            JSON.stringify({ name: 'tailwindcss', version: '3.4.19', exports: {} }),
        );
        const error = await resolveTailwindV3(tailwindLoaderFor(root)).catch(e => e);
        expect(error.code).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
        expect(error.state).toBeUndefined();
    });

    it('treats a located v3 whose entry file is missing as broken', async () => {
        const root = project('3.4.19');
        rmSync(join(root, 'node_modules', 'tailwindcss', 'resolveConfig.js'));
        const error = await resolveTailwindV3(tailwindLoaderFor(root)).catch(e => e);
        expect(error.state).toBe('broken');
        expect(error.version).toBe('3.4.19');
        expect(error.reason).toContain('Cannot find module');
    });
});
