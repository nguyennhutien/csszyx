/**
 * Tests for the recovery-manifest build/inject utilities. These mirror the
 * runtime contract in `@csszyx/runtime/verify`:
 *   - `<script id="__SZ_RECOVERY_MANIFEST__" type="application/json">{...}</script>`
 *   - JSON shape: `{ buildId, checksum, mangleChecksum, tokens: Record<token, {mode, component, path}> }`
 */

import type { TokenData } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import { buildRecoveryManifest, injectRecoveryManifest } from '../src/html-transformer.js';

/**
 * Helper: build a token map seeded with one or more entries.
 *
 * @param entries Token-to-data tuples to seed the map with.
 * @returns Map ready to feed into buildRecoveryManifest.
 */
function tokenMap(...entries: Array<[string, TokenData]>): Map<string, TokenData> {
    return new Map(entries);
}

describe('buildRecoveryManifest', () => {
    it('produces empty tokens object for empty input', () => {
        const { manifest } = buildRecoveryManifest(new Map(), {
            mangleChecksum: 'mangle1234567890',
        });
        expect(manifest.tokens).toEqual({});
        expect(manifest.buildId).toMatch(/^[0-9a-z]+-[0-9a-f]{6}$/);
        expect(manifest.checksum).toMatch(/^[0-9a-f]{16}$/);
        expect(manifest.mangleChecksum).toBe('mangle1234567890');
    });

    it('serialises tokens in alphabetical order for stable checksums', () => {
        const a = buildRecoveryManifest(
            tokenMap(
                ['zzz', { mode: 'csr', component: 'div', path: 'a.tsx:1:0' }],
                ['aaa', { mode: 'csr', component: 'span', path: 'a.tsx:2:0' }],
            ),
            { mangleChecksum: 'mangle1234567890' },
        );
        const b = buildRecoveryManifest(
            tokenMap(
                ['aaa', { mode: 'csr', component: 'span', path: 'a.tsx:2:0' }],
                ['zzz', { mode: 'csr', component: 'div', path: 'a.tsx:1:0' }],
            ),
            { mangleChecksum: 'mangle1234567890' },
        );
        // Same logical content — checksums must match regardless of insertion order.
        expect(a.manifest.checksum).toBe(b.manifest.checksum);
        expect(Object.keys(a.manifest.tokens)).toEqual(['aaa', 'zzz']);
    });

    it('includes the full token data in the manifest', () => {
        const data: TokenData = {
            mode: 'dev-only',
            component: 'Button',
            path: 'src/Button.tsx:5:8',
        };
        const { manifest } = buildRecoveryManifest(tokenMap(['abc123def456', data]), {
            mangleChecksum: 'mangle1234567890',
        });
        expect(manifest.tokens.abc123def456).toEqual(data);
    });

    it('changes checksum when token contents change', () => {
        const a = buildRecoveryManifest(
            tokenMap(['t1', { mode: 'csr', component: 'div', path: 'a.tsx:1:0' }]),
            { mangleChecksum: 'mangle1234567890' },
        );
        const b = buildRecoveryManifest(
            tokenMap(['t1', { mode: 'dev-only', component: 'div', path: 'a.tsx:1:0' }]),
            { mangleChecksum: 'mangle1234567890' },
        );
        expect(a.manifest.checksum).not.toBe(b.manifest.checksum);
    });

    it('keeps token checksum separate from mangle checksum', () => {
        const { manifest } = buildRecoveryManifest(
            tokenMap(['t1', { mode: 'csr', component: 'div', path: 'a.tsx:1:0' }]),
            { mangleChecksum: 'mangle1234567890' },
        );

        expect(manifest.checksum).toMatch(/^[0-9a-f]{16}$/);
        expect(manifest.checksum).not.toBe('mangle1234567890');
        expect(manifest.mangleChecksum).toBe('mangle1234567890');
    });

    it('keeps dev-only tokens by default (development build)', () => {
        const { manifest, strippedDevOnlyPaths } = buildRecoveryManifest(
            tokenMap(
                ['t1', { mode: 'dev-only', component: 'div', path: 'a.tsx:1:0' }],
                ['t2', { mode: 'csr', component: 'span', path: 'b.tsx:2:0' }],
            ),
            { mangleChecksum: 'mangle1234567890' },
        );
        expect(Object.keys(manifest.tokens)).toEqual(['t1', 't2']);
        expect(strippedDevOnlyPaths).toEqual([]);
    });

    it('strips dev-only tokens in production builds', () => {
        const { manifest, strippedDevOnlyPaths } = buildRecoveryManifest(
            tokenMap(
                ['t1', { mode: 'dev-only', component: 'div', path: 'src/A.tsx:1:0' }],
                ['t2', { mode: 'csr', component: 'span', path: 'src/B.tsx:2:0' }],
                ['t3', { mode: 'dev-only', component: 'p', path: 'src/C.tsx:3:0' }],
            ),
            { production: true, mangleChecksum: 'mangle1234567890' },
        );
        // dev-only tokens removed entirely; csr survives.
        expect(Object.keys(manifest.tokens)).toEqual(['t2']);
        // Stripped paths returned for the unplugin to surface in a single warning.
        expect(strippedDevOnlyPaths.sort()).toEqual(['src/A.tsx:1:0', 'src/C.tsx:3:0']);
    });

    it('strips the path field from production tokens (no source disclosure)', () => {
        const { manifest } = buildRecoveryManifest(
            tokenMap(
                ['t1', { mode: 'csr', component: 'Button', path: 'src/Button.tsx:5:8' }],
                ['t2', { mode: 'csr', component: 'Card', path: 'src/Card.tsx:12:4' }],
            ),
            { production: true, mangleChecksum: 'mangle1234567890' },
        );
        // Tokens still verify (mode + component intact) but path is blank,
        // so the public manifest can't be used to map the source tree.
        expect(manifest.tokens.t1.path).toBe('');
        expect(manifest.tokens.t2.path).toBe('');
        expect(manifest.tokens.t1.mode).toBe('csr');
        expect(manifest.tokens.t1.component).toBe('Button');
    });

    it('keeps the path field in development tokens (devtools needs it)', () => {
        const { manifest } = buildRecoveryManifest(
            tokenMap(['t1', { mode: 'csr', component: 'Button', path: 'src/Button.tsx:5:8' }]),
            { mangleChecksum: 'mangle1234567890' },
        );
        expect(manifest.tokens.t1.path).toBe('src/Button.tsx:5:8');
    });

    it('checksum reflects post-strip token set in production', () => {
        const dev = buildRecoveryManifest(
            tokenMap(
                ['t1', { mode: 'dev-only', component: 'div', path: 'a.tsx:1:0' }],
                ['t2', { mode: 'csr', component: 'span', path: 'b.tsx:2:0' }],
            ),
            { mangleChecksum: 'mangle1234567890' },
        );
        const prod = buildRecoveryManifest(
            tokenMap(
                ['t1', { mode: 'dev-only', component: 'div', path: 'a.tsx:1:0' }],
                ['t2', { mode: 'csr', component: 'span', path: 'b.tsx:2:0' }],
            ),
            { production: true, mangleChecksum: 'mangle1234567890' },
        );
        // Different token set after strip → different checksum.
        expect(prod.manifest.checksum).not.toBe(dev.manifest.checksum);
    });
});

