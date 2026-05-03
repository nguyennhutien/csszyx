/**
 * Tests for the recovery-manifest build/inject utilities. These mirror the
 * runtime contract in `@csszyx/runtime/verify`:
 *   - `<script id="__SZ_RECOVERY_MANIFEST__" type="application/json">{...}</script>`
 *   - JSON shape: `{ buildId, checksum, tokens: Record<token, {mode, component, path}> }`
 */

import type { TokenData } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import {
    buildRecoveryManifest,
    injectRecoveryManifest,
} from '../src/html-transformer.js';

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
        const m = buildRecoveryManifest(new Map());
        expect(m.tokens).toEqual({});
        expect(m.buildId).toMatch(/^[0-9a-z]+-[0-9a-f]{6}$/);
        expect(m.checksum).toMatch(/^[0-9a-f]{16}$/);
    });

    it('serialises tokens in alphabetical order for stable checksums', () => {
        const a = buildRecoveryManifest(tokenMap(
            ['zzz', { mode: 'csr', component: 'div', path: 'a.tsx:1:0' }],
            ['aaa', { mode: 'csr', component: 'span', path: 'a.tsx:2:0' }],
        ));
        const b = buildRecoveryManifest(tokenMap(
            ['aaa', { mode: 'csr', component: 'span', path: 'a.tsx:2:0' }],
            ['zzz', { mode: 'csr', component: 'div', path: 'a.tsx:1:0' }],
        ));
        // Same logical content — checksums must match regardless of insertion order.
        expect(a.checksum).toBe(b.checksum);
        expect(Object.keys(a.tokens)).toEqual(['aaa', 'zzz']);
    });

    it('includes the full token data in the manifest', () => {
        const data: TokenData = {
            mode: 'dev-only',
            component: 'Button',
            path: 'src/Button.tsx:5:8',
        };
        const m = buildRecoveryManifest(tokenMap(['abc123def456', data]));
        expect(m.tokens['abc123def456']).toEqual(data);
    });

    it('changes checksum when token contents change', () => {
        const a = buildRecoveryManifest(tokenMap(
            ['t1', { mode: 'csr', component: 'div', path: 'a.tsx:1:0' }],
        ));
        const b = buildRecoveryManifest(tokenMap(
            ['t1', { mode: 'dev-only', component: 'div', path: 'a.tsx:1:0' }],
        ));
        expect(a.checksum).not.toBe(b.checksum);
    });
});

describe('injectRecoveryManifest', () => {
    const sampleManifest = {
        buildId: 'abc-def123',
        checksum: '0123456789abcdef',
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
        const scriptMatch = out.match(/<script id="__SZ_RECOVERY_MANIFEST__"[^>]*>([^<]+)<\/script>/);
        expect(scriptMatch).not.toBeNull();
        if (!scriptMatch) {return;}
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
            tokens: {},
        });
        // Don't pollute pages that never use szRecover.
        expect(out).toBe(html);
    });
});
