/**
 * The Web-Crypto checksum pair and the DOM integrity check — real
 * recomputation, unlike the sync attribute comparison the main suite covers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    computeMangleChecksumAsync,
    verifyMangleChecksumAsync,
    verifyMangleMapIntegrity,
} from '../src/hydration.js';

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

describe('verifyMangleChecksumAsync', () => {
    it('accepts the matching checksum and rejects a different one', async () => {
        const checksum = await computeMangleChecksumAsync(map);
        expect(await verifyMangleChecksumAsync(checksum, map)).toBe(true);
        expect(await verifyMangleChecksumAsync('0000000000000000', map)).toBe(false);
    });
});

describe('verifyMangleMapIntegrity', () => {
    /**
     * Embed the checksum attribute plus a mangle-map script.
     * @param content - Raw JSON for the script tag.
     */
    function embed(content: string): void {
        document.documentElement.setAttribute('data-sz-checksum', 'sum');
        const script = document.createElement('script');
        script.id = '__CSSZYX_MANGLE_MAP__';
        script.type = 'application/json';
        script.textContent = content;
        document.head.appendChild(script);
    }

    afterEach(() => {
        delete (window as unknown as Record<string, unknown>).verify_mangle_checksum;
    });

    // A missing checksum attribute is still a failure: the page claims nothing
    // about which build it came from. A missing census is not — the census
    // follows mangling, and a build that renames nothing writes none, so there
    // is no map in the document to weigh and nothing has gone wrong.
    it('fails without the checksum attribute, and passes without the map script', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(verifyMangleMapIntegrity()).toBe(false);
        expect(warn).toHaveBeenCalled();
        document.documentElement.setAttribute('data-sz-checksum', 'sum');
        expect(verifyMangleMapIntegrity()).toBe(true);
    });

    it('accepts a schema-valid map without the WASM verifier — detection, fail-open', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        embed(JSON.stringify(map));
        expect(verifyMangleMapIntegrity()).toBe(true);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('unverified'));
    });

    it('delegates to the WASM verifier when present', () => {
        embed(JSON.stringify(map));
        const win = window as unknown as Record<string, unknown>;
        win.verify_mangle_checksum = () => false;
        expect(verifyMangleMapIntegrity()).toBe(false);
        win.verify_mangle_checksum = () => true;
        expect(verifyMangleMapIntegrity()).toBe(true);
    });

    it('rejects a schema-invalid or unparseable map', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        embed('{"__proto__": "x"}');
        expect(verifyMangleMapIntegrity()).toBe(false);
        document.head.innerHTML = '';
        embed('{ not json');
        expect(verifyMangleMapIntegrity()).toBe(false);
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
