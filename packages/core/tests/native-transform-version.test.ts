/**
 * The transform on a platform package older than `@csszyx/core`.
 *
 * Its own file for the reason `native-migrate.test.ts` gives: the entry point
 * resolves the binding itself, so a fixture has to stand in for the platform
 * package through a file-wide mock of the resolver.
 *
 * The two packages are versioned together but installed apart, so a lockfile
 * can pair a new `@csszyx/core` with an old platform binary. Such a binary
 * still exports `transformBatch`; what changed is the result it returns. A
 * result without the diagnostic codes used to reach the caller and fail there
 * as a bare `TypeError` on a missing field, which names neither package.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const packageName = vi.hoisted(() => ({ current: '' }));

vi.mock('../native/platforms.js', () => ({
    getNativePackageName: () => packageName.current,
}));

const fixture = (name: string) => new URL(`fixtures/${name}`, import.meta.url).pathname;

describe('@csszyx/core/native transformBatch', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns what a current binding answers', async () => {
        packageName.current = fixture('native-binding-migrate.cjs');
        const { transformBatch } = await import('../native/index.js');

        expect(transformBatch([{ filename: '/p/a.tsx', source: '' }])).toEqual([
            { code: '', classes: [], issues: [], mergeGroups: [] },
        ]);
        // Nothing to read the shape from, so nothing is refused.
        expect(transformBatch([])).toEqual([]);
    });

    it('names both packages and their versions when the binding is older', async () => {
        // A real platform package carries a manifest beside its binary.
        packageName.current = fixture('native-binding-0.17');
        const { transformBatch } = await import('../native/index.js');
        const { version } = await import('../package.json');

        expect(() => transformBatch([{ filename: '/p/a.tsx', source: '' }])).toThrow(
            `csszyx native package ${packageName.current} 0.17.0 is older than @csszyx/core ${version} and returns a result it cannot read`,
        );
    });

    it('names both packages when the binding is older', async () => {
        // The 0.17 result: no `issues`, and each merge group a bare class list.
        packageName.current = fixture('native-binding.cjs');
        const { transformBatch, CsszyxNativeUnavailableError } = await import('../native/index.js');
        const { version } = await import('../package.json');
        const files = [{ filename: '/p/a.tsx', source: '<div sz={{ p: 4 }} />' }];

        expect(() => transformBatch(files)).toThrow(CsszyxNativeUnavailableError);
        try {
            transformBatch(files);
        } catch (err) {
            const error = err as InstanceType<typeof CsszyxNativeUnavailableError>;
            expect(error.message.split('\n')).toEqual([
                // No manifest to read the binding's version from: named alone.
                `csszyx native engine unavailable: csszyx native package ${packageName.current} is older than @csszyx/core ${version} and returns a result it cannot read`,
                'help: update @csszyx/core and its platform package together, to the same version',
                'note: the wasm engine ships inside @csszyx/core and produces the same output',
            ]);
            expect(error.packageName).toBe(packageName.current);
            expect(error.helpIsExplicit).toBe(true);
        }
    });
});
