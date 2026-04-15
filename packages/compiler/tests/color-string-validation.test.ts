import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasSlashOpacity, isValidColorString } from '../src/color-validation.js';
import { transform } from '../src/transform-core.js';

/**
 * Tests for strict color string validation.
 *
 * Covers all 3 code paths:
 *   1. isValidColorString / hasSlashOpacity helpers (shared across paths)
 *   2. transform() end-to-end — JS path (transform-core.ts validates + warns)
 */

describe('isValidColorString', () => {
    it('accepts known keywords', () => {
        expect(isValidColorString('inherit')).toBe(true);
        expect(isValidColorString('current')).toBe(true);
        expect(isValidColorString('transparent')).toBe(true);
        expect(isValidColorString('black')).toBe(true);
        expect(isValidColorString('white')).toBe(true);
        expect(isValidColorString('none')).toBe(true);
    });

    it('accepts CSS variables', () => {
        expect(isValidColorString('--my-color')).toBe(true);
        expect(isValidColorString('--brand-primary')).toBe(true);
    });

    it('accepts hex colors', () => {
        expect(isValidColorString('#ff0000')).toBe(true);
        expect(isValidColorString('#333')).toBe(true);
        expect(isValidColorString('#aabbcc')).toBe(true);
    });

    it('accepts pre-bracketed values', () => {
        expect(isValidColorString('[#333]')).toBe(true);
        expect(isValidColorString('[rgb(255,0,0)]')).toBe(true);
    });

    it('accepts color functions', () => {
        expect(isValidColorString('rgb(255,0,0)')).toBe(true);
        expect(isValidColorString('hsl(200,50%,50%)')).toBe(true);
        expect(isValidColorString('oklch(50% 0.1 200)')).toBe(true);
        expect(isValidColorString('color(display-p3 1 0 0)')).toBe(true);
        expect(isValidColorString('hwb(200 10% 10%)')).toBe(true);
        expect(isValidColorString('lab(50 20 -30)')).toBe(true);
        expect(isValidColorString('lch(50 30 200)')).toBe(true);
        expect(isValidColorString('oklab(0.5 0.1 -0.1)')).toBe(true);
    });

    it('accepts color scale patterns (word-number)', () => {
        expect(isValidColorString('blue-500')).toBe(true);
        expect(isValidColorString('red-100')).toBe(true);
        expect(isValidColorString('brand-500')).toBe(true);
        expect(isValidColorString('brand-primary-500')).toBe(true);
        expect(isValidColorString('my-custom-color-900')).toBe(true);
    });

    it('rejects slash opacity strings', () => {
        expect(isValidColorString('blue-500/20')).toBe(false);
        expect(isValidColorString('brand-500/02')).toBe(false);
        expect(isValidColorString('red-500/50')).toBe(false);
    });

    it('rejects non-identifier strings', () => {
        expect(isValidColorString('500blue')).toBe(false); // starts with digit (invalid CSS ident)
    });

    it('accepts Tailwind v4 semantic tokens (CSS identifiers)', () => {
        // Any CSS identifier is a potential semantic token in TW v4
        expect(isValidColorString('primary')).toBe(true);
        expect(isValidColorString('background')).toBe(true);
        expect(isValidColorString('muted-foreground')).toBe(true);
        expect(isValidColorString('card')).toBe(true);
        expect(isValidColorString('popover')).toBe(true);
    });
});

describe('hasSlashOpacity', () => {
    it('detects slash opacity', () => {
        expect(hasSlashOpacity('blue-500/20')).toBe(true);
        expect(hasSlashOpacity('brand-500/02')).toBe(true); // typo — still detected
        expect(hasSlashOpacity('red-500/50')).toBe(true);
        expect(hasSlashOpacity('brand-primary-500/75')).toBe(true);
    });

    it('rejects plain color strings', () => {
        expect(hasSlashOpacity('blue-500')).toBe(false);
        expect(hasSlashOpacity('inherit')).toBe(false);
        expect(hasSlashOpacity('#ff0000')).toBe(false);
    });

    it('detects slash when digit precedes it', () => {
        // w-1/2 also matches (digit before slash) — but this is only called on COLOR props
        expect(hasSlashOpacity('w-1/2')).toBe(true);
    });
});

