import { describe, expect, it } from 'vitest';

import {
    createGlobalVarMapAssetSource,
    extractGlobalVarAliasesForManifest,
} from '../src/unplugin.js';

describe('extractGlobalVarAliasesForManifest', () => {
    it('keeps only global g-tier aliases in stable original-name order', () => {
        expect(
            extractGlobalVarAliasesForManifest({
                '--z-token': '--g2',
                '--_sz-p': '--sz',
                '--brand-primary': '--g0',
                '--card-gap': ['--cz', '--g1'],
                '--component-local': ['--cz', '--sz'],
            }),
        ).toEqual({
            '--brand-primary': '--g0',
            '--card-gap': '--g1',
            '--z-token': '--g2',
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
                '--brand-primary': '--g0',
                '--_sz-p': '--sz',
            }),
        ).toBe('{"--brand-primary":"--g0"}');
        expect(createGlobalVarMapAssetSource({ '--_sz-p': '--sz' })).toBeNull();
    });
});
