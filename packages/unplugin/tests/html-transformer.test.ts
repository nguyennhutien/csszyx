import { describe, expect, it } from 'vitest';

import {
    createHydrationMangleMap,
    injectChecksum,
    injectHydrationData,
    injectMangleMapAttribute,
    injectMangleMapScript,
    transformIndexHtml,
} from '../src/html-transformer.js';

describe('html-transformer', () => {
    const sampleHtml = '<html lang="en"><head></head><body></body></html>';
    const sampleMap = { 'p-4': 'z', 'bg-red-500': 'y', 'text-white': 'x' };
    const sampleVarMap = { '--_sz-p': '--sz', '--_sz-m': '--sz' };
    const mixedTierVarMap = { '--_sz-p': ['--cz', '--sz'] };
    const globalVarMap = { '--brand-primary': '--g0', '--_sz-p': '--sz' };
    const sampleChecksum = 'a1b2c3d4e5f67890';

    describe('injectChecksum', () => {
        it('should inject checksum into <html> tag', () => {
            const result = injectChecksum(sampleHtml, sampleChecksum);
            expect(result).toContain('data-sz-checksum="a1b2c3d4e5f67890"');
            expect(result).toContain('lang="en"');
        });

        it('should use minified attribute name when minify is true', () => {
            const result = injectChecksum(sampleHtml, sampleChecksum, true);
            expect(result).toContain('data-sz-cs="a1b2c3d4e5f67890"');
            expect(result).not.toContain('data-sz-checksum');
        });

        it('should return unchanged HTML if no <html> tag found', () => {
            const noHtml = '<div>content</div>';
            const result = injectChecksum(noHtml, sampleChecksum);
            expect(result).toBe(noHtml);
        });

        it('should handle <html> with no existing attributes', () => {
            const result = injectChecksum('<html><head></head></html>', sampleChecksum);
            expect(result).toContain('data-sz-checksum="a1b2c3d4e5f67890"');
        });
    });

    describe('injectMangleMapScript', () => {
        it('should inject script tag before </head>', () => {
            const result = injectMangleMapScript(sampleHtml, sampleMap);
            expect(result).toContain('<script id="__CSSZYX_MANGLE_MAP__" type="application/json">');
            expect(result).toContain(JSON.stringify(sampleMap));
            expect(result).toContain('</head>');
        });

        it('should inject debug script with window.__csszyx helper', () => {
            const result = injectMangleMapScript(sampleHtml, sampleMap);
            expect(result).toContain('window.__csszyx=');
            expect(result).toContain('decode:function');
            expect(result).toContain('encode:function');
            expect(result).toContain('decodeAll:function');
        });

        it('should inject before </html> if no </head>', () => {
            const noHead = '<html><body></body></html>';
            const result = injectMangleMapScript(noHead, sampleMap);
            expect(result).toContain('</html>');
            expect(result).toContain('window.__csszyx=');
        });

        it('should append at end if no closing tags', () => {
            const plain = '<div>content</div>';
            const result = injectMangleMapScript(plain, sampleMap);
            expect(result).toContain(plain);
            expect(result).toContain('window.__csszyx=');
        });

        it('should pretty-print JSON when option is set', () => {
            const result = injectMangleMapScript(sampleHtml, sampleMap, { prettyPrint: true });
            expect(result).toContain(JSON.stringify(sampleMap, null, 2));
        });

        it('should handle empty mangle map', () => {
            const result = injectMangleMapScript(sampleHtml, {});
            expect(result).toContain('>{}</script>');
        });

        it('should include CSS variable map in checksum payload and debug helpers', () => {
            const result = injectMangleMapScript(sampleHtml, sampleMap, {
                varMangleMap: sampleVarMap,
            });

            expect(result).toContain(
                JSON.stringify(createHydrationMangleMap(sampleMap, sampleVarMap)),
            );
            expect(result).toContain(`var vm=${JSON.stringify(sampleVarMap)}`);
            expect(result).toContain('decodeVar:function');
            expect(result).toContain('encodeVar:function');
            expect(result).toContain('decodeGlobalVar:function');
        });

        it('should reverse one-to-many CSS variable maps for debug helpers', () => {
            const result = injectMangleMapScript(sampleHtml, sampleMap, {
                varMangleMap: mixedTierVarMap,
            });

            expect(result).toContain(`var vm=${JSON.stringify(mixedTierVarMap)}`);
            expect(result).toContain('Array.isArray(vv)?vv:[vv]');
        });

        it('should decode global variable aliases without treating dynamic vars as global', () => {
            const result = injectMangleMapScript(sampleHtml, sampleMap, {
                varMangleMap: globalVarMap,
            });
            const debugScript = result.match(/<script>(\(function\(\).*?)<\/script>/)?.[1];
            expect(debugScript).toBeDefined();

            const win = {} as {
                __csszyx?: {
                    decodeGlobalVar(alias: string): string | undefined;
                };
            };
            const doc = {
                documentElement: {
                    getAttribute: () => sampleChecksum,
                },
            };
            new Function('window', 'document', debugScript ?? '')(win, doc);

            expect(win.__csszyx?.decodeGlobalVar('--g0')).toBe('--brand-primary');
            expect(win.__csszyx?.decodeGlobalVar('--sz')).toBeUndefined();
        });
    });

    describe('injectMangleMapAttribute', () => {
        it('should inject data-sz-map attribute on <html>', () => {
            const result = injectMangleMapAttribute(sampleHtml, sampleMap);
            expect(result).toContain("data-sz-map='");
            expect(result).toContain(JSON.stringify(sampleMap));
        });

        it('should use minified attribute name', () => {
            const result = injectMangleMapAttribute(sampleHtml, sampleMap, true);
            expect(result).toContain("data-sz-m='");
            expect(result).not.toContain('data-sz-map');
        });

        it('should return unchanged HTML if no <html> tag', () => {
            const noHtml = '<div>content</div>';
            const result = injectMangleMapAttribute(noHtml, sampleMap);
            expect(result).toBe(noHtml);
        });

        it('should include CSS variable map in inline checksum payload', () => {
            const result = injectMangleMapAttribute(sampleHtml, sampleMap, false, sampleVarMap);
            expect(result).toContain(
                JSON.stringify(createHydrationMangleMap(sampleMap, sampleVarMap)),
            );
        });
    });

    describe('injectHydrationData', () => {
        it('should inject checksum and script tag by default (script mode)', () => {
            const result = injectHydrationData(sampleHtml, sampleMap, sampleChecksum);
            expect(result).toContain('data-sz-checksum="a1b2c3d4e5f67890"');
            expect(result).toContain('window.__csszyx=');
        });

        it('should inject inline mode (attribute only)', () => {
            const result = injectHydrationData(sampleHtml, sampleMap, sampleChecksum, {
                mode: 'inline',
            });
            expect(result).toContain('data-sz-checksum');
            expect(result).toContain('data-sz-map');
            expect(result).not.toContain('window.__csszyx=');
        });

        it('should inject both modes', () => {
            const result = injectHydrationData(sampleHtml, sampleMap, sampleChecksum, {
                mode: 'both',
            });
            expect(result).toContain('data-sz-checksum');
            expect(result).toContain('data-sz-map');
            expect(result).toContain('window.__csszyx=');
        });

        it('should support minify option', () => {
            const result = injectHydrationData(sampleHtml, sampleMap, sampleChecksum, {
                mode: 'both',
                minify: true,
            });
            expect(result).toContain('data-sz-cs=');
            expect(result).toContain('data-sz-m=');
        });
    });

    describe('transformIndexHtml', () => {
        it('should delegate to injectHydrationData', () => {
            const result = transformIndexHtml(sampleHtml, sampleMap, sampleChecksum);
            const expected = injectHydrationData(sampleHtml, sampleMap, sampleChecksum);
            expect(result).toBe(expected);
        });

        it('should pass options through', () => {
            const opts = { mode: 'inline' as const, minify: true };
            const result = transformIndexHtml(sampleHtml, sampleMap, sampleChecksum, opts);
            const expected = injectHydrationData(sampleHtml, sampleMap, sampleChecksum, opts);
            expect(result).toBe(expected);
        });
    });

    describe('createHydrationMangleMap', () => {
        it('preserves the historical class map when no var map exists', () => {
            expect(createHydrationMangleMap(sampleMap)).toBe(sampleMap);
        });

        it('prefixes class and var namespaces when var map exists', () => {
            expect(createHydrationMangleMap(sampleMap, sampleVarMap)).toEqual({
                'class:p-4': 'z',
                'class:bg-red-500': 'y',
                'class:text-white': 'x',
                'var:--_sz-p': '--sz',
                'var:--_sz-m': '--sz',
            });
        });

        it('keeps one-to-many CSS variable maps checksum-safe', () => {
            expect(createHydrationMangleMap(sampleMap, mixedTierVarMap)).toEqual({
                'class:p-4': 'z',
                'class:bg-red-500': 'y',
                'class:text-white': 'x',
                'var:--_sz-p:--cz': '--cz',
                'var:--_sz-p:--sz': '--sz',
            });
        });
    });
});
