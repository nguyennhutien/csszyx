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
    isUtilityPropertyKey,
    objectValueForm,
    PROPERTY_KEYS,
    szvStyleChain,
} from '../src/index.js';
import { COLOR_VALUE_PROPS, VALUE_SUGGESTIONS } from '../src/value-suggestions.js';

describe('isUtilityPropertyKey', () => {
    it('is true for utility properties and false for variants/unknowns', () => {
        expect(isUtilityPropertyKey('bg')).toBe(true);
        expect(isUtilityPropertyKey('p')).toBe(true);
        expect(isUtilityPropertyKey('hover')).toBe(false);
        expect(isUtilityPropertyKey('somethingCustom')).toBe(false);
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
});
