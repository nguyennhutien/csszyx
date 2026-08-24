/**
 * What the native migrate says when this install cannot run it.
 *
 * The paths that report a missing platform package only exist for machines
 * that lack one, so on a machine that has it they are unreachable — and a
 * message nobody has ever seen is a message nobody has checked. The binding
 * is replaced here with one that fails the way a missing package fails.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeUnavailable extends Error {
    packageName: string | null;

    /**
     * @param packageName - The platform package the loader looked for.
     */
    constructor(packageName: string | null) {
        super('csszyx native Rust transform is not available for this install.');
        this.name = 'CsszyxNativeUnavailableError';
        this.packageName = packageName;
    }
}

vi.mock('@csszyx/core/native', () => ({
    CsszyxNativeUnavailableError: FakeUnavailable,
    migrateBatch: () => {
        throw new FakeUnavailable('@csszyx/core-darwin-arm64');
    },
    migrateHtml: () => {
        throw new FakeUnavailable(null);
    },
}));

describe('the native migrate on an install without it', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('reports itself unavailable rather than throwing the loader error', async () => {
        const { isRustMigrateAvailable } = await import('../src/migrate-rust.js');
        expect(isRustMigrateAvailable()).toBe(false);
        // Memoized: the second answer is the first, not a second probe.
        expect(isRustMigrateAvailable()).toBe(false);
    });

    it('names the platform package a batch needed', async () => {
        const { migrateRustBatch, RustMigrateUnavailableError } = await import(
            '../src/migrate-rust.js'
        );
        expect(() => migrateRustBatch([{ filename: 'a.tsx', source: '<div />' }])).toThrow(
            RustMigrateUnavailableError,
        );
        expect(() => migrateRustBatch([])).toThrow(/@csszyx\/core-darwin-arm64/);
    });

    it('says the platform is unsupported when there is no package to name', async () => {
        const { migrateRustHtml } = await import('../src/migrate-rust.js');
        expect(() => migrateRustHtml('<div class="p-4" />')).toThrow(/unsupported platform/);
    });
});
