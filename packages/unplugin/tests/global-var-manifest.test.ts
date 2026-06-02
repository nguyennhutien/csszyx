import { describe, expect, it } from 'vitest';

import {
    createGlobalVarMapAssetSource,
    extractGlobalVarAliasesForManifest,
    normalizeGlobalVarAliasesForCache,
} from '../src/unplugin.js';

describe('extractGlobalVarAliasesForManifest', () => {
    it('keeps only active global aliases in stable original-name order', () => {
        expect(
            extractGlobalVarAliasesForManifest({
                '--z-token': '---gx',
                '--_sz-p': '--sz',
                '--brand-primary': '---gz',
                '--card-gap': ['--cz', '---gy'],
                '--component-local': ['--cz', '--sz'],
            }),
        ).toEqual({
            '--brand-primary': '---gz',
            '--card-gap': '---gy',
            '--z-token': '---gx',
        });
    });

    it('filters global aliases with a custom active prefix', () => {
        expect(
            extractGlobalVarAliasesForManifest(
                {
                    '--brand-primary': '--gxz',
                    '--default-prefix': '---gz',
                    '--component-local': ['--cz', '--sz'],
                },
                '--gx',
            ),
        ).toEqual({
            '--brand-primary': '--gxz',
        });
    });

    it('returns an empty map when no global aliases are present', () => {
        expect(
            extractGlobalVarAliasesForManifest({
                '--_sz-p': '--sz',
                '--component-local': ['--cz', '--sz'],
            }),
        ).toEqual({});
    });

    it('serializes the standalone global var map asset only when aliases exist', () => {
        expect(
            createGlobalVarMapAssetSource({
                '--brand-primary': '---gz',
                '--_sz-p': '--sz',
            }),
        ).toBe('{"--brand-primary":"---gz"}');
        expect(createGlobalVarMapAssetSource({ '--_sz-p': '--sz' })).toBeNull();
    });

    it('normalizes compiler aliases for transform cache identity', () => {
        expect(
            normalizeGlobalVarAliasesForCache({
                '--z-token': '--g2',
                nope: '--bad',
                '--bad': 'g3',
                '--brand-primary': '--g0',
            }),
        ).toEqual([
            ['--brand-primary', '--g0'],
            ['--z-token', '--g2'],
        ]);
        expect(
            normalizeGlobalVarAliasesForCache(
                new Map([
                    ['--z-token', '--g2'],
                    ['--brand-primary', '--g0'],
                ]),
            ),
        ).toEqual([
            ['--brand-primary', '--g0'],
            ['--z-token', '--g2'],
        ]);
    });
});
