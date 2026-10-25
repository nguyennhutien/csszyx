/**
 * A value wrapped in the brackets csszyx writes itself.
 *
 * Rule: sz prop VALUES never carry their own outer `[]`; the compiler writes
 * them. One spelling is supported (PROJECT-RULES §5): `{ top: '[-1px]' }` or
 * `{ w: '[100px]' }` writes nothing and reports `bracketed-value` naming the
 * value to write, on the runtime as on the engine
 * (`bracketed-value-parity.test.ts`). The bracket-free form is the one that
 * lowers.
 */

import { describe, expect, it } from 'vitest';
import { normalizeArbitraryValue, transform } from '../src/transform-core.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

describe('a value in its own brackets', () => {
    it.each([
        { top: '[-1px]' },
        { left: '[-1px]' },
        { inset: '[-8px]' },
        { insetX: '[12px]' },
        { right: '[2rem]' },
        { bottom: '[20px]' },
        { w: '[100px]' },
        { w: '[1.5rem]' },
        { w: '[50%]' },
        { h: '[60px]' },
        { maxW: '[720px]' },
        { size: '[3rem]' },
        { bg: '[#316ff6]' },
        { color: '[#fff]' },
        { perspective: '[500px]' },
        { decorationThickness: '[3px]' },
        { before: { top: '[-1px]' } },
    ])('%j writes nothing', sz => {
        expect(t(sz)).toBe('');
    });

    it.each([
        [{ top: '-1px' }, 'top-[-1px]'],
        [{ w: '100px' }, 'w-[100px]'],
        [{ size: '3rem' }, 'size-[3rem]'],
        [{ bg: '#316ff6' }, 'bg-[#316ff6]'],
        [{ w: '.25' }, 'w-[.25]'],
        [{ w: '-.25ch' }, 'w-[-.25ch]'],
        [{ w: '1cqw' }, 'w-[1cqw]'],
        [{ w: 48 }, 'w-48'],
        [{ bg: 'violet-500' }, 'bg-violet-500'],
    ])('%j, written without them, writes %s', (sz, className) => {
        expect(t(sz)).toBe(className);
    });

    it('leaves brackets inside a value as written', () => {
        expect(normalizeArbitraryValue('[a] 1fr [b]')).toBe('[a]_1fr_[b]');
    });
});
