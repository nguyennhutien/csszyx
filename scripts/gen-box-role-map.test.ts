import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { KNOWN_SPECIAL_PROPERTIES } from '../packages/compiler/src/transform-core.js';
import {
    ALIGN_CONTENT_VALUES,
    assertSpecialKeysHaveRoles,
    buildRoleMaps,
} from './gen-box-role-map.mjs';

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
            numOrdinal: 'inner/text',
            numSlashedZero: 'inner/text',
            touch: 'inner/touch',
            touchPinchZoom: 'inner/touch',
            containLayout: 'outer/containment',
            containPaint: 'outer/containment',
            containStyle: 'outer/containment',
        };
        const actual = Object.fromEntries(
            Object.keys(expected).map(key => {
                const role = keyRoles.get(key);
                return [key, role && `${role.role}/${role.category}`];
            }),
        );
        assert.deepEqual(actual, expected);
    });

    // `splitBox` reads classes, so every class a closed-enum key emits needs a
    // row on its key's side; without one `contain-strict` was unknown and
    // `normal-nums` fell to the fallback node.
    it('gives every class a closed-enum group emits the role of its key', () => {
        const { tokens, prefixes } = buildRoleMaps();
        const expected = {
            'normal-nums': 'inner/text',
            'lining-nums': 'inner/text',
            'tabular-nums': 'inner/text',
            'diagonal-fractions': 'inner/text',
            ordinal: 'inner/text',
            'slashed-zero': 'inner/text',
            'contain-none': 'outer/containment',
            'contain-strict': 'outer/containment',
            'contain-content': 'outer/containment',
            'contain-size': 'outer/containment',
            'contain-inline-size': 'outer/containment',
            'contain-layout': 'outer/containment',
            'contain-paint': 'outer/containment',
            'contain-style': 'outer/containment',
            'touch-pinch-zoom': 'inner/touch',
        };
        const actual = Object.fromEntries(
            Object.keys(expected).map(token => {
                const role = tokens.get(token);
                return [token, role && `${role.role}/${role.category}`];
            }),
        );
        assert.deepEqual(actual, expected);
        // A class under a key's prefix keeps answering an object selector by its
        // value (`{ touch: 'auto' }`), as the prefix match it shadows did.
        assert.deepEqual(tokens.get('touch-auto'), {
            ...prefixes.get('touch'),
            prefix: 'touch',
            value: 'auto',
        });
        assert.deepEqual(tokens.get('touch-pan-x'), {
            ...prefixes.get('touch'),
            prefix: 'touch',
            value: 'pan-x',
        });
        // A class whose only matching prefix is another family's takes no
        // prefix: `inline-table` is a display value, not an `inline-size`.
        assert.deepEqual(tokens.get('inline-table'), { role: 'inner', category: 'display' });
    });

    it('compiles exact sugar tokens and shared prefixes', () => {
        const { prefixes, tokens } = buildRoleMaps();
        assert.equal(prefixes.get('m')?.role, 'outer');
        assert.equal(prefixes.get('p')?.role, 'inner');
        assert.equal(tokens.get('no-underline')?.category, 'text');
        assert.equal(tokens.get('sr-only')?.role, 'outer');
    });
});

