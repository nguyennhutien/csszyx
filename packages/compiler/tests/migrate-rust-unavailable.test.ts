/**
 * What the native migrate says when this install cannot run it.
 *
 * The paths that report a missing platform package only exist for machines
 * that lack one, so on a machine that has it they are unreachable — and a
 * message nobody has ever seen is a message nobody has checked. The binding
 * is replaced here with one that fails the way a missing package fails.
 *
 * The fake speaks the LOADER's words — the transform-shaped message a real
 * binding throws — because the point of these tests is that migrate does not
 * pass them on. The loader has a wasm engine to offer and migrate does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeUnavailable extends Error {
    packageName: string | null;
    detail: string;

    /**
     * @param packageName - The platform package the loader looked for.
     * @param what - The loader's first line; defaults to the not-installed case.
     */
    constructor(packageName: string | null, what?: string) {
        const detail = [
            what ??
                (packageName === null
                    ? 'no prebuilt package covers this platform'
                    : `${packageName} is not installed`),
            'help: set build.parser: "wasm"; the wasm engine ships inside @csszyx/core',
            'note: the wasm engine ships inside @csszyx/core and produces the same output',
        ].join('\n');
        super(`csszyx native engine unavailable: ${detail}`);
        this.name = 'CsszyxNativeUnavailableError';
        this.packageName = packageName;
        this.detail = detail;
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
    migrateClassName: () => {
        throw new FakeUnavailable(
            '@csszyx/core-darwin-arm64',
            '@csszyx/core-darwin-arm64 predates migrate and does not export migrateClassName(). Update @csszyx/core and its platform package together.',
        );
    },
}));

describe('the native migrate on a binding older than the package', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    /**
     * The loader already knows the package IS installed and is merely too
     * old; regenerating the message from the package name alone told the
     * reader it was missing, and the reinstall it prescribed changed nothing.
     */
    it("keeps the loader's diagnosis instead of calling the package missing", async () => {
        const { migrateRustClassName } = await import('../src/migrate-rust.js');
        expect(() => migrateRustClassName('p-4')).toThrow(/predates migrate/);
        expect(() => migrateRustClassName('p-4')).not.toThrow(/is not installed/);
    });
});

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
        try {
            migrateRustBatch([]);
        } catch (error) {
            const { message } = error as Error;
            // Named once. It used to be appended a second time.
            expect(message.match(/@csszyx\/core-darwin-arm64/g)).toHaveLength(1);
            // The loader's offer of the wasm engine is real for a transform
            // and a dead end for migrate, so it must not be carried through.
            expect(message).not.toContain('build.parser');
            // One line per thing the reader needs: what is missing, what to
            // do, what did not happen.
            expect(message.split('\n')).toEqual([
                'migrate: native engine unavailable: @csszyx/core-darwin-arm64 is not installed',
                'help: it is an optional dependency of @csszyx/core; reinstall without skipping optional packages',
                'note: no file was changed; build and runtime do not use this engine',
            ]);
        }
    });

    it('says no package covers the platform when there is none to name', async () => {
        const { migrateRustHtml } = await import('../src/migrate-rust.js');
        expect(() => migrateRustHtml('<div class="p-4" />')).toThrow(
            /no prebuilt package covers this platform/,
        );
        try {
            migrateRustHtml('<div class="p-4" />');
        } catch (error) {
            const { message } = error as Error;
            expect(message).not.toContain('build.parser');
            expect(message.split('\n')[1]).toBe(
                'help: prebuilt packages exist for linux, darwin and win32 on x64 and arm64',
            );
        }
    });
});
