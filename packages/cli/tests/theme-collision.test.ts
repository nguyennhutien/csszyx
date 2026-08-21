/**
 * A theme token named after a built-in utility keyword.
 *
 * Declaring `--color-balance` does not add a colour class: `text-balance` is
 * already a static utility, so Tailwind MERGES the two readings and the class
 * carries `text-wrap: balance` AND the colour. Both then compete on `color`
 * with every other colour class, and szcn — which cannot tell them apart —
 * keeps both rather than merging. Stylesheet order decides from there, so the
 * argument order szcn promises stops holding.
 *
 * Reported at the declaration, because that is the one line somebody can
 * change; every use site is innocent, including the sz props csszyx lowers.
 *
 * The prefixes each namespace feeds are DERIVED, never listed: a uniquely
 * named probe token is injected per namespace, and whichever class roots come
 * back carrying it are that namespace's prefixes. A hand-written list would be
 * a fourth copy of the same table and would drift the moment Tailwind added a
 * utility.
 */
import { describe, expect, it } from 'vitest';

import { type CollisionOracle, findThemeCollisions } from '../src/scanner/theme-collision.js';

/**
 * An oracle standing in for a project's design system.
 *
 * @param prefixes - Class roots each namespace feeds.
 * @param ambiguous - Names each root reads two ways.
 * @returns The oracle.
 */
function oracle(
    prefixes: Record<string, string[]>,
    ambiguous: Record<string, string[]>,
): CollisionOracle {
    return {
        prefixesFor: namespace => new Set(prefixes[namespace] ?? []),
        ambiguousNames: prefix => new Set(ambiguous[prefix] ?? []),
    };
}

const TAILWIND = oracle(
    { colors: ['text', 'bg', 'border'], textSizes: ['text'], fontFamilies: ['font'] },
    { text: ['balance', 'center'], bg: ['cover', 'fixed'], border: ['collapse'], font: ['bold'] },
);

describe('findThemeCollisions', () => {
    it('reports a colour token named after a built-in keyword, naming the class', () => {
        const found = findThemeCollisions(
            [{ namespace: 'colors', name: 'balance', file: 'src/app.css', line: 3 }],
            TAILWIND,
            [],
        );

        expect(found).toEqual([
            {
                namespace: 'colors',
                name: 'balance',
                file: 'src/app.css',
                line: 3,
                classes: ['text-balance'],
            },
        ]);
    });

    it('finds a collision under a prefix other than the obvious one', () => {
        // A colour feeds `bg-` too, so a check that only looked at `text-`
        // would pass `--color-cover` while `bg-cover` silently changed meaning.
        const found = findThemeCollisions(
            [{ namespace: 'colors', name: 'cover', file: 'a.css', line: 1 }],
            TAILWIND,
            [],
        );

        expect(found[0].classes).toEqual(['bg-cover']);
    });

    it('lists every class one token collides under', () => {
        const wide = oracle({ colors: ['text', 'bg'] }, { text: ['x'], bg: ['x'] });

        expect(
            findThemeCollisions(
                [{ namespace: 'colors', name: 'x', file: 'a.css', line: 1 }],
                wide,
                [],
            )[0].classes,
        ).toEqual(['bg-x', 'text-x']);
    });

    it('keeps namespaces apart, so a text size is not judged by colour prefixes', () => {
        // `cover` is ambiguous under `bg-`, but a `--text-*` token never
        // generates a `bg-` class, so it is not this token's problem.
        expect(
            findThemeCollisions(
                [{ namespace: 'textSizes', name: 'cover', file: 'a.css', line: 1 }],
                TAILWIND,
                [],
            ),
        ).toEqual([]);
    });

    it('stays silent for a token name nothing else claims', () => {
        expect(
            findThemeCollisions(
                [{ namespace: 'colors', name: 'brand', file: 'a.css', line: 1 }],
                TAILWIND,
                [],
            ),
        ).toEqual([]);
    });

    it('honours an allow entry, so a project can accept one deliberately', () => {
        expect(
            findThemeCollisions(
                [{ namespace: 'colors', name: 'balance', file: 'a.css', line: 1 }],
                TAILWIND,
                ['balance'],
            ),
        ).toEqual([]);
    });

    it('allows one name without silencing another', () => {
        const found = findThemeCollisions(
            [
                { namespace: 'colors', name: 'balance', file: 'a.css', line: 1 },
                { namespace: 'colors', name: 'collapse', file: 'a.css', line: 2 },
            ],
            TAILWIND,
            ['balance'],
        );

        expect(found.map(entry => entry.name)).toEqual(['collapse']);
    });

    it('reports the same name once per declaration site', () => {
        // Two stylesheets can declare it; each is its own line to fix.
        const found = findThemeCollisions(
            [
                { namespace: 'colors', name: 'balance', file: 'a.css', line: 1 },
                { namespace: 'colors', name: 'balance', file: 'b.css', line: 9 },
            ],
            TAILWIND,
            [],
        );

        expect(found.map(entry => entry.file)).toEqual(['a.css', 'b.css']);
    });
});
