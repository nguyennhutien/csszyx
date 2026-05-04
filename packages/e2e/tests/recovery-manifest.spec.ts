/**
 * E2E tests for the szRecover hydration recovery system.
 *
 * Closes the loop on the build → SSR-HTML → runtime-verify pipeline that
 * @csszyx/runtime/verify expected but the unplugin never wired up. The
 * fixture lives at playground/vite-react/src/Recovery.tsx, served via
 * `?page=recovery`.
 *
 * What's covered:
 *   - The compiler visitor tags every szRecover element with a
 *     deterministic `data-sz-recovery-token` of the right shape.
 *   - The unplugin injects `<script id="__SZ_RECOVERY_MANIFEST__">` and
 *     the JSON has the contract shape `{ buildId, checksum, tokens }`.
 *   - csr + dev-only modes both produce manifest entries in dev (the
 *     production strip is exercised by the unit tests in
 *     packages/unplugin/tests/recovery-manifest.test.ts; running a fresh
 *     production build per spec is not worth the cost here).
 *   - Unknown szRecover values produce no token and no manifest entry.
 *   - Per-element token matches the manifest entry the runtime would
 *     look up via `loadManifestFromDOM` + `verifyRecoveryToken`.
 */

import { expect, test } from '@playwright/test';

/**
 * Subset of the runtime's `RecoveryManifest` interface used by these tests.
 * The full interface lives in `@csszyx/runtime/verify`; we don't import it
 * here to keep the e2e package free of runtime-side deps.
 */
interface RecoveryManifest {
    buildId: string;
    checksum: string;
    tokens: Record<string, { mode: string; component: string; path: string }>;
}

/**
 * Parse the manifest script body and assert it is non-null. Centralised so
 * each test gets the same failure message when the script tag is missing.
 *
 * @param raw `textContent` of the manifest `<script>` element.
 * @returns Parsed manifest. Throws via `expect` if `raw` is null.
 */
function parseManifest(raw: string | null): RecoveryManifest {
    expect(raw, 'manifest script body must be present').not.toBeNull();
    return JSON.parse(raw ?? '{}');
}

test.describe('Recovery manifest pipeline (vite-react fixture)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/?page=recovery');
        await page.locator('[data-testid="title"]').waitFor();
    });

    test('csr element gets a data-sz-recovery-token of the right shape', async ({ page }) => {
        const csr = page.locator('[data-testid="csr-section"]');
        const token = await csr.getAttribute('data-sz-recovery-token');
        expect(token, 'csr element must carry a recovery token').not.toBeNull();
        expect(token).toMatch(/^[0-9a-f]{12}$/);
        // The visitor preserves szRecover so the runtime can match it against the token's mode.
        expect(await csr.getAttribute('szRecover')).toBe('csr');
    });

    test('dev-only element also gets a recovery token in development builds', async ({ page }) => {
        const devOnly = page.locator('[data-testid="dev-only-section"]');
        const token = await devOnly.getAttribute('data-sz-recovery-token');
        expect(token).toMatch(/^[0-9a-f]{12}$/);
        expect(await devOnly.getAttribute('szRecover')).toBe('dev-only');
    });

    test('unknown szRecover modes produce no token', async ({ page }) => {
        // The visitor logs a diagnostic but does not write the attribute.
        // Production behaviour is "fail closed" — we'd rather have no token
        // than a meaningless one the runtime can never verify.
        const unknown = page.locator('[data-testid="unknown-mode-section"]');
        expect(await unknown.getAttribute('data-sz-recovery-token')).toBeNull();
    });

    test('manifest script tag is injected with the expected JSON shape', async ({ page }) => {
        const script = page.locator('script#__SZ_RECOVERY_MANIFEST__');
        await expect(script).toHaveAttribute('type', 'application/json');

        const manifest = parseManifest(await script.textContent());
        expect(manifest.buildId).toMatch(/^[0-9a-z]+-[0-9a-f]{6}$/);
        expect(manifest.checksum).toMatch(/^[0-9a-f]{16}$/);
        expect(typeof manifest.tokens).toBe('object');
    });

    test('manifest entries match the tokens written into the DOM', async ({ page }) => {
        const csrToken = await page.locator('[data-testid="csr-section"]').getAttribute('data-sz-recovery-token');
        const devToken = await page.locator('[data-testid="dev-only-section"]').getAttribute('data-sz-recovery-token');
        if (csrToken === null || devToken === null) {
            throw new Error('Recovery tokens missing from fixture DOM — earlier tests should have caught this.');
        }

        const manifest = parseManifest(await page.locator('script#__SZ_RECOVERY_MANIFEST__').textContent());

        // Each DOM token must have a matching manifest entry whose mode lines up.
        expect(manifest.tokens[csrToken]?.mode).toBe('csr');
        expect(manifest.tokens[devToken]?.mode).toBe('dev-only');
        // Component name is recorded so the runtime can produce useful diagnostics.
        expect(manifest.tokens[csrToken]?.component).toBe('section');
    });

    test('runtime loadManifestFromDOM finds the same manifest', async ({ page }) => {
        // The runtime uses document.getElementById('__SZ_RECOVERY_MANIFEST__'),
        // not a query selector — verify that path resolves end-to-end inside
        // a real browser context.
        const found = await page.evaluate(() => {
            const el = document.getElementById('__SZ_RECOVERY_MANIFEST__');
            if (!el) {return null;}
            try {
                return JSON.parse(el.textContent ?? '{}');
            } catch {
                return null;
            }
        });
        expect(found).not.toBeNull();
        expect(typeof found.buildId).toBe('string');
        expect(typeof found.checksum).toBe('string');
        expect(Object.keys(found.tokens).length).toBeGreaterThanOrEqual(2);
    });

    test('manifest probe React component reports valid manifest', async ({ page }) => {
        // The fixture renders a small probe that runs in the page's React
        // context — useful as a sanity check that any framework-side code
        // can reach the manifest the same way (no special escaping).
        const probe = page.locator('[data-testid="manifest-probe"]');
        await expect(probe).not.toHaveText('pending');
        const reported = JSON.parse(await probe.textContent() ?? '{}');
        expect(reported.buildId).toBe(true);
        expect(reported.checksum).toBe(true);
        expect(reported.tokenCount).toBeGreaterThanOrEqual(2);
    });
});
