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
import {
    emitKeyValueDiagnostic,
    isAdvisoryDiagnostic,
    shouldHoldAdvisories,
    suppressedAdvisoryMessage,
} from '../src/unplugin.js';

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

describe('key and value diagnostics are not advisory fallbacks', () => {
    // Field report against 0.16.0: a production build of a file with five
    // typo'd sz keys and values printed nothing but the advisory census, while
    // `csszyx check` on the same tree exited 1 and named all six findings. The
    // classifier is why — it was written as "everything that is not one of
    // three known kinds", so a key diagnostic fell to the advisory side and a
    // production build held it back and counted it as a FALLBACK. It is not a
    // fallback: no runtime path picks these up, the class is dead either way.
    it.each([
        [
            'an unknown key',
            '[csszyx] Unknown property "zzz" in sz prop at src/A.tsx:1. The class is still emitted, so it styles nothing unless Tailwind serves that utility. Check for typos. If the class is intentional, define it with Tailwind\'s @utility.',
        ],
        [
            'a closed-enum value',
            '[csszyx] "display: bogus" at src/A.tsx:1 is not a display value — nothing is emitted for it. display takes one of: block, flex.',
        ],
        [
            'an object under a csszyx-owned key',
            '[csszyx] "--v-x" at src/A.tsx:1 is not a variant, but it holds an object, so it lowers to the class prefix "--v-x:" and Tailwind generates no CSS for it. A "--*" key takes a declaration value; "container" takes true or a name.',
        ],
        [
            'a dead spacing step',
            '[csszyx] "p: 1.1" at src/A.tsx:1: 1.1 is not on Tailwind\'s spacing scale (quarter steps only), so the class generates no CSS. Use a quarter step (1.25, 1.5, 1.75) or a unit value ("1.1rem").',
        ],
        [
            'a property holding an object',
            '[csszyx] "p" is a property, not a variant, but received an object { bg } at src/A.tsx:1. This compiles to "p:*" classes that match no Tailwind variant and generate no CSS.',
        ],
        [
            'a file left uncompiled by the nesting guard',
            '[csszyx] src/A.tsx: source nesting exceeded 64 levels (found 90) — this usually means accidentally or programmatically over-nested sz/JSX. Flatten the structure. (This guard prevents a parser stack overflow.)',
        ],
    ])('never holds back %s', (_name, message) => {
        expect(isAdvisoryDiagnostic(message)).toBe(false);
    });

    it('still holds back the className precedence advisory', () => {
        // The one diagnostic in the family that IS advice: the styles are
        // present, the surprise is which of two sources wins.
        expect(
            isAdvisoryDiagnostic(
                '[csszyx] "sz" takes precedence over the runtime "className" on this element at src/A.tsx:1, whatever order the attributes are written. If the className carries overrides from a caller, they are dropped.',
            ),
        ).toBe(true);
    });
});

describe('emitKeyValueDiagnostic', () => {
    const UNKNOWN_KEY =
        '[csszyx] Unknown property "zzz" in sz prop at src/A.tsx:1. The class is still emitted, so it styles nothing unless Tailwind serves that utility.';

    /**
     * Route one diagnostic and collect what reached the output channel.
     *
     * @param quiet - The resolved quiet mode for the run.
     * @param message - The diagnostic to route.
     * @returns Every line the channel received.
     */
    function emitted(quiet: 'off' | 'nudges' | 'all', message: string): string[] {
        const lines: string[] = [];
        emitKeyValueDiagnostic(quiet, message, 'src/A.tsx', line => lines.push(line));
        return lines;
    }

    it('prints a key diagnostic with the module that produced it', () => {
        // The gap this closes: it reached neither the missing-css channel nor
        // the advisory one, so a build said nothing about it at all.
        const lines = emitted('off', UNKNOWN_KEY);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('src/A.tsx');
        expect(lines[0]).toContain('Unknown property "zzz"');
    });

    it('still prints when only usage nudges are muted', () => {
        // A dead class is wrong output, not a nudge about how csszyx is used.
        expect(emitted('nudges', UNKNOWN_KEY)).toHaveLength(1);
    });

    it('says nothing when every csszyx warning is muted', () => {
        expect(emitted('all', UNKNOWN_KEY)).toEqual([]);
    });

    it('leaves an advisory to the advisory channel', () => {
        expect(
            emitted(
                'off',
                '[csszyx] "sz" takes precedence over the runtime "className" on this element at src/A.tsx:1.',
            ),
        ).toEqual([]);
    });

    it('leaves a missing-css fallback to its own channel', () => {
        expect(
            emitted('off', 'szr fallback at 4:43: function call `t()` result is unknown'),
        ).toEqual([]);
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

describe('shouldHoldAdvisories', () => {
    it('holds the list in a production build, where a count still prints', () => {
        expect(shouldHoldAdvisories('off', false, 'production')).toBe(true);
    });

    it('lists them in a development build', () => {
        expect(shouldHoldAdvisories('off', false, 'development')).toBe(false);
        expect(shouldHoldAdvisories('off', false, undefined)).toBe(false);
    });

    // A dev server has no bundle close, so a held-back list is never counted
    // anywhere the reader can see it.
    it('lists them in a dev server whatever the environment says', () => {
        expect(shouldHoldAdvisories('off', true, 'production')).toBe(false);
        expect(shouldHoldAdvisories('off', true, 'development')).toBe(false);
    });

    it('holds them whenever a quiet mode was asked for', () => {
        expect(shouldHoldAdvisories('all', true, 'development')).toBe(true);
        expect(shouldHoldAdvisories('nudges', true, 'development')).toBe(true);
    });
});
