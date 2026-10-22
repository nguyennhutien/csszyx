/**
 * What the native migrate says when this install cannot run it.
 *
 * The paths that report a missing platform package only exist for machines
 * that lack one, so on a machine that has it they are unreachable — and a
 * message nobody has ever seen is a message nobody has checked. The binding
 * is replaced here with one that fails the way a missing package fails.
 *
 * The loader words its error for the transform, which can fall back to the
 * wasm engine; migrate cannot, so it reports `native-migrate-unavailable`
 * with the loader's args in words of its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The loader's args, as `@csszyx/core/native` names them. */
type LoaderArgs = {
    form: 'no-platform-package' | 'not-installed' | 'missing-export' | 'stale-binding';
    platform?: string;
    packageName?: string;
    exportName?: string;
};

class FakeUnavailable extends Error {
    readonly code = 'native-engine-unavailable';

    constructor(readonly args: LoaderArgs) {
        super('[csszyx] native-engine-unavailable: the loader words it for the transform');
        this.name = 'CsszyxNativeUnavailableError';
    }
}

const PACKAGE = '@csszyx/core-darwin-arm64';

vi.mock('@csszyx/core/native', () => ({
    CsszyxNativeUnavailableError: FakeUnavailable,
    migrateBatch: () => {
        throw new FakeUnavailable({ form: 'not-installed', packageName: PACKAGE });
    },
    migrateHtml: () => {
        throw new FakeUnavailable({ form: 'no-platform-package', platform: 'freebsd-x64' });
    },
    migrateClassName: () => {
        throw new FakeUnavailable({
            form: 'missing-export',
            packageName: PACKAGE,
            exportName: 'migrateClassName',
        });
    },
    migrateParseClass: () => {
        throw new FakeUnavailable({ form: 'stale-binding', packageName: PACKAGE });
    },
}));

/** The note every form ends with. */
const NOTE =
    'note: no file was changed; migrate runs on the native engine only, and builds and the runtime do not need it.';

/**
 * The message, as the registry words it.
 *
 * @param text - The sentence.
 * @param help - The help.
 * @returns The message.
 */
function message(text: string, help: string): string {
    return [
        '[csszyx] native-migrate-unavailable:',
        `  ${text}`,
        `  help: ${help}`,
        `  ${NOTE}`,
        '  docs: https://csszyx.com/e/native-migrate-unavailable',
    ].join('\n');
}

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

    it.each([
        [
            'a platform package that is not installed',
            'migrateRustBatch',
            message(
                `\`${PACKAGE}\` is not installed, so migrate cannot run.`,
                `reinstall without skipping optional dependencies, which installs \`${PACKAGE}\` with \`@csszyx/core\`.`,
            ),
        ],
        [
            'a platform no prebuilt package covers',
            'migrateRustHtml',
            message(
                'No prebuilt native engine covers `freebsd-x64`, so migrate cannot run.',
                'run migrate on Linux, macOS or Windows, on x64 or arm64, where a prebuilt native engine exists.',
            ),
        ],
        [
            'a binding that predates migrate',
            'migrateRustClassName',
            message(
                `\`${PACKAGE}\` predates migrate and does not export \`migrateClassName()\`, so migrate cannot run.`,
                `update \`@csszyx/core\` and \`${PACKAGE}\` together, to a version that carries migrate.`,
            ),
        ],
        [
            'a binding older than the package',
            'migrateRustParseClass',
            message(
                `\`${PACKAGE}\` returns results the installed \`@csszyx/core\` cannot read, so migrate cannot run.`,
                `update \`@csszyx/core\` and \`${PACKAGE}\` together, to the same version.`,
            ),
        ],
    ] as const)('says so in its own words for %s', async (_name, call, expected) => {
        const migrate = await import('../src/migrate-rust.js');
        const run = migrate[call] as (input: never) => unknown;
        expect(() => run([] as never)).toThrow(migrate.RustMigrateUnavailableError);
        expect(() => run([] as never)).toThrow(expected);
    });

    it("carries its own code, the loader's args, and the loader's error as its cause", async () => {
        const { migrateRustBatch, RustMigrateUnavailableError } = await import(
            '../src/migrate-rust.js'
        );
        let error: unknown;
        try {
            migrateRustBatch([]);
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(RustMigrateUnavailableError);
        // The module graph is reset per test, so the class is this test's copy.
        expect(error).toBeInstanceOf((await import('../src/errors.js')).CsszyxError);
        expect(error).toMatchObject({
            name: 'RustMigrateUnavailableError',
            code: 'native-migrate-unavailable',
            args: { form: 'not-installed', packageName: PACKAGE },
        });
        expect((error as Error).cause).toBeInstanceOf(FakeUnavailable);
    });
});
