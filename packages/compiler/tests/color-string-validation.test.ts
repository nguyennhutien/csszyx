import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { transform } from '../src/transform-core.js';

/**
 * Colour strings on the runtime lane.
 *
 * No colour string is dropped: whether the class is served is the build's
 * verdict (ADR 0022), so the runtime writes what the engines write and nothing
 * here judges a colour. A slash opacity in a string goes straight through.
 */

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

    describe('slash opacity — written as given and reported', () => {
        // The object form is the one spelling of an opacity (ADR 0037 §8); a
        // string keeps its class (ADR 0036) and the slash is reported.
        it.each([
            ['bg', 'blue-500/20', 'bg-blue-500/20'],
            ['bg', 'blue-500/02', 'bg-blue-500/02'],
            ['color', 'blue-600/75', 'text-blue-600/75'],
            ['borderColor', 'red-500/50', 'border-red-500/50'],
            ['from', 'red-500/50', 'from-red-500/50'],
            ['shadowColor', 'red-500/50', 'shadow-red-500/50'],
            ['ringColor', 'red-500/50', 'ring-red-500/50'],
        ])('writes %s: %s as %s', (key, value, expectedClass) => {
            expect(transform({ [key]: value }).className).toBe(expectedClass);
            expect(console.warn).toHaveBeenCalledTimes(1);
        });
    });

    describe('slash opacity — what is and is not one', () => {
        it('reports nothing for a slash with no colour or no opacity beside it', () => {
            expect(transform({ bg: 'red-500/' }).className).toBe('bg-red-500/');
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('reports a value once, however often it is lowered', () => {
            transform({ bg: 'teal-500/40' });
            transform({ bg: 'teal-500/40' });
            transform({ bg: { color: 'teal-600/40' } });
            transform({ bg: { color: 'teal-600/40' } });
            expect(console.warn).toHaveBeenCalledTimes(2);
        });

        it('names a string op as written, quotes included', () => {
            transform({ bg: { color: 'sky-500/40', op: '78%' } });
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    "`bg: { color: 'sky-500/40', op: '78%' }` sets opacity twice",
                ),
            );
        });

        it('names an op that is neither a number nor a string as if absent', () => {
            transform({ bg: { color: 'lime-500/40', op: true } } as never);
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    "`bg: { color: 'lime-500/40' }` puts the opacity in `color`",
                ),
            );
        });
    });

    describe('strings no rule drops — written as the engine writes them', () => {
        it.each([
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
