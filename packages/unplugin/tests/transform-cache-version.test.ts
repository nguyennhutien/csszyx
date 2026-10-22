/**
 * The transform cache keys every entry by the plugin's and the compiler's
 * versions, so a build that cannot read one turns the cache off and says so,
 * once per process.
 */
import { describe, expect, it, vi } from 'vitest';

// The plugin's own manifest reads with no version.
vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    const readFileSync = ((file: unknown, ...rest: unknown[]) =>
        String(file).replaceAll('\\', '/').endsWith('/unplugin/package.json')
            ? '{}'
            : (actual.readFileSync as (...args: unknown[]) => unknown)(
                  file,
                  ...rest,
              )) as typeof actual.readFileSync;
    return { ...actual, default: { ...actual, readFileSync }, readFileSync };
});

// The module builds a default instance when it is imported, which is the
// first to say it.
const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
const { vitePlugin } = await import('../src/unplugin.js');

describe('a plugin whose version cannot be read', () => {
    it('says the transform cache is off, as `transform-cache-disabled`, once', () => {
        vitePlugin({ build: { cache: true } });
        vitePlugin({ build: { cache: true } });
        expect(
            warn.mock.calls
                .map(call => String(call[0]))
                .filter(line => /transform cache/i.test(line)),
        ).toEqual([
            '[csszyx] transform-cache-disabled:\n' +
                '  The build could not read the installed version of `@csszyx/unplugin` or `@csszyx/compiler`, so the transform cache is off and every build transforms each file again.\n' +
                '  help: reinstall `@csszyx/unplugin` and `@csszyx/compiler`, or set `build.cache: false` to hide this line.\n' +
                '  note: the build output is the same; only rebuilds are slower.\n' +
                '  docs: https://csszyx.com/e/transform-cache-disabled',
        ]);
    });
});
