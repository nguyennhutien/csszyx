/**
 * The adapter that lets the foreign-keyword rule ask a real design system.
 *
 * The rule needs three facts Tailwind alone can supply, and all three have to
 * come from the PROJECT's design system rather than a table: which token names
 * a namespace resolves (the project's `@theme` is part of the answer), whether
 * a class name is a whole-name built-in, and which CSS properties it sets.
 *
 * Kept behind a narrow interface so the rule stays testable without compiling
 * Tailwind, and so a Tailwind API change lands in one adapter instead of in the
 * rule's logic.
 */
import { describe, expect, it } from 'vitest';

import { keywordOracleFrom } from '../src/scanner/keyword-oracle.js';

/** A design system standing in for a compiled project stylesheet. */
const design = {
    theme: {
        entries: () => [
            ['--color-red-500', '#ef4444'],
            ['--color-brand', '#0af'],
            ['--text-lg', '1.125rem'],
            ['--color-', 'ignored'],
            ['--font-display', 'Inter'],
            ['--font-weight-chunky', '850'],
        ],
    },
    parseCandidate: (candidate: string) =>
        candidate === 'text-balance'
            ? [
                  { kind: 'static', root: 'text-balance' },
                  { kind: 'functional', root: 'text', value: { kind: 'named', value: 'balance' } },
              ]
            : [{ kind: 'functional', root: 'text', value: { kind: 'named', value: 'red-500' } }],
    candidatesToCss: (candidates: readonly string[]) =>
        candidates.map(candidate =>
            candidate === 'text-balance'
                ? '.text-balance { text-wrap: balance; }'
                : candidate === 'text-red-500'
                  ? '.text-red-500 { --tw-x: 1; color: var(--color-red-500); }'
                  : null,
        ),
};

describe('keywordOracleFrom', () => {
    const oracle = keywordOracleFrom(design);

    it('lists the token names a namespace resolves, project tokens included', () => {
        expect(oracle.themeNames('colors')).toEqual(new Set(['red-500', 'brand']));
    });

    it('keeps namespaces apart', () => {
        expect(oracle.themeNames('textSizes')).toEqual(new Set(['lg']));
    });

    it('reads a whole-name static utility as one', () => {
        expect(oracle.isStaticUtility('text-balance')).toBe(true);
    });

    it('does not call a functional-only class static', () => {
        expect(oracle.isStaticUtility('text-red-500')).toBe(false);
    });

    it('reports the CSS properties a class sets', () => {
        expect(oracle.propertiesOf('text-balance')).toEqual(new Set(['text-wrap']));
    });

    it('leaves custom properties out, since they name no CSS property', () => {
        // `--tw-x` is a variable the utility sets on the way to its real
        // property; counting it would make two unrelated classes look alike.
        expect(oracle.propertiesOf('text-red-500')).toEqual(new Set(['color']));
    });

    it('does not read a font weight as a font family', () => {
        // Both namespaces spell their declaration `--font-…`, so the family
        // prefix matches every weight too. Letting one through would make
        // `font: 'weight-chunky'` resolve as a family the project never
        // declared, and the rule would go quiet on a real mistake.
        expect(oracle.themeNames('fontFamilies')).toEqual(new Set(['display']));
    });

    it('still lists the weight under its own namespace', () => {
        // The guard above must skip the key for families only, not drop it.
        expect(oracle.themeNames('fontWeights')).toEqual(new Set(['chunky']));
    });

    it('reports null for a class that produces no rule', () => {
        expect(oracle.propertiesOf('text-nonesuch')).toBeNull();
    });
});
