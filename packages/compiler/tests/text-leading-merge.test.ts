/**
 * `text` and `leading` fold into Tailwind's `text-<size>/<leading>` only when
 * the `text` class is a font size. A colour in brackets is a colour to
 * Tailwind, and `text-[#f00]/6` is that colour at 6% opacity with no
 * line-height at all, so a colour keeps both classes.
 *
 * A bracket value folds when it is a length for certain: it starts with a digit
 * or a point, or it is a length function (`calc`, `clamp`, `min`, `max`).
 * Anything else stays two classes, which is never wrong, only longer.
 */
import { describe, expect, it, vi } from 'vitest';

import { escapeUnsafeChars } from '../../core/tests/helpers/sz-fuzz.js';
import { transform } from '../src/transform-core.js';
import { ENGINES } from './engine-parity-harness.js';

/** sz object and the className every lane writes for it. */
const CASES: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
    // A colour keeps its own class and the line-height keeps its own.
    [{ text: '#f00', leading: 6 }, 'text-[#f00] leading-6'],
    [{ text: 'rgb(0 0 0)', leading: 6 }, 'text-[rgb(0_0_0)] leading-6'],
    [{ text: 'oklch(0.6 0.2 30)', leading: 'tight' }, 'text-[oklch(0.6_0.2_30)] leading-tight'],
    // A custom property is read as a size (the `length:` hint) and kept apart.
    [{ text: 'var(--brand)', leading: 6 }, 'text-[length:var(--brand)] leading-6'],
    [{ text: 'red-500', leading: 6 }, 'text-red-500 leading-6'],
    // A font size folds the line-height in.
    [{ text: 'sm', leading: 6 }, 'text-sm/6'],
    [{ text: '14px', leading: 6 }, 'text-[14px]/6'],
    [{ text: '1.5rem', leading: 'tight' }, 'text-[1.5rem]/tight'],
    [{ text: '.875rem', leading: 5 }, 'text-[.875rem]/5'],
    [{ text: 'clamp(1rem, 2vw, 2rem)', leading: 6 }, 'text-[clamp(1rem,_2vw,_2rem)]/6'],
    [{ text: 'calc(1rem + 2px)', leading: 6 }, 'text-[calc(1rem_+_2px)]/6'],
    [{ text: 'min(2rem, 5vw)', leading: 6 }, 'text-[min(2rem,_5vw)]/6'],
    [{ text: 'max(1rem, 2vw)', leading: 6 }, 'text-[max(1rem,_2vw)]/6'],
    // Only within one variant.
    [{ hover: { text: '#f00', leading: 6 } }, 'hover:text-[#f00] hover:leading-6'],
    [{ hover: { text: 'lg', leading: 7 } }, 'hover:text-lg/7'],
];

describe.each(CASES)('%j', (sz, expected) => {
    it('lowers in the runtime core', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect(transform(sz).className).toBe(expected);
        } finally {
            spy.mockRestore();
        }
    });

    it.each(ENGINES)('lowers through the %s engine', (_name, engine) => {
        const source = `export const A = () => <div sz={${escapeUnsafeChars(JSON.stringify(sz))}} />;`;
        const { code = '' } = engine(source, { filename: '/p/src/TextLeading.tsx' });
        expect(code).toContain(`className="${expected}"`);
    });
});
