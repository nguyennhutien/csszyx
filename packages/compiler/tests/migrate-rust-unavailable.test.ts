/**
 * What the native migrate says when this install cannot run it.
 *
 * The paths that report a missing platform package only exist for machines
 * that lack one, so on a machine that has it they are unreachable — and a
 * message nobody has ever seen is a message nobody has checked. The binding
 * is replaced here with one that fails the way a missing package fails.
 *
 * The fake speaks the words the real binding speaks, because this file checks
 * that the layer above carries them through unchanged. Whether the binding
 * chooses those words is a separate question, answered where it lives:
 * `packages/core/tests/native-migrate.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeUnavailable extends Error {
    packageName: string | null;

    /**
     * @param packageName - The platform package the loader looked for.
     */
    constructor(packageName: string | null) {
        super(
            [
                'csszyx migrate needs the native engine, and this install has none.',
                packageName === null
                    ? 'No prebuilt package covers this platform.'
                    : `Install the optional package for this platform: ${packageName}.`,
                'migrate has no second implementation to fall back to, so it stops here rather than answering differently. Building and the runtime are unaffected.',
            ].join(' '),
        );
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
        // Carried through once, not decorated: the layer above used to append
        // the package name a second time.
        try {
            migrateRustBatch([]);
        } catch (error) {
            const { message } = error as Error;
            expect(message.match(/@csszyx\/core-darwin-arm64/g)).toHaveLength(1);
            // migrate has no wasm artifact, so the transform's offer of
            // `build.parser` must never reach a migrate user.
            expect(message).not.toContain('build.parser');
        }
    });

    it('says no package covers the platform when there is none to name', async () => {
        const { migrateRustHtml } = await import('../src/migrate-rust.js');
        expect(() => migrateRustHtml('<div class="p-4" />')).toThrow(
            /No prebuilt package covers this platform/,
        );
    });
});
