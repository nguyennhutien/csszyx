/**
 * verify-dom.test.ts covers the happy/malformed-JSON paths of
 * loadManifestFromDOM. This covers the remaining branch: a manifest script
 * tag that is present but empty, which exercises the
 * `scriptElement.textContent || ''` fallback (JSDOM gives `''` textContent
 * for an element with no children, so the OR's right side is the one that
 * actually supplies the value passed to JSON.parse).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadManifestFromDOM } from '../src/verify.js';

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('loadManifestFromDOM with an empty manifest script', () => {
    it('fails to parse empty content and logs, returning null', () => {
        const script = document.createElement('script');
        script.id = '__SZ_RECOVERY_MANIFEST__';
        script.type = 'application/json';
        // No textContent assigned — jsdom reports '' here, not null.
        document.body.appendChild(script);
        expect(script.textContent).toBe('');

        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(loadManifestFromDOM()).toBeNull();
        expect(errorLog).toHaveBeenCalled();
    });
});
