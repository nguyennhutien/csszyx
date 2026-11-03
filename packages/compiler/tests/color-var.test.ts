import { describe, expect, it } from 'vitest';

import { __szColorVar } from '../src/color-var.js';

describe('dynamic color values', () => {
    it.each([undefined, null, ''])('omits an absent color: %s', value => {
        expect(__szColorVar(value)).toBeUndefined();
    });

    it.each(['#abc', 'rgb(1 2 3)', 'hsl(0 0% 0%)', 'oklch(0.5 0.2 30)'])(
        'preserves a raw color: %s',
        value => expect(__szColorVar(value)).toBe(value),
    );

    it('resolves a custom property separately from a theme color', () => {
        expect(__szColorVar('--brand')).toBe('var(--brand)');
        expect(__szColorVar('blue-500')).toBe('var(--color-blue-500)');
    });

    it.each(['var(--brand)', 'color(display-p3 1 0 0)', 'red;display:none', 'blue\\-500'])(
        'does not turn CSS syntax into a theme variable: %s',
        value => expect(__szColorVar(value)).toBe(value),
    );
});
