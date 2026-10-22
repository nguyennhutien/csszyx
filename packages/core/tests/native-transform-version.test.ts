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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const packageName = vi.hoisted(() => ({ current: '' }));

vi.mock('../native/platforms.js', () => ({
    getNativePackageName: () => packageName.current,
}));

const fixture = (name: string) => new URL(`fixtures/${name}`, import.meta.url).pathname;

/** The installed `@csszyx/core` version, which the versions form names. */
const CORE_VERSION = (
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        version: string;
    }
).version;

/**
 * A platform package directory in a temp dir: a manifest at `version` whose
 * binary is one of the fixtures, so a test controls the version it names.
 * @param version - The manifest version.
 * @param binding - The fixture file the manifest points at.
 * @returns The directory, which the caller removes.
 */
function platformPackage(version: string, binding: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'csszyx-platform-'));
    writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ version, main: fixture(binding) }),
    );
    return dir;
}

/** A version no release of `@csszyx/core` carries, so it differs from the installed one. */
const OTHER_VERSION = '0.0.1-fixture';

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

    it('names both versions when the platform package and `@csszyx/core` carry manifests', async () => {
        // A real platform package carries a manifest beside its binary, and
        // the two versions are what the user has to bring together.
        packageName.current = fixture('native-binding-0.17');
        const { transformBatch, CsszyxNativeUnavailableError } = await import('../native/index.js');
        const coreVersion = CORE_VERSION;
        const files = [{ filename: '/p/a.tsx', source: '' }];

        expect(() => transformBatch(files)).toThrow(
            `\`${packageName.current}\` 0.17.0 returns results the installed \`@csszyx/core\` ${coreVersion} cannot read, so the \`rust\` parser cannot run.`,
        );
        try {
            transformBatch(files);
        } catch (err) {
            expect((err as InstanceType<typeof CsszyxNativeUnavailableError>).args).toEqual({
                form: 'stale-binding-versions',
                packageName: packageName.current,
                nativeVersion: '0.17.0',
                coreVersion,
            });
        }
    });

    it('names no versions when both manifests carry the same one', async () => {
        // A binary built from older source than its manifest says, such as a
        // stale local build: the two numbers match, so naming them explains
        // nothing and the package alone is named.
        const dir = platformPackage(CORE_VERSION, 'native-binding.cjs');
        packageName.current = dir;
        const { transformBatch, CsszyxNativeUnavailableError } = await import('../native/index.js');
        const files = [{ filename: '/p/a.tsx', source: '' }];

        try {
            expect(() => transformBatch(files)).toThrow(CsszyxNativeUnavailableError);
            try {
                transformBatch(files);
            } catch (err) {
                expect((err as InstanceType<typeof CsszyxNativeUnavailableError>).args).toEqual({
                    form: 'stale-binding',
                    packageName: dir,
                });
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('refuses a binding whose issues carry no args, judged on the first issue', async () => {
        packageName.current = fixture('native-binding-no-args.cjs');
        const { transformBatch, CsszyxNativeUnavailableError } = await import('../native/index.js');
        const clean = { filename: '/p/a.tsx', source: '' };

        // A result with no issue cannot show the missing field.
        expect(transformBatch([clean])).toHaveLength(1);
        expect(() => transformBatch([clean, { filename: '/p/b.tsx', source: '' }])).toThrow(
            CsszyxNativeUnavailableError,
        );
    });

    it('names both packages when the binding is older', async () => {
        // The 0.17 result: no `issues`, and each merge group a bare class list.
        packageName.current = fixture('native-binding.cjs');
        const { transformBatch, CsszyxNativeUnavailableError } = await import('../native/index.js');
        const files = [{ filename: '/p/a.tsx', source: '<div sz={{ p: 4 }} />' }];

        expect(() => transformBatch(files)).toThrow(CsszyxNativeUnavailableError);
        try {
            transformBatch(files);
        } catch (err) {
            const error = err as InstanceType<typeof CsszyxNativeUnavailableError>;
            const name = packageName.current;
            expect(error.message).toBe(
                '[csszyx] native-engine-unavailable:\n' +
                    `  \`${name}\` returns results the installed \`@csszyx/core\` cannot read, so the \`rust\` parser cannot run.\n` +
                    `  help: update \`@csszyx/core\` and \`${name}\` together, to the same version, or set the parser to \`wasm\` (\`build.parser: 'wasm'\` in the plugin options, \`parserMode: 'wasm'\` in \`csszyxTurbopack\`, or \`--parser-mode wasm\` on \`csszyx next\`).\n` +
                    '  note: the wasm engine produces the same output; only parsing is slower.\n' +
                    '  docs: https://csszyx.com/e/native-engine-unavailable',
            );
            expect(error.packageName).toBe(name);
            expect(error.args).toEqual({ form: 'stale-binding', packageName: name });
        }
    });
});

describe('@csszyx/core/native scanModuleLinks', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('names the platform package when the binding predates registry entries', async () => {
        // The 0.17 scan ignores the query, so nothing but the result tells.
        // Its version is named only when it differs from the core's.
        const files = [{ filename: '/p/a.ts', source: 'export const a = { p: 4 };' }];
        const other = platformPackage(OTHER_VERSION, 'native-binding-links.cjs');
        const same = platformPackage(CORE_VERSION, 'native-binding-links.cjs');
        try {
            packageName.current = other;
            const first = await import('../native/index.js');
            expect(() => first.scanModuleLinks(files, { registryEntries: true })).toThrow(
                `\`${other}\` ${OTHER_VERSION} returns results the installed \`@csszyx/core\` ${CORE_VERSION} cannot read, so the \`rust\` parser cannot run.`,
            );

            vi.resetModules();
            packageName.current = same;
            const second = await import('../native/index.js');
            expect(() => second.scanModuleLinks(files, { registryEntries: true })).toThrow(
                `\`${same}\` returns results the installed \`@csszyx/core\` cannot read, so the \`rust\` parser cannot run.`,
            );
        } finally {
            rmSync(other, { recursive: true, force: true });
            rmSync(same, { recursive: true, force: true });
        }
    });

    it('answers when the query asks nothing the binding predates', async () => {
        packageName.current = fixture('native-binding-0.17.2');
        const { scanModuleLinks } = await import('../native/index.js');
        const files = [{ filename: '/p/a.ts', source: '' }];

        expect(scanModuleLinks(files)).toEqual([{ cssImports: [], forwards: [] }]);
        expect(scanModuleLinks([], { registryEntries: true })).toEqual([]);
    });
});

describe('@csszyx/core/native engineIdentity', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('answers null for a binding that predates it', async () => {
        packageName.current = fixture('native-binding.cjs');
        const { engineIdentity } = await import('../native/index.js');
        expect(engineIdentity()).toBeNull();
    });

    it("passes on the binding's identity", async () => {
        packageName.current = fixture('native-binding-identity.cjs');
        const { engineIdentity } = await import('../native/index.js');
        expect(engineIdentity()).toEqual({ version: '0.18.0', digest: 'aaaaaaaaaaaaaaaa' });
    });
});
