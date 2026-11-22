/**
 * A value wrapped in the brackets csszyx writes itself.
 *
 * The compiler writes the brackets of an arbitrary value itself, so the
 * bracket-free form is the main spelling. `'[…]'` is a second spelling of the
 * same class (ADR 0037 §2): `{ top: '[-1px]' }` writes the class
 * `{ top: '-1px' }` writes, and `redundant-bracket` names the main spelling, on
 * the runtime as on the engine (`bracketed-value-parity.test.ts`).
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
    ])('%j writes the class its value without brackets writes', sz => {
        const [key, value] = Object.entries(sz)[0];
        const plain =
            typeof value === 'string'
                ? { [key]: value.slice(1, -1) }
                : {
                      [key]: Object.fromEntries(
                          Object.entries(value).map(([k, v]) => [k, String(v).slice(1, -1)]),
                      ),
                  };
        expect(t(sz)).not.toBe('');
        expect(t(sz)).toBe(t(plain as never));
    });

    it.each([
        [{ top: '-1px' }, 'top-[-1px]'],
        [{ w: '100px' }, 'w-[100px]'],
        [{ size: '3rem' }, 'size-[3rem]'],
        [{ bg: '#316ff6' }, 'bg-[#316ff6]'],
        [{ w: '.25' }, 'w-0.25'],
        // A decimal on a key whose bracket is the CSS value still brackets.
        [{ opacity: '.25' }, 'opacity-[0.25]'],
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
