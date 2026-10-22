import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeMessage } from '../../compiler/tests/engine-message.js';
import { resetDevWarnCache } from '../src/dev-warn.js';
import { szv } from '../src/variants.js';
import { configInvalidLine, unknownValueLine, unknownVariantLine } from './helpers/szv-lines.js';

// szv config/selection validation: TypeScript catches these at author time, but a
// config from runtime/JSON data, an `as any`, or a JS caller bypasses the types.
// The dev guard warns once and degrades safely instead of emitting dead/wrong
// classes silently. Production is a no-op (asserted last).

describe('szv config/selection validation (dev)', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        resetDevWarnCache();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
    });

    it('accepts a valid config without warning', () => {
        const f = szv({
            base: { rounded: 'md' },
            variants: { size: { sm: { px: 2 }, lg: { px: 8 } } },
            defaultVariants: { size: 'sm' },
        });
        expect(f({ size: 'lg' })).toEqual({ rounded: 'md', px: 8 });
        expect(warn).not.toHaveBeenCalled();
    });

    it('accepts a base-only config without warning', () => {
        // A base-only szv declares one reusable class bundle — valid, not a
        // mis-shape (warning while returning the base anyway helped nobody).
        const f = szv({ base: { p: 4 } });
        expect(f()).toEqual({ p: 4 });
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns and falls back to {} when config is not an object', () => {
        // @ts-expect-error — intentionally invalid
        const f = szv('nope');
        expect(f()).toEqual({});
        expect(warn.mock.calls).toEqual([[configInvalidLine('config', 'string')]]);
    });

    it('warns when a variant dimension is not an object', () => {
        // @ts-expect-error — variants.size must be an object of values
        szv({ variants: { size: 'sm' } });
        expect(warn.mock.calls).toEqual([[configInvalidLine('dimension', 'string', 'size')]]);
    });

    it('warns when a variant value is a primitive, and skips it at render', () => {
        const f = szv({
            // @ts-expect-error — variant value must be an sz object
            variants: { size: { sm: 'px-2' } },
        });
        expect(f({ size: 'sm' })).toEqual({}); // primitive skipped, no crash
        expect(warn.mock.calls).toEqual([
            [configInvalidLine('variant-value', 'string', 'size', 'sm')],
        ]);
    });

    it('allows a null variant value (no styles for that token)', () => {
        const f = szv({ variants: { tone: { muted: null, loud: { weight: 'bold' } } } });
        expect(f({ tone: 'muted' })).toEqual({});
        expect(f({ tone: 'loud' })).toEqual({ weight: 'bold' });
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns on an unknown variant dimension in the selection', () => {
        const f = szv({ variants: { size: { sm: { px: 2 } } } });
        // @ts-expect-error — `color` is not a declared variant
        f({ color: 'blue' });
        expect(warn.mock.calls).toEqual([[unknownVariantLine('color')]]);
    });

    it('warns on an unknown value for a known variant', () => {
        const f = szv({ variants: { size: { sm: { px: 2 } } } });
        // @ts-expect-error — `xl` is not a value of `size`
        f({ size: 'xl' });
        expect(warn.mock.calls).toEqual([[unknownValueLine('size', 'xl', ['sm'])]]);
    });

    it('names every value a dimension defines, each in its own code span', () => {
        const f = szv({ variants: { size: { sm: { px: 2 }, lg: { px: 4 } } } });
        // @ts-expect-error — `xl` is not a value of `size`
        f({ size: 'xl' });
        expect(String(warn.mock.calls[0]?.[0])).toContain(
            'help: add `xl` to `variants.size`, or use one of `sm`, `lg`.',
        );
        expect(warn.mock.calls).toEqual([[unknownValueLine('size', 'xl', ['sm', 'lg'])]]);
    });

    it('describes an object selection without default object stringification', () => {
        const f = szv({ variants: { size: { sm: { px: 2 } } } });
        // @ts-expect-error — object values are structurally invalid selections
        expect(f({ size: {} })).toEqual({});
        expect(warn.mock.calls).toEqual([[unknownValueLine('size', 'object', ['sm'])]]);
    });

    it('warns on a forbidden (prototype-polluting) key in a variant value', () => {
        const hostile = JSON.parse('{"size":{"sm":{"__proto__":{"px":9}}}}');
        szv({ variants: hostile });
        expect(warn.mock.calls).toEqual([
            [
                runtimeMessage(
                    'szv-forbidden-key',
                    '`variants.size.sm` in the `szv` config has the forbidden key `__proto__`, so it is ignored.',
                    'help: remove the key; csszyx never reads `__proto__`, `constructor` or `prototype`.',
                ),
            ],
        ]);
    });

    it('dedupes the same warning (hot path safety)', () => {
        const f = szv({ variants: { size: { sm: { px: 2 } } } });
        // @ts-expect-error — repeated unknown value
        f({ size: 'xl' });
        // @ts-expect-error
        f({ size: 'xl' });
        expect(warn.mock.calls).toEqual([[unknownValueLine('size', 'xl', ['sm'])]]);
    });
});

describe('szv validation is a no-op in production', () => {
    const prev = process.env.NODE_ENV;
    beforeEach(() => {
        process.env.NODE_ENV = 'production';
        resetDevWarnCache();
    });
    afterEach(() => {
        process.env.NODE_ENV = prev;
    });

    it('does not warn and still returns base for a broken config', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // @ts-expect-error — invalid config
        const f = szv({ base: { p: 4 } });
        expect(f()).toEqual({ p: 4 });
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
