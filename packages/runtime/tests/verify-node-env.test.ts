// @vitest-environment node
/**
 * loadManifestFromDOM()'s `typeof document === 'undefined'` guard cannot be
 * exercised under the package's default jsdom environment (document is
 * always defined there) — verify-dom.test.ts covers the DOM-present paths.
 * This file opts into a real node environment (no DOM globals at all) to
 * exercise the SSR/non-DOM guard for real, matching the precedent in
 * packages/dynamic (node-default project, jsdom opt-in per file) applied in
 * reverse (jsdom-default project, node opt-in per file).
 */
import { describe, expect, it } from 'vitest';

import { loadManifestFromDOM } from '../src/verify.js';

describe('loadManifestFromDOM without a DOM', () => {
    it('returns null when document is undefined', () => {
        expect(typeof document).toBe('undefined');
        expect(loadManifestFromDOM()).toBeNull();
    });
});
