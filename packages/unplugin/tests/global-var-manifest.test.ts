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
                '--z-token': '--zgx',
                '--_sz-p': '--sz',
                '--brand-primary': '--zgz',
                '--card-gap': ['--cz', '--zgy'],
                '--component-local': ['--cz', '--sz'],
            }),
        ).toEqual({
            '--brand-primary': '--zgz',
            '--card-gap': '--zgy',
            '--z-token': '--zgx',
        });
    });

    it('filters global aliases with a custom active prefix', () => {
        expect(
            extractGlobalVarAliasesForManifest(
                {
                    '--brand-primary': '--gxz',
                    '--default-prefix': '--zgz',
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
                '--brand-primary': '--zgz',
                '--_sz-p': '--sz',
            }),
        ).toBe('{"--brand-primary":"--zgz"}');
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
