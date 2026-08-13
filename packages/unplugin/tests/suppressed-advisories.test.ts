/**
 * Unit net for the disclosure that a build's fallback list is partial.
 *
 * Four of the five `sz`-site fallback kinds never print in a production build,
 * so a log can list every `szr` fallback it found and hold back every
 * `sz={factory()}` beside them. Suppression is the right default; leaving the
 * reader to infer zero from it is not, and a consumer counting affected sites
 * from such a log counted half the real number.
 */
import { describe, expect, it } from 'vitest';
import { isAdvisoryDiagnostic, suppressedAdvisoryMessage } from '../src/unplugin.js';

describe('isAdvisoryDiagnostic', () => {
    it('holds back an sz-site call fallback', () => {
        // The runtime path works and the classes are collected, so this one is
        // advice rather than a build result — the class that goes unlisted.
        expect(
            isAdvisoryDiagnostic('sz fallback at 4:39: function call `t()` result is unknown'),
        ).toBe(true);
    });

    it.each([
        ['an szr-site fallback', 'szr fallback at 4:43: function call `t()` result is unknown'],
        ['an unresolvable spread', 'unresolvable sz spread at 2:10'],
        ['a budget bail', 'prescan skipped: AST budget exceeded'],
    ])('never holds back %s', (_name, message) => {
        // Each of these says output is missing, which prints regardless of mode.
        expect(isAdvisoryDiagnostic(message)).toBe(false);
    });
});

describe('suppressedAdvisoryMessage', () => {
    it('says nothing when the list was complete', () => {
        expect(suppressedAdvisoryMessage(0)).toBeNull();
    });

    it('says nothing for a negative count', () => {
        // Defensive: a reset race must not print "-1 fallbacks not listed".
        expect(suppressedAdvisoryMessage(-1)).toBeNull();
    });

    it('agrees with itself on number', () => {
        expect(suppressedAdvisoryMessage(1)).toContain('1 advisory sz fallback not listed');
        expect(suppressedAdvisoryMessage(3)).toContain('3 advisory sz fallbacks not listed');
    });

    it('says how to see the ones it withheld', () => {
        const message = suppressedAdvisoryMessage(3);
        expect(message).toContain('development build');
        expect(message).toContain('the runtime path works');
    });
});
