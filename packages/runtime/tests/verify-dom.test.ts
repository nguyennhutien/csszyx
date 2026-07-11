/**
 * DOM-backed recovery-manifest readers: loading the embedded manifest script
 * and scanning a subtree for recovery tokens.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isValidManifest, loadManifestFromDOM, verifyAllTokens } from '../src/verify.js';

const manifest = { buildId: 'b1', checksum: 'c1', mangleChecksum: 'm1', tokens: {} };

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('loadManifestFromDOM', () => {
    it('returns null when no manifest script is embedded', () => {
        expect(loadManifestFromDOM()).toBeNull();
    });

    it('parses the manifest JSON from the embedded script', () => {
        const script = document.createElement('script');
        script.id = '__SZ_RECOVERY_MANIFEST__';
        script.textContent = JSON.stringify(manifest);
        document.body.appendChild(script);
        expect(loadManifestFromDOM()).toEqual(manifest);
    });

    it('returns null and logs when the manifest JSON is malformed', () => {
        const script = document.createElement('script');
        script.id = '__SZ_RECOVERY_MANIFEST__';
        script.textContent = '{ not json';
        document.body.appendChild(script);
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(loadManifestFromDOM()).toBeNull();
        expect(errorLog).toHaveBeenCalled();
    });
});

describe('isValidManifest', () => {
    it('accepts a well-formed manifest and rejects malformed shapes', () => {
        expect(isValidManifest(manifest)).toBe(true);
        expect(isValidManifest(null)).toBe(false);
        expect(isValidManifest({})).toBe(false);
        expect(isValidManifest({ ...manifest, tokens: null })).toBe(false);
    });
});

describe('verifyAllTokens', () => {
    it('runs verification for every recovery-token element in the subtree', () => {
        document.body.innerHTML =
            '<div data-sz-recovery-token="a"></div>' +
            '<span data-sz-recovery-token="b"></span>' +
            '<p>no token</p>';
        const results = verifyAllTokens(document.body, manifest);
        expect(results).toHaveLength(2);
    });

    it('returns an empty array when the subtree has no tokens', () => {
        document.body.innerHTML = '<div></div>';
        expect(verifyAllTokens(document.body, manifest)).toHaveLength(0);
    });
});
