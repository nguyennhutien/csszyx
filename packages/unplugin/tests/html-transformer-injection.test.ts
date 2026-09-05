/**
 * The HTML injection surfaces beyond what the main html-transformer suite
 * covers: injection modes, tag-placement fallbacks, the namespaced hydration
 * map, and the recovery-manifest build/injection pair.
 */
import { describe, expect, it } from 'vitest';

import {
    buildRecoveryManifest,
    createHydrationMangleMap,
    injectHydrationData,
    injectMangleMapScript,
    injectRecoveryManifest,
    transformIndexHtml,
} from '../src/html-transformer';

const page = '<html><head></head><body></body></html>';
const map = { 'p-4': 'z' };

describe('injectMangleMapScript placement', () => {
    it('injects before </head> when present', () => {
        const result = injectMangleMapScript(page, map);
        expect(result.indexOf('__CSSZYX_MANGLE_MAP__')).toBeLessThan(result.indexOf('</head>'));
    });

    it('falls back to </html> and then to appending', () => {
        const noHead = injectMangleMapScript('<html><body></body></html>', map);
        expect(noHead.indexOf('__CSSZYX_MANGLE_MAP__')).toBeLessThan(noHead.indexOf('</html>'));
        const bare = injectMangleMapScript('<div>x</div>', map);
        expect(bare).toContain('__CSSZYX_MANGLE_MAP__');
    });
});

describe('injectHydrationData modes', () => {
    it('injects the checksum attribute plus the script tag', () => {
        const result = injectHydrationData(page, map, 'sum');
        expect(result).toContain('data-sz-checksum="sum"');
        expect(result).toContain('__CSSZYX_MANGLE_MAP__');
        expect(result).not.toContain('data-sz-map=');
    });

    it('minify shortens the checksum attribute and keeps the script', () => {
        const result = injectHydrationData(page, map, 'sum', { minify: true });
        expect(result).toContain('data-sz-cs="sum"');
        expect(result).toContain('__CSSZYX_MANGLE_MAP__');
    });

    it('transformIndexHtml delegates to the same injection', () => {
        expect(transformIndexHtml(page, map, 'sum')).toBe(injectHydrationData(page, map, 'sum'));
    });
});

describe('createHydrationMangleMap', () => {
    it('returns the class map unchanged when no variables are mangled', () => {
        expect(createHydrationMangleMap(map)).toBe(map);
    });

    it('namespaces classes and variables, expanding array values', () => {
        const payload = createHydrationMangleMap(map, { '--a': 'x', '--b': ['y', 'z'] });
        expect(payload['class:p-4']).toBe('z');
        expect(payload['var:--a']).toBe('x');
        expect(payload['var:--b:y']).toBe('y');
        expect(payload['var:--b:z']).toBe('z');
    });
});

describe('recovery manifest build + injection', () => {
    const tokens = new Map([
        ['tokenB', { mode: 'csr' as const, component: 'Card', path: 'src/Card.tsx:1:1' }],
        ['tokenA', { mode: 'dev-only' as const, component: 'Nav', path: 'src/Nav.tsx:2:2' }],
    ]);

    it('keeps all tokens with paths in development', () => {
        const { manifest, strippedDevOnlyPaths } = buildRecoveryManifest(tokens, {
            mangleChecksum: 'mc',
        });
        expect(Object.keys(manifest.tokens).sort()).toEqual(['tokenA', 'tokenB']);
        expect(manifest.tokens.tokenB?.path).toBe('src/Card.tsx:1:1');
        expect(manifest.mangleChecksum).toBe('mc');
        expect(strippedDevOnlyPaths).toEqual([]);
    });

    it('strips dev-only tokens and source paths in production', () => {
        const { manifest, strippedDevOnlyPaths } = buildRecoveryManifest(tokens, {
            production: true,
            mangleChecksum: 'mc',
        });
        expect(Object.keys(manifest.tokens)).toEqual(['tokenB']);
        expect(manifest.tokens.tokenB?.path).toBe('');
        expect(strippedDevOnlyPaths).toEqual(['src/Nav.tsx:2:2']);
    });

    it('injects the manifest script only when tokens exist', () => {
        const { manifest } = buildRecoveryManifest(tokens, { mangleChecksum: 'mc' });
        expect(injectRecoveryManifest(page, manifest)).toContain('__SZ_RECOVERY_MANIFEST__');
        const empty = { ...manifest, tokens: {} };
        expect(injectRecoveryManifest(page, empty)).toBe(page);
        // Placement fallbacks mirror the mangle-map script.
        expect(injectRecoveryManifest('<html><body></body></html>', manifest)).toContain(
            '__SZ_RECOVERY_MANIFEST__',
        );
        expect(injectRecoveryManifest('<div />', manifest)).toContain('__SZ_RECOVERY_MANIFEST__');
    });
});
