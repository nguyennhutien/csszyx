/**
 * The module-link and global-var usage scans on the native binding.
 *
 * Its own file for the reason `native-migrate.test.ts` gives: the entry point
 * resolves the binding itself, so a fixture has to stand in for the platform
 * package through a file-wide mock of the resolver.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const packageName = vi.hoisted(() => ({ current: '' }));

vi.mock('../native/platforms.js', () => ({
    getNativePackageName: () => packageName.current,
}));

const fixture = (name: string) => new URL(`fixtures/${name}`, import.meta.url).pathname;

describe('@csszyx/core/native scanModuleLinks', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('forwards to the binding and returns what it answers', async () => {
        packageName.current = fixture('native-binding-migrate.cjs');
        const { scanModuleLinks } = await import('../native/index.js');

        expect(scanModuleLinks([{ filename: '/p/a.ts', source: '' }])).toEqual([
            { called: 'scanModuleLinks', filename: '/p/a.ts' },
        ]);
    });

    it('names the missing export, and keeps the wasm note, when the binding predates the scan', async () => {
        // The scan has a wasm lane, so the note that the wasm engine produces
        // the same output holds for this call.
        packageName.current = fixture('native-binding.cjs');
        const { scanModuleLinks, CsszyxNativeUnavailableError } = await import(
            '../native/index.js'
        );

        expect(() => scanModuleLinks([])).toThrow(CsszyxNativeUnavailableError);
        try {
            scanModuleLinks([]);
        } catch (err) {
            const error = err as InstanceType<typeof CsszyxNativeUnavailableError>;
            expect(error.message).toContain('`scanModuleLinks()`');
            expect(error.args).toEqual({
                form: 'missing-export',
                packageName: packageName.current,
                exportName: 'scanModuleLinks',
            });
            expect(error.message).toContain(
                `update \`@csszyx/core\` and \`${packageName.current}\` together, to the same version`,
            );
            expect(error.message).toContain(
                'note: the wasm engine produces the same output; only parsing is slower.',
            );
            expect(error.packageName).toBe(packageName.current);
        }
    });
});

describe('@csszyx/core/native scanGlobalVarUsages', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('forwards the files and the query to the binding', async () => {
        packageName.current = fixture('native-binding-migrate.cjs');
        const { scanGlobalVarUsages } = await import('../native/index.js');

        expect(
            scanGlobalVarUsages([{ filename: '/p/a.ts', source: '' }], { tokens: ['--x'] }),
        ).toEqual([
            [{ called: 'scanGlobalVarUsages', filename: '/p/a.ts', query: { tokens: ['--x'] } }],
        ]);
    });

    it('names the missing export, and keeps the wasm note, when the binding predates the scan', async () => {
        packageName.current = fixture('native-binding.cjs');
        const { scanGlobalVarUsages, CsszyxNativeUnavailableError } = await import(
            '../native/index.js'
        );

        let caught: unknown;
        try {
            scanGlobalVarUsages([]);
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(CsszyxNativeUnavailableError);
        const message = (caught as Error).message;
        expect(message).toContain('does not export `scanGlobalVarUsages()`');
        expect(message).toContain(
            'note: the wasm engine produces the same output; only parsing is slower.',
        );
    });
});
