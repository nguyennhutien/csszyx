/**
 * A decimal on a utility that serves whole numbers only takes the bracket.
 *
 * Tailwind serves `grow-2`, not `grow-2.5`; `order-1`, not `order-1.5`; and a
 * fraction utility serves `w-1/2`, not `w-2.5/4`. Both engines and the runtime
 * core used to write the decimal bare, a class with no CSS and no report. Which
 * utilities serve a decimal bare (`p-2.5`, `opacity-2.5`) is the capability
 * table's `d` column. The lanes bracket only where no Tailwind v4 that
 * `scripts/check-tailwind-versions.mjs` lists serves the bare decimal, which
 * that gate asks of every version (`decimal`). A decimal fraction is always
 * bracketed on a fraction key; `aspect` brackets every ratio already.
 */
import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform-core.js';
import { ENGINES } from './engine-parity-harness.js';

/** sz object, then the class every lane writes for it. */
const CASES: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
    [{ grow: 2.5 }, 'grow-[2.5]'],
    [{ shrink: 2.5 }, 'shrink-[2.5]'],
    [{ flex: 3.5 }, 'flex-[3.5]'],
    [{ strokeWidth: 0.5 }, 'stroke-[0.5]'],
    [{ order: 1.5 }, 'order-[1.5]'],
    [{ z: 1.5 }, 'z-[1.5]'],
    [{ lineClamp: 2.5 }, 'line-clamp-[2.5]'],
    [{ basis: '2.5/4' }, 'basis-[2.5/4]'],
    [{ flex: '3.5/4' }, 'flex-[3.5/4]'],
    [{ w: '2.5/4' }, 'w-[2.5/4]'],
    // Served bare: the spacing scale and opacity. `aspect` serves both
    // spellings of a ratio and keeps the bracket it already wrote.
    [{ p: 2.5 }, 'p-2.5'],
    [{ opacity: 2.5 }, 'opacity-2.5'],
    [{ aspect: '2.5/4' }, 'aspect-[2.5/4]'],
    // A whole number and a whole fraction stay as they were.
    [{ grow: 2 }, 'grow-2'],
    [{ w: '1/2' }, 'w-1/2'],
];

describe.each(CASES)('%j', (sz, expected) => {
    it('lowers in the runtime core', () => {
        expect(transform(sz as never).className).toBe(expected);
    });

    it.each(ENGINES)('lowers through the %s engine', (_name, engine) => {
        const source = `export const A = () => <div sz={${JSON.stringify(sz)}} />;`;
        const { code = '' } = engine(source, { filename: '/p/src/Decimal.tsx' });
        expect(code).toContain(`className="${expected}"`);
    });
});
