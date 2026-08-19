/**
 * A class name with more than one author.
 *
 * Tailwind v4 lets several sources contribute declarations to one class name,
 * and when two land on the same name it MERGES them and says nothing. Measured
 * against the pinned Tailwind, every pairing is silent — two utility blocks
 * with one name emit both declarations into a single rule, and a utility named
 * after a class a colour token generates picks up that colour too.
 *
 * Scope is what nothing else covers. A theme token shadowing a BUILT-IN
 * keyword is already reported by the runtime classifier, which owns that
 * keyword list and has a gate holding it to Tailwind. A second copy here would
 * have no gate, so this reads only the utility blocks, which never reach the
 * runtime at all.
 *
 * The report belongs at the declaration, not the uses. A declaration is one
 * place; the uses are many, most written by someone who did nothing wrong —
 * including csszyx itself, which lowers sz props onto the contaminated class.
 *
 * There is no suppression comment on purpose. A deliberate multi-property
 * class has a spelling that costs nothing: a name no one else claims. An
 * ignore comment would silence a warning about damage that lands in other
 * files, which is where an eslint-style suppression stops being honest.
 */
import { describe, expect, it } from 'vitest';

import { findClassNameAuthorConflicts } from '../src/class-name-authors.js';

describe('findClassNameAuthorConflicts', () => {
    it('reports one name claimed by two utility blocks', () => {
        const found = findClassNameAuthorConflicts({
            themeColors: [],
            utilityStatics: ['panel-flat', 'panel-flat'],
        });

        expect(found).toEqual([{ name: 'panel-flat', reason: 'declared twice' }]);
    });

    it('reports a utility named after a class a colour token generates', () => {
        const found = findClassNameAuthorConflicts({
            themeColors: ['brand'],
            utilityStatics: ['text-brand'],
        });

        expect(found).toEqual([
            { name: 'text-brand', reason: 'a theme token already generates it' },
        ]);
    });

    it('checks every prefix a colour token feeds, not just text', () => {
        // One token changes the meaning of a class under each prefix, so a
        // check that only looked at `text-` would miss most of the collision.
        expect(
            findClassNameAuthorConflicts({
                themeColors: ['brand'],
                utilityStatics: ['ring-brand'],
            }),
        ).toHaveLength(1);
    });

    it('reports each colliding name once, however many ways it collides', () => {
        const found = findClassNameAuthorConflicts({
            themeColors: ['brand'],
            utilityStatics: ['text-brand', 'text-brand'],
        });

        expect(found).toHaveLength(1);
    });

    it('stays silent for a utility on a name nothing else claims', () => {
        expect(
            findClassNameAuthorConflicts({
                themeColors: ['brand', 'surface'],
                utilityStatics: ['panel-flat', 'card-raised'],
            }),
        ).toEqual([]);
    });

    it('stays silent for a project with no utility blocks at all', () => {
        expect(
            findClassNameAuthorConflicts({ themeColors: ['brand'], utilityStatics: [] }),
        ).toEqual([]);
    });
});
