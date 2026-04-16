/**
 * Tests for manifest module.
 * Verifies manifest loading, caching, and delta check logic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type CSSManifest,
    ensureManifest,
    isManifestLoaded,
    lookupManifest,
    preloadManifest,
    resetManifest,
} from '../src/manifest.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/**
 * Creates a complete CSSManifest fixture with sensible defaults for testing.
 *
 * @param partial - optional overrides to merge into the default manifest
 * @returns a fully-formed CSSManifest object suitable for use in tests
 */
function makeMockManifest(partial: Partial<CSSManifest> = {}): CSSManifest {
    return {
        version: '0.4.0',
        buildId: 'test-build-id',
        classes: ['p-4', 'bg-blue-500', 'flex', 'text-white'],
        ...partial,
    };
}

/**
 * Configures the global fetch mock to resolve successfully with the given manifest.
 *
 * @param manifest - the CSSManifest object that the mocked fetch should return
 * @returns void
 */
function setupFetchSuccess(manifest: CSSManifest): void {
    mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(manifest),
    });
}

describe('manifest loading', () => {
    beforeEach(() => {
        resetManifest();
        mockFetch.mockReset();
    });

    afterEach(() => {
        resetManifest();
    });

    it('isManifestLoaded returns false before loading', () => {
        expect(isManifestLoaded()).toBe(false);
    });

    it('lookupManifest returns null before manifest loads', () => {
        expect(lookupManifest('p-4')).toBeNull();
    });

    it('preloadManifest fetches and caches manifest', async () => {
        setupFetchSuccess(makeMockManifest());
        await preloadManifest('/csszyx-manifest.json');

        expect(isManifestLoaded()).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith('/csszyx-manifest.json');
    });

    it('uses custom URL passed to preloadManifest', async () => {
        setupFetchSuccess(makeMockManifest());
        await preloadManifest('/custom/path/manifest.json');

        expect(mockFetch).toHaveBeenCalledWith('/custom/path/manifest.json');
    });

    it('coalesces concurrent ensureManifest calls', async () => {
        setupFetchSuccess(makeMockManifest());

        // Trigger two concurrent loads
        const p1 = ensureManifest();
        const p2 = ensureManifest();
        await Promise.all([p1, p2]);

        // Only one fetch should have been made
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('gracefully handles fetch failure — treats all classes as new', async () => {
        mockFetch.mockRejectedValueOnce(new Error('network error'));
        await ensureManifest();

        expect(isManifestLoaded()).toBe(true); // loaded (empty fallback)
        expect(lookupManifest('p-4')).toBeNull(); // not in empty set
    });

    it('gracefully handles non-ok response', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
        await ensureManifest();

        expect(isManifestLoaded()).toBe(true);
        expect(lookupManifest('p-4')).toBeNull();
    });
});

describe('manifest delta check', () => {
    beforeEach(async () => {
        resetManifest();
        mockFetch.mockReset();
        setupFetchSuccess(makeMockManifest());
        await preloadManifest();
    });

    afterEach(() => {
        resetManifest();
    });

    it('returns original class name for class in manifest (no mangle map)', () => {
        expect(lookupManifest('p-4')).toBe('p-4');
        expect(lookupManifest('bg-blue-500')).toBe('bg-blue-500');
        expect(lookupManifest('flex')).toBe('flex');
    });

    it('returns null for class not in manifest', () => {
        expect(lookupManifest('p-7')).toBeNull(); // not in test manifest
        expect(lookupManifest('bg-red-300')).toBeNull();
    });

    it('returns mangled name when mangle map is present', async () => {
        resetManifest();
        mockFetch.mockReset();
        setupFetchSuccess(makeMockManifest({
            classes: ['p-4', 'bg-blue-500'],
            mangleMap: { 'p-4': 'z', 'bg-blue-500': 'y' },
        }));
        await preloadManifest();

        expect(lookupManifest('p-4')).toBe('z');
        expect(lookupManifest('bg-blue-500')).toBe('y');
    });

    it('returns original name for class in manifest but not in mangle map', async () => {
        resetManifest();
        mockFetch.mockReset();
        setupFetchSuccess(makeMockManifest({
            classes: ['p-4', 'flex'],
            mangleMap: { 'p-4': 'z' }, // 'flex' not in mangle map
        }));
        await preloadManifest();

        expect(lookupManifest('p-4')).toBe('z');
        expect(lookupManifest('flex')).toBe('flex'); // original name
    });
});

describe('resetManifest', () => {
    it('clears loaded state and allows re-fetch', async () => {
        setupFetchSuccess(makeMockManifest());
        await preloadManifest();
        expect(isManifestLoaded()).toBe(true);

        resetManifest();
        expect(isManifestLoaded()).toBe(false);
        expect(lookupManifest('p-4')).toBeNull();

        // Can reload after reset
        setupFetchSuccess(makeMockManifest({ classes: ['new-class'] }));
        await preloadManifest();
        expect(lookupManifest('new-class')).toBe('new-class');
        expect(lookupManifest('p-4')).toBeNull(); // old class gone
    });
});
