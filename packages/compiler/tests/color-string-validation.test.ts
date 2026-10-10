import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    __resetStringColorOpacityWarnings,
    isDroppedSlashOpacity,
    stripInvalidColorStrings,
} from '../src/color-validation.js';
import { transform } from '../src/transform-core.js';

/**
 * Tests for the one colour-string rule the lowering applies.
 *
 * A colour key takes its opacity in the object form, so a string with slash
 * opacity emits nothing and is reported. Every other string is written as the
 * engine writes it: whether the class is served is the build's verdict
 * (ADR 0022), so nothing here judges a colour.
 *
 * Covers both code paths:
 *   1. isDroppedSlashOpacity (shared by the transform and WASM pre-validation)
 *   2. transform() end-to-end — JS path (transform-core.ts drops + warns)
 */

describe('isDroppedSlashOpacity', () => {
    it.each([
        ['bg', 'blue-500/20'],
        ['bg', 'brand-500/02'],
        ['color', 'red-500/50'],
        ['borderColor', '-red-500/50'],
    ])('drops %s: %s', (key, value) => {
        expect(isDroppedSlashOpacity(key, value)).toBe(true);
    });

    it.each([
        // Not a shade before the slash: written as given.
        ['bg', 'white/50'],
        ['bg', 'blue-500'],
        ['bg', '/50'],
        // A sizing fraction, a numeric ratio, a function value.
        ['bg', '1/2'],
        ['bg', '4/2.5'],
        ['bg', '-1/2'],
        ['bg', 'calc(100/5)'],
        // Not a colour key: the slash is Tailwind's on every v4.
        ['text', 'red-500/50'],
        ['w', '1/2'],
    ])('keeps %s: %s', (key, value) => {
        expect(isDroppedSlashOpacity(key, value)).toBe(false);
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

    describe('strings no rule drops — written as the engine writes them', () => {
        it.each([
            ['white/50', 'bg-white/50'],
            ['50%', 'bg-[50%]'],
            ['var(--x)', 'bg-[var(--x)]'],
            ['!!!', 'bg-!!!'],
        ])('writes bg: %s as %s', (value, expectedClass) => {
            const result = transform({ bg: value });
            expect(result.className).toBe(expectedClass);
            expect(console.warn).not.toHaveBeenCalled();
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
        it.each([
            ['blue-500', 'bg-blue-500'],
            ['#ff0000', 'bg-[#ff0000]'],
            ['--my-color', 'bg-(--my-color)'],
            ['inherit', 'bg-inherit'],
            ['transparent', 'bg-transparent'],
        ])('passes bg: %s', (value, expectedClass) => {
            const result = transform({ bg: value });
            expect(result.className).toBe(expectedClass);
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

describe('CSSZYX_QUIET_SZ_WARNINGS on the WASM pre-validation path', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    const previous = process.env.CSSZYX_QUIET_SZ_WARNINGS;

    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        __resetStringColorOpacityWarnings();
    });

    afterEach(() => {
        warn.mockRestore();
        if (previous === undefined) {
            delete process.env.CSSZYX_QUIET_SZ_WARNINGS;
        } else {
            process.env.CSSZYX_QUIET_SZ_WARNINGS = previous;
        }
    });

    /**
     * The env switch is documented as silencing the sz key and value warnings,
     * and it does on the JS transform path. `stripInvalidColorStrings` runs
     * instead when the WASM core is loaded, and it warns about the same values
     * — so honouring the switch on only one of the two paths makes the
     * documented behaviour depend on which engine happens to be active.
     */
    it('silences the slash-opacity warning', () => {
        process.env.CSSZYX_QUIET_SZ_WARNINGS = '1';
        stripInvalidColorStrings({ color: 'blue-500/50' });
        expect(warn).not.toHaveBeenCalled();
    });

    it('still warns when the switch is unset', () => {
        delete process.env.CSSZYX_QUIET_SZ_WARNINGS;
        stripInvalidColorStrings({ color: 'blue-500/50' });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('keeps a value no rule drops, without a word', () => {
        delete process.env.CSSZYX_QUIET_SZ_WARNINGS;
        expect(stripInvalidColorStrings({ color: '!!!' })).toEqual({ color: '!!!' });
        expect(warn).not.toHaveBeenCalled();
    });
});
