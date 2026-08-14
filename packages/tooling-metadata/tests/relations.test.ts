/**
 * Token-relationship predicates shared by the ts-plugin and the VS Code
 * companion. They are exercised end-to-end through both providers elsewhere;
 * this suite pins each branch directly so a rule change is caught at the source.
 */
import { describe, expect, it } from 'vitest';

import {
    COLOR_OBJECT_PROPS,
    chainAllowsNesting,
    classifyStyleChain,
    descendObjectForm,
    isUtilityPropertyKey,
    objectValueForm,
    PROPERTY_KEYS,
    resolveStyleChain,
    szvStyleChain,
    THEME_VALUE_PROPERTIES,
    valueSuggestionsFor,
} from '../src/index.js';
import {
    COLOR_VALUE_PROPS,
    negativeValueSuggestions,
    VALUE_SUGGESTIONS,
} from '../src/value-suggestions.js';

describe('isUtilityPropertyKey', () => {
    it('is true for utility properties and false for variants/unknowns', () => {
        expect(isUtilityPropertyKey('bg')).toBe(true);
        expect(isUtilityPropertyKey('p')).toBe(true);
        expect(isUtilityPropertyKey('hover')).toBe(false);
        expect(isUtilityPropertyKey('somethingCustom')).toBe(false);
    });
});

describe('THEME_VALUE_PROPERTIES', () => {
    it('maps every theme-fed property to one canonical utility key', () => {
        for (const [category, properties] of Object.entries(THEME_VALUE_PROPERTIES)) {
            expect(Object.isFrozen(properties), `${category} must be immutable`).toBe(true);
            expect(new Set(properties).size, `${category} contains duplicates`).toBe(
                properties.length,
            );
            for (const property of properties) {
                expect(
                    PROPERTY_KEYS.has(property),
                    `${category}.${property} is not canonical`,
                ).toBe(true);
            }
        }
        expect(THEME_VALUE_PROPERTIES.colors).toEqual(
            expect.arrayContaining(['borderTColor', 'borderXColor', 'insetRingColor']),
        );
        expect(THEME_VALUE_PROPERTIES.textSizes).toEqual(['text']);
        expect(THEME_VALUE_PROPERTIES.fontWeights).toEqual(['weight']);
    });
});

describe('chainAllowsNesting', () => {
    it('permits variant/unknown owners and empty slots', () => {
        expect(chainAllowsNesting([])).toBe(true);
        expect(chainAllowsNesting(['hover'])).toBe(true);
        expect(chainAllowsNesting(['', 'hover'])).toBe(true);
    });

    it('rejects a chain that runs through a utility property', () => {
        expect(chainAllowsNesting(['p'])).toBe(false);
        expect(chainAllowsNesting(['hover', 'bg'])).toBe(false);
    });
});

describe('objectValueForm', () => {
    it('offers the { color, op } opacity form for color properties', () => {
        expect(objectValueForm('bg')?.members.map(m => m.name)).toEqual(['color', 'op']);
    });

    it('offers the gradient form for bgImg', () => {
        expect(objectValueForm('bgImg')?.members.map(m => m.name)).toEqual([
            'gradient',
            'dir',
            'in',
        ]);
    });

    it('returns null for a plain utility property', () => {
        expect(objectValueForm('p')).toBeNull();
    });

    it('descends through structured members and stops at scalar leaves', () => {
        const mask = objectValueForm('maskLinear');
        expect(descendObjectForm(mask, ['b', 'from'])?.members.map(member => member.name)).toEqual([
            'at',
            'color',
            'op',
        ]);
        expect(descendObjectForm(mask, ['angle'])).toBeNull();
        expect(descendObjectForm(mask, ['missing'])).toBeNull();
        expect(descendObjectForm(null, ['missing'])).toBeNull();
        expect(descendObjectForm(mask, ['angle', 'nested'])).toBeNull();
    });

    it('exposes every mask layer form', () => {
        expect(objectValueForm('maskRadial')?.members.map(member => member.name)).toContain(
            'shape',
        );
        expect(objectValueForm('maskConic')?.members.map(member => member.name)).toContain('angle');
    });
});

