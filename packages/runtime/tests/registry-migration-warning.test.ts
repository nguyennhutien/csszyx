/**
 * What an app upgrading from 0.17 is told when it registers theme tokens.
 *
 * On 0.17 `registerSzcnGroups` was how a class written in plain CSS joined a
 * merge group, and the docs said so. `szcn` now merges on the table the build
 * generates from the compiled CSS and never reads the registry, so such a
 * class silently stopped merging. The call is where the author can be told,
 * once per session, in development only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
});

/**
 * The warnings one call prints, from a fresh copy of the registry.
 *
 * @param call - Which registration to make.
 * @returns Everything printed.
 */
async function warningsOf(call: 'register' | 'set'): Promise<string> {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const groups = await import('../src/merge-groups.js');
    if (call === 'register') groups.registerSzcnGroups({ colors: ['migration-brand'] });
    else groups.setSzcnGroups({ colors: ['migration-brand'] }, 'build');
    return warn.mock.calls.map(args => String(args[0])).join('\n');
}

describe('registering theme tokens by hand', () => {
    it('says the registry no longer changes what szcn merges, and what to do', async () => {
        const printed = await warningsOf('register');

        expect(printed).toContain('no longer changes what `szcn` merges');
        // Every group the registry took is a `@theme` namespace.
        expect(printed).toContain('declare the tokens under `@theme`');
    });

    it.each([false, true])(
        'qualifies migration help with a merge table present: %s',
        async hasTable => {
            const { registerMergeSignatures } = await import('../src/merge-signatures.js');
            if (hasTable) {
                registerMergeSignatures([
                    { 'text-migration-brand': 0, 'text-migration-accent': 0 },
                    [[0]],
                ]);
            }
            const printed = await warningsOf('register');
            expect(printed).toContain('integration that supplies a merge table');
            expect(printed).toContain('without a table it removes only exact repeats');

            // Registering names does not substitute for delivery of merge data.
            const { szcn, _szcn } = await import('../src/merge-classes.js');
            for (const merge of [szcn, _szcn]) {
                expect(
                    merge('text-migration-brand', 'text-migration-accent', 'text-migration-accent'),
                ).toBe(
                    hasTable
                        ? 'text-migration-accent'
                        : 'text-migration-brand text-migration-accent',
                );
            }
        },
    );

    it('says it once per session', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const groups = await import('../src/merge-groups.js');
        groups.registerSzcnGroups({ colors: ['one'] });
        groups.registerSzcnGroups({ colors: ['two'] });

        expect(warn.mock.calls.filter(args => String(args[0]).includes('`@utility`'))).toHaveLength(
            1,
        );
    });

    it('says nothing when the build replaces its own declaration', async () => {
        expect(await warningsOf('set')).not.toContain('`@utility`');
    });

    it('says nothing in production', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        expect(await warningsOf('register')).toBe('');
    });
});