describe('transform() — color string validation (JS path)', () => {
    beforeEach(() => {
        // Simulate server-side environment where warnings fire
        vi.stubEnv('NODE_ENV', 'development');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    describe('slash opacity — warn + suppress', () => {
        it('suppresses bg: "blue-500/20" and warns', () => {
            const result = transform({ bg: 'blue-500/20' });
            expect(result.className).toBe('');
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining('string slash opacity is not supported'),
            );
        });

        it('suppresses bg: "blue-500/02" (typo) and warns', () => {
            const result = transform({ bg: 'blue-500/02' });
            expect(result.className).toBe('');
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining('string slash opacity is not supported'),
            );
        });

        it('suppresses text: "blue-600/75" and warns', () => {
            const result = transform({ color: 'blue-600/75' });
            expect(result.className).toBe('');
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining('string slash opacity is not supported'),
            );
        });

        it('suppresses other color props with slash opacity', () => {
            const colorProps = ['borderColor', 'from', 'via', 'to', 'shadowColor', 'ringColor'];
            for (const prop of colorProps) {
                vi.clearAllMocks();
                const result = transform({ [prop]: 'red-500/50' });
                expect(result.className).toBe('');
                expect(console.warn).toHaveBeenCalledWith(
                    expect.stringContaining('string slash opacity is not supported'),
                );
            }
        });
    });

    describe('TW v4 semantic tokens — pass through, no suppress', () => {
        // TW v4 semantic tokens like 'primary', 'background', 'muted-foreground' are
        // valid CSS identifiers that may be defined in the user's theme. We accept them
        // rather than falsely rejecting valid theme tokens.
        it('passes bg: "primary" (TW v4 semantic token)', () => {
            const result = transform({ bg: 'primary' });
            expect(result.className).toBe('bg-primary');
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('passes bg: "muted-foreground" (hyphenated semantic token)', () => {
            const result = transform({ bg: 'muted-foreground' });
            expect(result.className).toBe('bg-muted-foreground');
            expect(console.warn).not.toHaveBeenCalled();
        });
    });

    describe('valid color strings — pass through, no warn', () => {
        it('passes bg: "blue-500"', () => {
            const result = transform({ bg: 'blue-500' });
            expect(result.className).toBe('bg-blue-500');
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('passes bg: "#ff0000" (hex)', () => {
            const result = transform({ bg: '#ff0000' });
            expect(result.className).toBe('bg-[#ff0000]');
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('passes bg: "--my-color" (CSS variable)', () => {
            const result = transform({ bg: '--my-color' });
            expect(result.className).toBe('bg-(--my-color)');
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('passes bg: "inherit"', () => {
            const result = transform({ bg: 'inherit' });
            expect(result.className).toBe('bg-inherit');
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('passes bg: "transparent"', () => {
            const result = transform({ bg: 'transparent' });
            expect(result.className).toBe('bg-transparent');
            expect(console.warn).not.toHaveBeenCalled();
        });
    });

    describe('object form { color, op } — always valid, no warn', () => {
        it('passes { bg: { color: "blue-500", op: 20 } } → bg-blue-500/20', () => {
            const result = transform({ bg: { color: 'blue-500', op: 20 } });
            expect(result.className).toBe('bg-blue-500/20');
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('passes { color: { color: "red-500", op: 50 } }', () => {
            const result = transform({ color: { color: 'red-500', op: 50 } });
            expect(result.className).toBe('text-red-500/50');
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('passes { from: { color: "blue-500", op: 20 } }', () => {
            const result = transform({ from: { color: 'blue-500', op: 20 } });
            expect(result.className).toBe('from-blue-500/20');
            expect(console.warn).not.toHaveBeenCalled();
        });
    });

    describe('non-color props — not validated', () => {
        it('does not suppress w: "1/2" (fraction, not color)', () => {
            const result = transform({ w: '1/2' });
            expect(result.className).toBe('w-1/2');
            expect(console.warn).not.toHaveBeenCalled();
        });
    });
});