describe('injectRecoveryManifest', () => {
    const sampleManifest = {
        buildId: 'abc-def123',
        checksum: '0123456789abcdef',
        mangleChecksum: 'fedcba9876543210',
        tokens: {
            t1: { mode: 'csr' as const, component: 'div', path: 'src/A.tsx:1:0' },
        },
    };

    it('inserts the script tag before </head>', () => {
        const html = '<html><head><title>x</title></head><body>x</body></html>';
        const out = injectRecoveryManifest(html, sampleManifest);
        expect(out).toContain('<script id="__SZ_RECOVERY_MANIFEST__" type="application/json">');
        expect(out.indexOf('__SZ_RECOVERY_MANIFEST__')).toBeLessThan(out.indexOf('</head>'));
    });

    it('embeds the full manifest as JSON in the script body', () => {
        const html = '<html><head></head></html>';
        const out = injectRecoveryManifest(html, sampleManifest);
        const scriptMatch = out.match(
            /<script id="__SZ_RECOVERY_MANIFEST__"[^>]*>([^<]+)<\/script>/,
        );
        expect(scriptMatch).not.toBeNull();
        if (!scriptMatch) {
            return;
        }
        const parsed = JSON.parse(scriptMatch[1]);
        expect(parsed).toEqual(sampleManifest);
    });

    it('falls back to </html> when no </head>', () => {
        const html = '<html>x</html>';
        const out = injectRecoveryManifest(html, sampleManifest);
        expect(out).toContain('__SZ_RECOVERY_MANIFEST__');
        expect(out.indexOf('__SZ_RECOVERY_MANIFEST__')).toBeLessThan(out.indexOf('</html>'));
    });

    it('appends to end when no closing tags', () => {
        const html = '<div>raw fragment</div>';
        const out = injectRecoveryManifest(html, sampleManifest);
        expect(out.startsWith(html)).toBe(true);
        expect(out).toContain('__SZ_RECOVERY_MANIFEST__');
    });

    it('is a no-op when manifest has zero tokens', () => {
        const html = '<html><head></head></html>';
        const out = injectRecoveryManifest(html, {
            buildId: 'x',
            checksum: 'y',
            mangleChecksum: 'z',
            tokens: {},
        });
        // Don't pollute pages that never use szRecover.
        expect(out).toBe(html);
    });
});
