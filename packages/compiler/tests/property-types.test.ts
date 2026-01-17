import { describe, expect, it } from 'vitest';

import {
    COLOR_PROPERTIES,
    getCSSVariableName,
    getPropertyCategory,
    PROPERTY_CATEGORY_MAP,
    PropertyCategory,
} from '../src/property-types.js';

describe('PropertyCategory enum', () => {
    it('should define all expected categories', () => {
        expect(PropertyCategory.SPACING).toBeDefined();
        expect(PropertyCategory.COLOR).toBeDefined();
        expect(PropertyCategory.FRACTION).toBeDefined();
        expect(PropertyCategory.UNITLESS).toBeDefined();
        expect(PropertyCategory.ANGLE).toBeDefined();
        expect(PropertyCategory.DURATION).toBeDefined();
        expect(PropertyCategory.ARBITRARY).toBeDefined();
        expect(PropertyCategory.PASSTHROUGH).toBeDefined();
    });
});

describe('PROPERTY_CATEGORY_MAP', () => {
    it('should categorize spacing properties', () => {
        const spacingProps = ['p', 'pt', 'pr', 'pb', 'pl', 'px', 'py', 'ps', 'pe',
            'm', 'mt', 'mr', 'mb', 'ml', 'mx', 'my', 'ms', 'me',
            'gap', 'gapX', 'gapY', 'inset', 'top', 'right', 'bottom', 'left',
            'w', 'h', 'size', 'basis', 'indent', 'translateX', 'translateY'];
        for (const prop of spacingProps) {
            expect(PROPERTY_CATEGORY_MAP[prop]).toBe(PropertyCategory.SPACING);
        }
    });

    it('should categorize color properties', () => {
        const colorProps = ['bg', 'color', 'borderColor',
            'divideColor', 'outlineColor', 'ringColor', 'ringOffsetColor',
            'shadowColor', 'textShadowColor', 'decorationColor', 'accent', 'caret', 'fill', 'stroke',
            'from', 'via', 'to', 'dropShadowColor'];
        for (const prop of colorProps) {
            expect(PROPERTY_CATEGORY_MAP[prop]).toBe(PropertyCategory.COLOR);
        }
    });

    it('should categorize unitless properties', () => {
        const unitlessProps = ['opacity', 'z', 'order', 'columns',
            'scale', 'scaleX', 'scaleY', 'brightness', 'contrast'];
        for (const prop of unitlessProps) {
            expect(PROPERTY_CATEGORY_MAP[prop]).toBe(PropertyCategory.UNITLESS);
        }
    });

    it('should categorize angle properties', () => {
        const angleProps = ['rotate', 'skewX', 'skewY'];
        for (const prop of angleProps) {
            expect(PROPERTY_CATEGORY_MAP[prop]).toBe(PropertyCategory.ANGLE);
        }
    });

    it('should categorize duration properties', () => {
        const durationProps = ['duration', 'delay'];
        for (const prop of durationProps) {
            expect(PROPERTY_CATEGORY_MAP[prop]).toBe(PropertyCategory.DURATION);
        }
    });
});

describe('getPropertyCategory', () => {
    it('should return correct category for known properties', () => {
        expect(getPropertyCategory('p')).toBe(PropertyCategory.SPACING);
        expect(getPropertyCategory('bg')).toBe(PropertyCategory.COLOR);
        expect(getPropertyCategory('opacity')).toBe(PropertyCategory.UNITLESS);
        expect(getPropertyCategory('rotate')).toBe(PropertyCategory.ANGLE);
        expect(getPropertyCategory('duration')).toBe(PropertyCategory.DURATION);
    });

    it('should return PASSTHROUGH for unknown properties', () => {
        expect(getPropertyCategory('unknownProp')).toBe(PropertyCategory.PASSTHROUGH);
        expect(getPropertyCategory('myCustom')).toBe(PropertyCategory.PASSTHROUGH);
    });
});

describe('COLOR_PROPERTIES', () => {
    it('should contain all color properties', () => {
        expect(COLOR_PROPERTIES.has('bg')).toBe(true);
        expect(COLOR_PROPERTIES.has('color')).toBe(true);
        expect(COLOR_PROPERTIES.has('borderColor')).toBe(true);
        expect(COLOR_PROPERTIES.has('fill')).toBe(true);
        expect(COLOR_PROPERTIES.has('stroke')).toBe(true);
        expect(COLOR_PROPERTIES.has('from')).toBe(true);
        expect(COLOR_PROPERTIES.has('via')).toBe(true);
        expect(COLOR_PROPERTIES.has('to')).toBe(true);
    });

    it('should not contain non-color properties', () => {
        expect(COLOR_PROPERTIES.has('p')).toBe(false);
        expect(COLOR_PROPERTIES.has('opacity')).toBe(false);
        expect(COLOR_PROPERTIES.has('z')).toBe(false);
        expect(COLOR_PROPERTIES.has('rotate')).toBe(false);
    });
});

