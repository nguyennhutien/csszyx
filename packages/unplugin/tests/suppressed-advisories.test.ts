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
import { shouldHoldAdvisories, suppressedAdvisoryMessage } from '../src/unplugin.js';

describe('suppressedAdvisoryMessage', () => {
    it('says nothing when the list was complete', () => {
        expect(suppressedAdvisoryMessage(0)).toBeNull();
    });

    it('says nothing for a negative count', () => {
        // Defensive: a reset race must not print "-1 fallbacks not listed".
        expect(suppressedAdvisoryMessage(-1)).toBeNull();
    });

    it('agrees with itself on number', () => {
        expect(suppressedAdvisoryMessage(1)).toContain('1 info note not listed');
        expect(suppressedAdvisoryMessage(3)).toContain('3 info notes not listed');
    });

    // The count is every `info` finding a build holds back, and two of the
    // three recommended `info` kinds are not sz fallbacks at all: a className whose precedence over
    // `sz` is unstated, and a CSS-variable hoist the planner declined. Naming
    // the count after one of its three members told a reader a project with no
    // fallback at all that it had some.
    it('names every kind it counts, not only the fallback', () => {
        const message = suppressedAdvisoryMessage(3) ?? '';
        expect(message).toContain('fallback at an sz prop');
        expect(message).toContain('precedence over sz is unstated');
        expect(message).toContain('hoist the planner declined');
        expect(message).not.toContain('advisory sz fallback');
    });

    it('says how to see the ones it withheld', () => {
        const message = suppressedAdvisoryMessage(3);
        expect(message).toContain('development build');
    });

    // The count also holds findings a config lowered to `info`, such as a
    // dead class: its styles are not there, so the line must not say they are.
    it('counts a finding the config set to info without calling it handled', () => {
        const message = suppressedAdvisoryMessage(3) ?? '';
        expect(message).toContain('any finding csszyx.config sets to info');
        expect(message).not.toContain('the styles are there');
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
