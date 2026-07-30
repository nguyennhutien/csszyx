/**
 * Editor value suggestions must compile — including the negative forms.
 *
 * Completions are the only way a negative value is discoverable: nothing in the
 * sz object shape hints that `{ translateX: '-full' }` is legal, so a missing
 * suggestion means the feature effectively does not exist (field-reported: the
 * dropdown offered `full` but never `-full`). The flip side is that suggesting a
 * value which generates no CSS teaches a dead spelling, which is the same sin
 * as emitting one.
 *
 * This runs the full matrix through the real compiler and then real Tailwind, so
 * a Tailwind release that stops negating some value fails here instead of
 * quietly recommending it. It lives in this package because that is where the
 * Tailwind compile harness already is.
 */
import { transform } from '@csszyx/compiler';
import {
    NEGATIVE_VALUE_KEYS,
    negativeValueSuggestions,
    PROPERTY_MAP,
    VALUE_SUGGESTIONS,
    valueSuggestionsFor,
} from '@csszyx/tooling-metadata';
import { compile } from '@tailwindcss/node';
import { beforeAll, describe, expect, it } from 'vitest';

/** Compiled CSS for every candidate the suite needs, built once. */
let css = '';

/**
 * Whether the compiled CSS declares a rule for one class.
 *
 * @param className - Emitted class name.
 * @returns True when Tailwind generated a rule for it.
 */
function hasRule(className: string): boolean {
    if (!className) return false;
    const escaped = `.${className.replace(/([.:/[\]()%])/g, '\\$1')}`;
    return (
        css.includes(`${escaped}{`) || css.includes(`${escaped},`) || css.includes(`${escaped} `)
    );
}

/** [sz key, suggested value, emitted class] for every negative suggestion. */
const NEGATIVE_PROBES: Array<[string, string, string]> = [];
/** [sz key, suggested value, emitted class] for the positive counterparts. */
const POSITIVE_PROBES: Array<[string, string, string]> = [];

for (const key of NEGATIVE_VALUE_KEYS) {
    for (const negative of negativeValueSuggestions(key, true)) {
        const positive = negative.slice(1);
        NEGATIVE_PROBES.push([key, negative, transform({ [key]: negative }).className]);
        POSITIVE_PROBES.push([key, positive, transform({ [key]: positive }).className]);
    }
}

beforeAll(async () => {
    const compiler = await compile(
        '@import "tailwindcss/theme.css"; @import "tailwindcss/utilities.css";',
        { base: process.cwd(), onDependency() {} },
    );
    const candidates = [...NEGATIVE_PROBES, ...POSITIVE_PROBES]
        .map(([, , className]) => className)
        .filter(Boolean);
    css = compiler.build([...new Set(candidates)]);
}, 60_000);

describe('negative value suggestions', () => {
    it('covers a meaningful share of the suggestion surface', () => {
        // Guards against the derivation silently collapsing to nothing — a
        // passing "all suggestions compile" assertion over an empty set would
        // otherwise look green.
        expect(NEGATIVE_VALUE_KEYS.length).toBeGreaterThan(25);
        expect(NEGATIVE_PROBES.length).toBeGreaterThan(500);
    });

    it('emits a class for every suggested negative value', () => {
        const noClass = NEGATIVE_PROBES.filter(([, , className]) => !className);
        expect(noClass).toEqual([]);
    });

    it('generates real CSS for every suggested negative value', () => {
        // The invariant that matters: nothing in the dropdown is a dead end.
        const dead = NEGATIVE_PROBES.filter(([, , className]) => !hasRule(className)).map(
            ([key, value, className]) => `${key}: '${value}' → ${className}`,
        );
        expect(dead).toEqual([]);
    });

    it('keeps the positive counterpart of every negative valid too', () => {
        // A negative offered for a value whose positive is dead would mean the
        // curated list itself drifted.
        const dead = POSITIVE_PROBES.filter(([, , className]) => !hasRule(className)).map(
            ([key, value, className]) => `${key}: '${value}' → ${className}`,
        );
        expect(dead).toEqual([]);
    });

    it('excludes the values whose negative form generates nothing', () => {
        // Verified positive-only: -m-auto, -order-first/last/none produce no
        // rule. If Tailwind ever starts generating them this stays green; the
        // reverse (a listed value going dead) fails the assertions above.
        for (const key of NEGATIVE_VALUE_KEYS) {
            const negatives = negativeValueSuggestions(key, true);
            for (const excluded of ['-auto', '-first', '-last', '-none']) {
                expect(negatives).not.toContain(excluded);
            }
        }
    });
});

describe('valueSuggestionsFor', () => {
    it('offers the negative form of a spacing keyword', () => {
        // The exact field-reported case.
        expect(valueSuggestionsFor('translateX')).toContain('-full');
        expect(valueSuggestionsFor('translateX')).toContain('full');
    });

    it('ranks every positive before any negative', () => {
        // The consumers rely on this for both dropdown order and truncation:
        // a `limit` slice must never drop a positive to make room for `-4`.
        for (const key of NEGATIVE_VALUE_KEYS) {
            const values = valueSuggestionsFor(key);
            const firstNegative = values.findIndex(value => value.startsWith('-'));
            if (firstNegative === -1) continue;
            expect(values.slice(0, firstNegative).some(value => value.startsWith('-'))).toBe(false);
            expect(values.slice(firstNegative).every(value => value.startsWith('-'))).toBe(true);
        }
    });

    it('leaves keys without a negative form untouched', () => {
        // `bg` is not negative-capable: its suggestions must be unchanged.
        expect(valueSuggestionsFor('bg')).toEqual([...(VALUE_SUGGESTIONS.bg ?? [])]);
        expect(valueSuggestionsFor('bg').some(value => value.startsWith('-'))).toBe(false);
    });

    it('returns nothing for a key with no curated values', () => {
        expect(valueSuggestionsFor('definitelyNotAnSzKey')).toEqual([]);
    });

    it('derives negative capability from the compiler, not a hand list', () => {
        // NEGATIVE_VALUE_KEYS is generated from the compiler's NEGATIVE_ALLOWED
        // (keyed by Tailwind prefix) — spot-check the mapping direction so a
        // regenerate that loses the filter cannot pass.
        expect(NEGATIVE_VALUE_KEYS).toContain('translateX');
        expect(PROPERTY_MAP.translateX).toBe('translate-x');
        expect(NEGATIVE_VALUE_KEYS).not.toContain('bg');
        expect(NEGATIVE_VALUE_KEYS).not.toContain('opacity');
    });
});
