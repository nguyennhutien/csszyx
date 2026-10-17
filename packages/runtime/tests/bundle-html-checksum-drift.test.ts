/**
 * The one drift the hydration checksum exists to catch: HTML from one build,
 * JS from another.
 *
 * A deploy leaves a CDN serving yesterday's HTML while today's bundle loads
 * beside it. The HTML says `class="z"`; the fresh bundle's map says `p-4` is
 * `q` now, and the fresh CSS has no `.z` rule. Nothing throws. The page simply
 * renders unstyled, in production only, and never on a machine that can
 * reproduce it.
 *
 * Every verifier read both of its values out of the same HTML document — the
 * attribute against a census, or against a manifest tag beside it — so all of
 * them answered "consistent" to a document that is internally consistent and
 * wrong. The bundle carries the build's checksum too, in the registry
 * `installMangleRuntime` fills, and nothing compared the two.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { guardHydration, verifyBundleMatchesDocument } from '../src/hydration.js';
import { clearMangleRegistry, installMangleRuntime } from '../src/mangle-registry.js';

afterEach(() => {
    clearMangleRegistry();
    document.documentElement.removeAttribute('data-sz-checksum');
    document.documentElement.removeAttribute('data-sz-cs');
});

describe('verifyBundleMatchesDocument', () => {
    it('accepts a page whose HTML and bundle came from one build', () => {
        document.documentElement.setAttribute('data-sz-checksum', 'build-one');
        installMangleRuntime({ mangleMap: { 'p-4': 'z' }, checksum: 'build-one' });
        expect(verifyBundleMatchesDocument()).toBe(true);
    });

    // The failure this exists for: stale HTML, fresh bundle.
    it('refuses a page whose HTML predates the bundle', () => {
        document.documentElement.setAttribute('data-sz-checksum', 'build-one');
        installMangleRuntime({ mangleMap: { 'p-4': 'q' }, checksum: 'build-two' });
        expect(verifyBundleMatchesDocument()).toBe(false);
    });

    it('reads the minified spelling of the attribute too', () => {
        document.documentElement.setAttribute('data-sz-cs', 'build-one');
        installMangleRuntime({ mangleMap: { 'p-4': 'z' }, checksum: 'build-one' });
        expect(verifyBundleMatchesDocument()).toBe(true);
    });

    // With no registry there is no second opinion to compare against, and a
    // build without mangling installs none. Absence is not a mismatch.
    it('says nothing is wrong when the bundle carries no map', () => {
        document.documentElement.setAttribute('data-sz-checksum', 'build-one');
        expect(verifyBundleMatchesDocument()).toBe(true);
    });

    it('says nothing is wrong when the document carries no checksum', () => {
        installMangleRuntime({ mangleMap: { 'p-4': 'z' }, checksum: 'build-one' });
        expect(verifyBundleMatchesDocument()).toBe(true);
    });

    // On the server there is no document to disagree with, and the guard must
    // not stop a render that has not reached a browser yet.
    it('says nothing is wrong with no document at all', () => {
        const realDocument = globalThis.document;
        Reflect.deleteProperty(globalThis, 'document');
        try {
            expect(verifyBundleMatchesDocument()).toBe(true);
        } finally {
            Object.defineProperty(globalThis, 'document', {
                value: realDocument,
                configurable: true,
                writable: true,
            });
        }
    });
});

describe('guardHydration', () => {
    /**
     * A manifest shaped the way the build emits one.
     *
     * @param mangleChecksum - The build the manifest claims to belong to.
     * @returns The manifest the guard reads.
     */
    const manifestFor = (mangleChecksum: string) => ({
        version: '0.4.0' as const,
        checksum: 'tokens',
        mangleChecksum,
        tokens: {},
    });

    // The guard used to compare the manifest's checksum to the attribute — and
    // the manifest is another inline tag in the SAME document, so a stale page
    // agreed with itself and hydrated into a bundle that meant something else.
    it('refuses when the bundle disagrees with the document', () => {
        document.documentElement.setAttribute('data-sz-checksum', 'build-one');
        installMangleRuntime({ mangleMap: { 'p-4': 'q' }, checksum: 'build-two' });
        expect(guardHydration(manifestFor('build-one') as never)).toBe(false);
    });

    it('proceeds when the bundle and the document are one build', () => {
        document.documentElement.setAttribute('data-sz-checksum', 'build-one');
        installMangleRuntime({ mangleMap: { 'p-4': 'z' }, checksum: 'build-one' });
        expect(guardHydration(manifestFor('build-one') as never)).toBe(true);
    });
});
