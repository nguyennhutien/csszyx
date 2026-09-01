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
    help: string;
    helpIsExplicit: boolean;

    /**
     * @param packageName - The platform package the loader looked for.
     * @param what - The loader's first line; defaults to the not-installed case.
     * @param help - Help the loader wrote for this failure, without its label.
     */
    constructor(packageName: string | null, what?: string, help?: string) {
        const helpLine =
            help ?? 'set build.parser: "wasm"; the wasm engine ships inside @csszyx/core';
        const detail = [
            what ??
                (packageName === null
                    ? 'no prebuilt package covers this platform'
                    : `${packageName} is not installed`),
            `help: ${helpLine}`,
            'note: the wasm engine ships inside @csszyx/core and produces the same output',
        ].join('\n');
        super(`csszyx native engine unavailable: ${detail}`);
        this.name = 'CsszyxNativeUnavailableError';
        this.packageName = packageName;
        this.detail = detail;
        this.help = helpLine;
        this.helpIsExplicit = help !== undefined;
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
            'csszyx native package @csszyx/core-darwin-arm64 predates migrate and does not export migrateClassName()',
            'update @csszyx/core and its platform package together, to a version that carries migrate',
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

    it('keeps advice written for this failure instead of the generic install line', async () => {
        // Rewriting the help is right in general — the loader offers
        // `build.parser: "wasm"`, which migrate does not have. Rewriting it
        // HERE told a reader to reinstall a package that is already present,
        // which is a loop with no way out of it.
        const { migrateRustClassName } = await import('../src/migrate-rust.js');

        expect(() => migrateRustClassName('p-4')).toThrow(
            /update @csszyx\/core and its platform package together/,
        );
        expect(() => migrateRustClassName('p-4')).not.toThrow(
            /reinstall without skipping optional packages/,
        );
        // The wasm offer still has to go: migrate has no such lane.
        expect(() => migrateRustClassName('p-4')).not.toThrow(/build\.parser/);
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