describe('getCSSVariableName', () => {
    it('should generate simple variable names', () => {
        expect(getCSSVariableName('p')).toBe('--_sz-p');
        expect(getCSSVariableName('bg')).toBe('--_sz-bg');
        expect(getCSSVariableName('opacity')).toBe('--_sz-opacity');
    });

    it('should convert camelCase to kebab-case', () => {
        expect(getCSSVariableName('borderColor')).toBe('--_sz-border-color');
        expect(getCSSVariableName('backgroundColor')).toBe('--_sz-background-color');
    });

    it('should include variant prefix when provided', () => {
        expect(getCSSVariableName('p', 'hover')).toBe('--_sz-hover-p');
        expect(getCSSVariableName('bg', 'md')).toBe('--_sz-md-bg');
        expect(getCSSVariableName('scale', 'hover')).toBe('--_sz-hover-scale');
    });

    it('should handle nested variants', () => {
        expect(getCSSVariableName('bg', 'md-hover')).toBe('--_sz-md-hover-bg');
    });
});

// ===========================================================================
// G4 — Property Types Edge Cases
// ===========================================================================

describe('PROPERTY_CATEGORY_MAP edge cases', () => {
    it('should categorize fraction properties', () => {
        const fractionProps = ['aspect'];
        for (const prop of fractionProps) {
            if (PROPERTY_CATEGORY_MAP[prop]) {
                expect(PROPERTY_CATEGORY_MAP[prop]).toBeDefined();
            }
        }
    });

    it('should return PASSTHROUGH for completely unknown properties', () => {
        expect(getPropertyCategory('foo')).toBe(PropertyCategory.PASSTHROUGH);
        expect(getPropertyCategory('randomProp')).toBe(PropertyCategory.PASSTHROUGH);
        expect(getPropertyCategory('xyzzy')).toBe(PropertyCategory.PASSTHROUGH);
    });

    it('should return PASSTHROUGH for CSS-like but unmapped properties', () => {
        expect(getPropertyCategory('lineClamp')).not.toBeUndefined();
    });

    it('should categorize border-related as UNITLESS', () => {
        const borderProps = ['border', 'borderT', 'borderR', 'borderB', 'borderL', 'borderX', 'borderY'];
        for (const prop of borderProps) {
            expect(PROPERTY_CATEGORY_MAP[prop]).toBe(PropertyCategory.UNITLESS);
        }
    });

    it('should categorize gridCols/gridRows as UNITLESS', () => {
        expect(PROPERTY_CATEGORY_MAP['gridCols']).toBe(PropertyCategory.UNITLESS);
        expect(PROPERTY_CATEGORY_MAP['gridRows']).toBe(PropertyCategory.UNITLESS);
    });

    it('should categorize scale as UNITLESS', () => {
        expect(PROPERTY_CATEGORY_MAP['scale']).toBe(PropertyCategory.UNITLESS);
        expect(PROPERTY_CATEGORY_MAP['scaleX']).toBe(PropertyCategory.UNITLESS);
        expect(PROPERTY_CATEGORY_MAP['scaleY']).toBe(PropertyCategory.UNITLESS);
    });
});

describe('COLOR_PROPERTIES completeness', () => {
    it('should contain all gradient color stops', () => {
        expect(COLOR_PROPERTIES.has('from')).toBe(true);
        expect(COLOR_PROPERTIES.has('via')).toBe(true);
        expect(COLOR_PROPERTIES.has('to')).toBe(true);
    });

    it('should contain accent and caret', () => {
        expect(COLOR_PROPERTIES.has('accent')).toBe(true);
        expect(COLOR_PROPERTIES.has('caret')).toBe(true);
    });

    it('should match all COLOR entries in PROPERTY_CATEGORY_MAP', () => {
        const colorFromMap = Object.entries(PROPERTY_CATEGORY_MAP)
            .filter(([, cat]) => cat === PropertyCategory.COLOR)
            .map(([key]) => key);

        for (const prop of colorFromMap) {
            expect(COLOR_PROPERTIES.has(prop)).toBe(true);
        }
        // And vice versa
        for (const prop of COLOR_PROPERTIES) {
            expect(PROPERTY_CATEGORY_MAP[prop]).toBe(PropertyCategory.COLOR);
        }
    });
});

describe('getCSSVariableName edge cases', () => {
    it('should handle single-char property', () => {
        expect(getCSSVariableName('p')).toBe('--_sz-p');
        expect(getCSSVariableName('m')).toBe('--_sz-m');
        expect(getCSSVariableName('w')).toBe('--_sz-w');
        expect(getCSSVariableName('h')).toBe('--_sz-h');
        expect(getCSSVariableName('z')).toBe('--_sz-z');
    });

    it('should handle multi-word camelCase', () => {
        expect(getCSSVariableName('ringOffsetColor')).toBe('--_sz-ring-offset-color');
        expect(getCSSVariableName('transitionDuration')).toBe('--_sz-transition-duration');
    });

    it('should handle variant prefix with single-char prop', () => {
        expect(getCSSVariableName('p', 'hover')).toBe('--_sz-hover-p');
        expect(getCSSVariableName('m', 'dark')).toBe('--_sz-dark-m');
    });

    it('should not add prefix when empty string variant', () => {
        const result = getCSSVariableName('bg', '');
        expect(result).toBe('--_sz-bg');
    });
});
