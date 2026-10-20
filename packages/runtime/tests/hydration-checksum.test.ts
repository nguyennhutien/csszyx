/**
 * The Web-Crypto checksum pair, and where the async check finds the map on a
 * page — real recomputation, unlike the sync attribute comparison the main
 * suite covers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { computeMangleChecksumAsync, verifyMangleChecksumAsync } from '../src/hydration.js';
import { createHydrationMangleMap } from '../src/hydration-map.js';
import { clearMangleRegistry, installMangleRuntime } from '../src/mangle-registry.js';
import {
    CENSUS_UNREADABLE_LINE,
    checksumMismatchLine,
    mapUnavailableLine,
} from './helpers/hydration-lines.js';

const map = { 'p-4': 'a', 'bg-red-500': 'b' };

afterEach(() => {
    document.documentElement.removeAttribute('data-sz-checksum');
    document.head.innerHTML = '';
});

describe('computeMangleChecksumAsync', () => {
    it('produces a stable 16-hex-char digest independent of key order', async () => {
        const first = await computeMangleChecksumAsync(map);
        const reordered = await computeMangleChecksumAsync({ 'bg-red-500': 'b', 'p-4': 'a' });
        expect(first).toMatch(/^[0-9a-f]{16}$/);
        expect(reordered).toBe(first);
        expect(await computeMangleChecksumAsync({})).not.toBe(first);
    });
});

describe('createHydrationMangleMap', () => {
    it('hands a class-only build its class map unchanged', () => {
        expect(createHydrationMangleMap(map)).toBe(map);
    });
});

describe('verifyMangleChecksumAsync', () => {
    it('accepts the matching checksum and rejects a different one', async () => {
        const checksum = await computeMangleChecksumAsync(map);
        expect(await verifyMangleChecksumAsync(checksum, map)).toBe(true);
        expect(await verifyMangleChecksumAsync('0000000000000000', map)).toBe(false);
    });
});

describe('verifyMangleChecksumAsync, reading the map from the page', () => {
    /**
     * Ship a census the way the build does.
     * @param content - Raw JSON for the census tag.
     */
    function census(content: string): void {
        const script = document.createElement('script');
        script.id = '__CSSZYX_MANGLE_MAP__';
        script.type = 'application/json';
        script.textContent = content;
        document.head.appendChild(script);
    }

    afterEach(() => {
        clearMangleRegistry();
        vi.restoreAllMocks();
    });

    it('verifies the census quietly', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        census(JSON.stringify(map));
        expect(await verifyMangleChecksumAsync(await computeMangleChecksumAsync(map))).toBe(true);
        expect(warn).not.toHaveBeenCalled();
    });

    it('names both checksums when the census was altered', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const built = await computeMangleChecksumAsync(map);
        const altered = { ...map, 'p-4': 'z' };
        census(JSON.stringify(altered));
        expect(await verifyMangleChecksumAsync(built)).toBe(false);
        expect(warn.mock.calls).toEqual([
            [checksumMismatchLine(await computeMangleChecksumAsync(altered), built)],
        ]);
    });

    // `hydrationCensus: false` is a configuration, not a fault: the bundle
    // still installs the map, so there is something to recompute and nothing
    // to report.
    it('verifies a build that ships no census against the map its bundle installed', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const varMangleMap = { '--brand': 'a', '--gap': ['b', 'c'] };
        installMangleRuntime({ mangleMap: map, varMangleMap });
        const built = await computeMangleChecksumAsync(createHydrationMangleMap(map, varMangleMap));
        expect(await verifyMangleChecksumAsync(built)).toBe(true);
        expect(warn).not.toHaveBeenCalled();
    });

    // A build that mangles nothing installs no registry and hashes the empty
    // map; that is the map it has, so it verifies.
    it('verifies a build that mangles nothing against the empty map', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await verifyMangleChecksumAsync(await computeMangleChecksumAsync({}))).toBe(true);
        expect(warn).not.toHaveBeenCalled();
    });

    it('says nothing was verified when a page carries a checksum and no map', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const built = await computeMangleChecksumAsync(map);
        expect(await verifyMangleChecksumAsync(built)).toBe(false);
        expect(warn.mock.calls).toEqual([[mapUnavailableLine(built)]]);
    });

    // A census the page carries but nothing can read was damaged on the way:
    // that is what the check is for, so it fails, even when the bundle holds a
    // map that would verify.
    it.each([
        ['fails its schema', '{"__proto__": "x"}'],
        ['was cut short', '{"p-4": "a", "bg-red'],
    ])('fails a census that %s instead of reading past it', async (_case, content) => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        census(content);
        installMangleRuntime({ mangleMap: map });
        expect(await verifyMangleChecksumAsync(await computeMangleChecksumAsync(map))).toBe(false);
        expect(warn.mock.calls).toEqual([[CENSUS_UNREADABLE_LINE]]);
    });
});

describe('lite _sz2 and merge edge branches', () => {
    it('_sz2 short-circuits empty sides and joins both', async () => {
        const { _sz2 } = await import('../src/lite.js');
        expect(_sz2('', 'b')).toBe('b');
        expect(_sz2('', '')).toBe('');
        expect(_sz2('a', '')).toBe('a');
        expect(_sz2('a', 'b')).toBe('a b');
    });

    it('_szMerge skips falsy inputs and dedupes tokens', async () => {
        const { _szMerge } = await import('../src/lite.js');
        expect(_szMerge('p-4 m-2', '', 'p-4 gap-1')).toBe('p-4 m-2 gap-1');
    });
});
