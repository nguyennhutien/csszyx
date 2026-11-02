import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const descriptors = new Map(
    ['platform', 'arch', 'report'].map(key => [key, Object.getOwnPropertyDescriptor(process, key)]),
);

function host(platform: string, arch: string, report: unknown): void {
    for (const [key, value] of Object.entries({ platform, arch, report })) {
        Object.defineProperty(process, key, { configurable: true, value });
    }
}

beforeEach(() => vi.resetModules());
afterEach(() => {
    for (const [key, descriptor] of descriptors) {
        Object.defineProperty(process, key, descriptor as PropertyDescriptor);
    }
});

describe('native platform selection', () => {
    it.each([
        ['linux', 'x64', { header: { glibcVersionRuntime: '2.39' } }, 'linux-x64-gnu'],
        ['linux', 'arm64', { header: {} }, 'linux-arm64-musl'],
        ['linux', 'x64', {}, 'linux-x64-musl'],
        ['win32', 'arm64', {}, 'win32-arm64-msvc'],
        ['darwin', 'x64', {}, 'darwin-x64'],
    ])('selects %s/%s from the runtime report', async (platform, arch, report, key) => {
        host(platform, arch, { getReport: () => report });
        const { getNativePackageName, getNativePlatformKey } = await import(
            '../native/platforms.js'
        );
        expect(getNativePlatformKey()).toBe(key);
        expect(getNativePackageName()).toBe(`@csszyx/core-${key}`);
        // Read once per process: a host that changes afterwards keeps the answer.
        host('freebsd', 'x64', undefined);
        expect(getNativePackageName()).toBe(`@csszyx/core-${key}`);
    });

    it.each([undefined, {}, { getReport: 'unavailable' }])(
        'uses glibc when process reports are unavailable: %j',
        async report => {
            host('linux', 'x64', report);
            const { getNativePlatformKey } = await import('../native/platforms.js');
            expect(getNativePlatformKey()).toBe('linux-x64-gnu');
        },
    );

    it('memoizes the absence of a package for an unsupported host', async () => {
        host('freebsd', 'x64', undefined);
        const { getNativePackageName, getNativePlatformKey } = await import(
            '../native/platforms.js'
        );
        expect(getNativePlatformKey()).toBe('freebsd-x64');
        expect(getNativePackageName()).toBeNull();
        // The null is memoized too, not only a found name.
        host('darwin', 'x64', undefined);
        expect(getNativePackageName()).toBeNull();
    });
});
