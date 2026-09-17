/**
 * The module-link scan on the native binding.
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
        // Unlike migrate, the scan has a wasm lane, so the note that the wasm
        // engine produces the same output still holds for this call.
        packageName.current = fixture('native-binding.cjs');
        const { scanModuleLinks, CsszyxNativeUnavailableError } = await import(
            '../native/index.js'
        );

        expect(() => scanModuleLinks([])).toThrow(CsszyxNativeUnavailableError);
        try {
            scanModuleLinks([]);
        } catch (err) {
            const error = err as InstanceType<typeof CsszyxNativeUnavailableError>;
            expect(error.message).toContain('predates the module-link scan');
            expect(error.message).toContain('scanModuleLinks()');
            expect(error.message).toContain(
                'update @csszyx/core and its platform package together',
            );
            expect(error.message).toContain(
                'the wasm engine ships inside @csszyx/core and produces the same output',
            );
            expect(error.packageName).toBe(packageName.current);
        }
    });
});
