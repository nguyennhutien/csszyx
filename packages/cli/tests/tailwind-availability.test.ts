/**
 * `generate-types` reads a Tailwind v3 JavaScript config through Tailwind's
 * own `resolveConfig`. Tailwind is an optional peer of this package, so the
 * command has to find out, before it prints a line of progress, whether the
 * package it is about to import is there, is the right major, and loads.
 *
 * Three states, three different answers. Folding "absent" and "v4" into one
 * "install tailwindcss" message would tell a v4 project to downgrade for a
 * command it does not need.
 */
import { describe, expect, it } from 'vitest';

import {
    isModuleNotFound,
    resolveTailwindV3,
    type TailwindLoader,
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
        expect(error.message).toContain('npm  install -D tailwindcss@3');
        expect(error.message).toContain('optional peer');
        // A v4 project reading this must not be told to downgrade.
        expect(error.message).toContain('Do not install v3');
    });

    it('tells a v4 install that nothing is broken and not to downgrade', async () => {
        const error = await resolveTailwindV3(
            loaderFor({ kind: 'present', version: '4.3.3' }),
        ).catch(e => e);
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
        expect(error.message).toContain('found Tailwind CSS 3.4.19 but could not load');
        expect(error.message).toContain('No "exports" main defined');
        expect(error.message).toContain('reinstall');
    });

    it('treats a v3 whose entry is missing as absent, not as a broken install', async () => {
        // pnpm strict layouts can expose package.json but not the entry; the
        // remedy is the same install command, not a reinstall.
        const error = await resolveTailwindV3(
            loaderFor({
                kind: 'present',
                version: '3.4.19',
                entry: async () => {
                    throw Object.assign(new Error('not found'), { code: 'MODULE_NOT_FOUND' });
                },
            }),
        ).catch(e => e);
        expect(error.message).toContain('none installed');
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

    it('reports an entry that loads but exports no function', async () => {
        const error = await resolveTailwindV3(
            loaderFor({ kind: 'present', version: '3.4.19', entry: async () => ({}) }),
        ).catch(e => e);
        expect(error.message).toContain('did not export a function');
    });

    it('resolves the real v3 this workspace installs for its own tests', async () => {
        // No injected loader: the probe resolves `tailwindcss` from this
        // module, which in the workspace is the v3 devDependency.
        const { version, resolveConfig } = await resolveTailwindV3();
        expect(version.startsWith('3.')).toBe(true);
        const resolved = resolveConfig({ theme: { extend: { colors: { brand: '#123' } } } }) as {
            theme: { colors: Record<string, unknown> };
        };
        expect(resolved.theme.colors.brand).toBe('#123');
    });

    it('lets an unrelated failure through untouched', async () => {
        const boom = new TypeError('resolveConfig is not a function');
        await expect(
            resolveTailwindV3(
                loaderFor({
                    kind: 'present',
                    version: '3.4.19',
                    entry: async () => {
                        throw boom;
                    },
                }),
            ),
        ).rejects.toBe(boom);
    });
});
