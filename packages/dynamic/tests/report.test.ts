/**
 * The manifest accounting report.
 *
 * The manifest is a wager — transfer the class census once, skip injecting
 * rules the built CSS already has — and whether it pays depends on how much of
 * an app runs through `dynamic()`. Build-time analysis cannot answer that,
 * because `dynamic()` exists for values unknown at build time. These lock the
 * runtime answer, including the shape that costs the most: a manifest that
 * loads but arrives after the first render.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// Hoisted, not in a hook: `isServer` is a module-level const evaluated when
// `../src/ssr.js` is first imported, so a `document` installed in `beforeEach`
// arrives too late and `dynamic()` takes its server path — returning class
// names without touching the CSSOM, which would make every assertion here read
// zero for the wrong reason.
vi.hoisted(() => {
    /** Minimal constructable-stylesheet stand-in, as the injector suite uses. */
    class MockSheet {
        cssRules: Array<{ cssText: string }> = [];
        /**
         * @param text - Rule text.
         * @param index - Insert position.
         */
        insertRule(text: string, index: number): void {
            this.cssRules.splice(index, 0, { cssText: text });
        }
    }
    let adopted: MockSheet[] = [];
    const globals = globalThis as Record<string, unknown>;
    globals.CSSStyleSheet = MockSheet;
    globals.document = {
        get adoptedStyleSheets() {
            return adopted;
        },
        set adoptedStyleSheets(value: MockSheet[]) {
            adopted = value;
        },
    };
});

import { cleanup, dynamic, dynamicReport, preloadManifest } from '../src/index.js';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/**
 * Point the real fetch path at a manifest payload.
 *
 * @param classes - Classes the build emitted.
 */
function stubManifestFetch(classes: readonly string[]): void {
    const payload = { version: '0.4.0', buildId: 'test', classes };
    vi.stubGlobal('fetch', () =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }),
    );
}

/**
 * Serve a manifest and wait for it, as an app that preloads properly does.
 *
 * @param classes - Classes the build emitted.
 */
async function serveManifest(classes: readonly string[]): Promise<void> {
    stubManifestFetch(classes);
    await preloadManifest();
}

describe('dynamicReport', () => {
    it('says nothing was measured before dynamic() has run', () => {
        const report = dynamicReport();
        expect(report.verdict).toBe('not-measured');
        expect(report.asked).toBe(0);
        expect(report.summary).toContain('exercise the app first');
    });

    it('reports the injected cost when no manifest was loaded', () => {
        dynamic({ p: 4, bg: 'blue-500' });
        const report = dynamicReport();
        expect(report.verdict).toBe('no-manifest');
        expect(report.manifestHits).toBe(0);
        expect(report.injected).toBe(2);
        expect(report.injectedBytes).toBeGreaterThan(0);
        // Nothing was spared, so the spared figure is what one COULD save.
        expect(report.sparedBytes).toBe(0);
        expect(report.summary).toContain('build.emitManifest');
    });

    it('tells the app to drop a manifest that cost more than it spared', async () => {
        // The ordinary shape: a census far larger than the classes dynamic()
        // renders, so the transfer dwarfs the injections it prevents.
        const census = Array.from({ length: 400 }, (_, index) => `mt-${index + 1}`);
        await serveManifest([...census, 'p-4']);
        dynamic({ p: 4 });

        const report = dynamicReport();
        expect(report.verdict).toBe('drop-manifest');
        expect(report.manifestHits).toBe(1);
        expect(report.injected).toBe(0);
        expect(report.manifestBytes).toBeGreaterThan(report.sparedBytes);
        expect(report.summary).toContain('set build.emitManifest to false');
    });

    it('tells the app to keep a manifest that spared more than it cost', async () => {
        // Runtime-heavy: nearly everything the app renders comes through
        // dynamic(), so the census is almost entirely useful.
        const classes = Array.from({ length: 60 }, (_, index) => `p-${index + 1}`);
        await serveManifest(classes);
        for (let index = 0; index < 60; index += 1) dynamic({ p: index + 1 });

        const report = dynamicReport();
        expect(report.verdict).toBe('keep-manifest');
        expect(report.sparedBytes).toBeGreaterThan(report.manifestBytes);
        expect(report.summary).toContain('keep build.emitManifest on');
    });

    it('names an unawaited preload, the shape that pays both costs', async () => {
        // Exactly what an app that never awaits preloadManifest does: the fetch
        // is stubbed and in flight, but `dynamic()` is synchronous, so the first
        // render resolves against a manifest that has not arrived and injects.
        // Stubbing fetch BEFORE that first call matters — an unstubbed one
        // rejects, and a failed load is final for the session, so the later
        // preload would return the empty result instead of this payload.
        stubManifestFetch(['p-4', 'bg-blue-500']);
        dynamic({ p: 4 });
        await preloadManifest();
        dynamic({ bg: 'blue-500' });

        const report = dynamicReport();
        expect(report.injected).toBe(1);
        expect(report.manifestHits).toBe(1);
        expect(report.summary).toContain('before the manifest arrived');
        expect(report.summary).toContain('preloadManifest');
    });

    it('stays silent about arrival order when the manifest answered everything', async () => {
        await serveManifest(['p-4']);
        dynamic({ p: 4 });
        expect(dynamicReport().summary).not.toContain('before the manifest arrived');
    });

    it('counts each class once however often it is rendered', async () => {
        await serveManifest(['p-4']);
        for (let index = 0; index < 5; index += 1) dynamic({ p: 4 });
        const report = dynamicReport();
        expect(report.asked).toBe(1);
        expect(report.manifestHits).toBe(1);
    });
});