describe('special sz keys (lowered outside PROPERTY_MAP)', () => {
    // Each of these is a valid sz key with no PROPERTY_MAP prefix. Without a
    // row `splitBoxSz` sent it to the fallback node while `splitBox` routed the
    // class it compiles to by that class's prefix.
    it('gives every special key except css the role of its family', () => {
        const { keyRoles } = buildRoleMaps();
        const expected = {
            alignContent: 'inner/alignment',
            fromPos: 'outer/gradient',
            viaPos: 'outer/gradient',
            toPos: 'outer/gradient',
            maskComposite: 'outer/mask',
            maskMode: 'outer/mask',
            maskType: 'outer/mask',
            snapStrictness: 'inner/snap',
        };
        const actual = Object.fromEntries(
            Object.keys(expected).map(key => {
                const role = keyRoles.get(key);
                return [key, role && `${role.role}/${role.category}`];
            }),
        );
        assert.deepEqual(actual, expected);
        const missing = [...KNOWN_SPECIAL_PROPERTIES].filter(
            key => key !== 'css' && !keyRoles.has(key),
        );
        assert.deepEqual(missing, []);
    });

    // `css` is raw CSS: its properties can belong to either side, so no one
    // role is right for the key. It stays unrouted on purpose.
    it('gives css no row', () => {
        assert.equal(buildRoleMaps().keyRoles.has('css'), false);
    });

    it('fails when a special key has no row', () => {
        const keyRoles = new Map([['alignContent', { role: 'inner', category: 'alignment' }]]);
        assert.throws(
            () => assertSpecialKeysHaveRoles(keyRoles, new Set(['css', 'alignContent', 'fooPos'])),
            /fooPos/,
        );
        assert.doesNotThrow(() =>
            assertSpecialKeysHaveRoles(keyRoles, new Set(['css', 'alignContent'])),
        );
    });

    it('fails when css is given a row', () => {
        const keyRoles = new Map([['css', { role: 'outer', category: 'raw' }]]);
        assert.throws(() => assertSpecialKeysHaveRoles(keyRoles, new Set(['css'])), /css/);
    });

    // `content-*` is the generated-content prefix (text). The align-content
    // keywords share it, so each one needs an exact row to answer `alignment`.
    it('resolves the align-content keywords to exact alignment tokens', () => {
        const { tokens, prefixes } = buildRoleMaps();
        for (const value of ALIGN_CONTENT_VALUES) {
            assert.deepEqual(tokens.get(`content-${value}`), {
                role: 'inner',
                category: 'alignment',
                prefix: 'content',
                value,
            });
        }
        // `content-none` is the `content` property; the prefix keeps answering
        // for it and for arbitrary content.
        assert.equal(tokens.has('content-none'), false);
        assert.equal(prefixes.get('content')?.category, 'text');
    });

    // The keyword list is pinned against the Tailwind this repo installs, in
    // both directions: every `content-*` utility its design system lists whose
    // CSS sets `align-content` must be in the list, and nothing else may be. A
    // keyword a Tailwind upgrade adds would otherwise fall back to the
    // `content` prefix row (text) instead of alignment.
    it('lists exactly the content-* keywords Tailwind serves for align-content', async () => {
        const require = createRequire(import.meta.url);
        const base = dirname(require.resolve('tailwindcss/package.json'));
        const mod = await import(pathToFileURL(require.resolve('tailwindcss')).href);
        const loadDesignSystem =
            mod.__unstable__loadDesignSystem ?? mod.default?.__unstable__loadDesignSystem;
        const design = await loadDesignSystem('@import "tailwindcss";', {
            base,
            loadStylesheet: async (id: string, from: string) => {
                const spec = id === 'tailwindcss' ? 'tailwindcss/index.css' : id;
                const p = require.resolve(spec, { paths: [from ?? base] });
                return { path: p, base: dirname(p), content: readFileSync(p, 'utf8') };
            },
        });
        const candidates: string[] = design
            .getClassList()
            .map(([name]: [string]) => name)
            .filter((name: string) => name.startsWith('content-'));
        const css: (string | null)[] = design.candidatesToCss(candidates);
        const served = candidates
            .filter((_, i) => /(?:^|[{;\s])align-content:/.test(css[i] ?? ''))
            .map(name => name.slice('content-'.length))
            .sort();
        // Sanity: the enumeration reached the content-* family, and `none`
        // (the generated-content property) is listed but not alignment.
        assert.ok(candidates.includes('content-none'));
        assert.equal(served.includes('none'), false);
        const listed = [...ALIGN_CONTENT_VALUES].sort();
        const missing = served.filter(v => !listed.includes(v));
        const stale = listed.filter(v => !served.includes(v));
        assert.deepEqual(
            { missing, stale },
            { missing: [], stale: [] },
            `ALIGN_CONTENT_VALUES drifted from the installed Tailwind: add [${missing.join(', ')}], remove [${stale.join(', ')}]`,
        );
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
