import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRoleMaps } from './gen-box-role-map.mjs';

describe('box-role map generation', () => {
    it('covers compiler keys and standalone boolean shorthands', () => {
        const { keyRoles } = buildRoleMaps();
        assert.equal(keyRoles.get('m')?.role, 'outer');
        assert.equal(keyRoles.get('p')?.role, 'inner');
        assert.equal(keyRoles.get('truncate')?.category, 'text');
    });

    it('compiles exact sugar tokens and shared prefixes', () => {
        const { prefixes, tokens } = buildRoleMaps();
        assert.equal(prefixes.get('m')?.role, 'outer');
        assert.equal(prefixes.get('p')?.role, 'inner');
        assert.equal(tokens.get('no-underline')?.category, 'text');
        assert.equal(tokens.get('sr-only')?.role, 'outer');
    });
});
