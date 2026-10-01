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

    // A closed-enum key has no PROPERTY_MAP prefix, so it reaches the key table
    // only through its own row; without one `splitBoxSz` cannot route it while
    // `splitBox` routes the class it compiles to.
    it('gives every closed-enum group key the role of its family', () => {
        const { keyRoles } = buildRoleMaps();
        const expected = {
            nums: 'inner/text',
            numFigure: 'inner/text',
            numSpacing: 'inner/text',
            numFraction: 'inner/text',
            touchPanX: 'inner/touch',
            touchPanY: 'inner/touch',
            contain: 'outer/containment',
            containSize: 'outer/containment',
        };
        const actual = Object.fromEntries(
            Object.keys(expected).map(key => {
                const role = keyRoles.get(key);
                return [key, role && `${role.role}/${role.category}`];
            }),
        );
        assert.deepEqual(actual, expected);
    });

    it('compiles exact sugar tokens and shared prefixes', () => {
        const { prefixes, tokens } = buildRoleMaps();
        assert.equal(prefixes.get('m')?.role, 'outer');
        assert.equal(prefixes.get('p')?.role, 'inner');
        assert.equal(tokens.get('no-underline')?.category, 'text');
        assert.equal(tokens.get('sr-only')?.role, 'outer');
    });
});

import { addTailwindOnly } from './gen-box-role-map.mjs';

describe('hand-written rows in a generated table', () => {
    const row = { role: 'outer', category: 'position' };

    it('refuse a prefix csszyx already emits as a prefix', () => {
        assert.throws(() => addTailwindOnly(new Map([['end', row]]), new Map()), /Tailwind-only/);
    });

    it('refuse a prefix csszyx already emits as an exact token', () => {
        assert.throws(() => addTailwindOnly(new Map(), new Map([['end', row]])), /Tailwind-only/);
    });

    it('refuse a scope marker csszyx emits either way', () => {
        assert.throws(() => addTailwindOnly(new Map([['group', row]]), new Map()), /scope marker/);
        assert.throws(() => addTailwindOnly(new Map(), new Map([['peer', row]])), /scope marker/);
    });

    it('add every row when nothing collides', () => {
        const prefixes = new Map();
        const tokens = new Map();
        addTailwindOnly(prefixes, tokens);
        assert.equal(prefixes.get('start')?.category, 'position');
        assert.equal(prefixes.get('placeholder')?.role, 'inner');
        assert.equal(tokens.get('peer')?.category, 'scope');
    });
});