describe('classifyStyleChain', () => {
    it('treats an empty chain and variant/unknown owners as a style object', () => {
        expect(classifyStyleChain([])).toBe('style');
        expect(classifyStyleChain(['hover'])).toBe('style');
        expect(classifyStyleChain(['', 'hover'])).toBe('style');
    });

    it('recognizes a color/bgImg property object as its structured value form', () => {
        expect(classifyStyleChain(['bg'])).toBe('object-form');
        expect(classifyStyleChain(['bgImg'])).toBe('object-form');
    });

    it('marks the arbitrary-CSS css object opaque only at the innermost level', () => {
        expect(classifyStyleChain(['css'])).toBe('opaque');
        expect(classifyStyleChain(['css', 'hover'])).toBe('opaque');
        expect(classifyStyleChain(['hover', 'css'])).toBe('invalid');
    });

    it('rejects a nested object under a plain or non-innermost utility property', () => {
        expect(classifyStyleChain(['p'])).toBe('invalid');
        expect(classifyStyleChain(['hover', 'bg'])).toBe('invalid');
        expect(classifyStyleChain(['hover', 'maskLinear'])).toBe('invalid');
        expect(classifyStyleChain(['missing', 'maskLinear', 'hover'])).toBe('invalid');
    });
});

describe('resolveStyleChain', () => {
    it('returns the exact nested structured form at the cursor', () => {
        expect(resolveStyleChain(['from', 'b', 'maskLinear']).kind).toBe('object-form');
        expect(
            resolveStyleChain(['from', 'b', 'maskLinear']).form?.members.map(member => member.name),
        ).toEqual(['at', 'color', 'op']);
    });

    it('returns no form for style, opaque, and invalid chains', () => {
        expect(resolveStyleChain(['hover'])).toEqual({ kind: 'style', form: null });
        expect(resolveStyleChain(['css'])).toEqual({ kind: 'opaque', form: null });
        expect(resolveStyleChain(['p'])).toEqual({ kind: 'invalid', form: null });
        expect(resolveStyleChain(['missing', 'maskLinear'])).toEqual({
            kind: 'invalid',
            form: null,
        });
    });
});

describe('szvStyleChain', () => {
    it('unwraps base, variants, and compoundVariants style positions', () => {
        expect(szvStyleChain(['base', 'p'])).toEqual(['p']);
        expect(szvStyleChain(['variants', 'size', 'sm', 'bg'])).toEqual(['bg']);
        expect(szvStyleChain(['compoundVariants', '0', 'sz', 'p'])).toEqual(['p']);
    });

    it('returns null for schema levels and unknown sections', () => {
        expect(szvStyleChain(['variants', 'size'])).toBeNull();
        expect(szvStyleChain(['compoundVariants', '0'])).toBeNull();
        expect(szvStyleChain(['whatever'])).toBeNull();
    });
});

describe('metadata data surface', () => {
    it('derives the color-property set from the shared value table', () => {
        expect(COLOR_VALUE_PROPS).toContain('bg');
        expect(COLOR_VALUE_PROPS.length).toBeGreaterThan(0);
        // COLOR_OBJECT_PROPS is the set form of the same list.
        expect([...COLOR_OBJECT_PROPS].sort()).toEqual([...COLOR_VALUE_PROPS].sort());
    });

    it('exposes non-empty property keys and value suggestions', () => {
        expect(PROPERTY_KEYS.has('p')).toBe(true);
        expect(VALUE_SUGGESTIONS.color?.length ?? 0).toBeGreaterThan(0);
        expect(VALUE_SUGGESTIONS.opacity?.length ?? 0).toBeGreaterThan(0);
    });

    it('builds positive and negative suggestion lists at the metadata source', () => {
        expect(valueSuggestionsFor('translateX')).toContain('-full');
        expect(valueSuggestionsFor('definitely-missing')).toEqual([]);
        expect(negativeValueSuggestions('translateX', false)).toEqual([]);
        expect(negativeValueSuggestions('translateX', true)).toContain('-full');
        expect(negativeValueSuggestions('definitely-missing', true)).toEqual([]);
    });
});
