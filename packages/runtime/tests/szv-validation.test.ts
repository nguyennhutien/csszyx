import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDevWarnCache } from '../src/dev-warn.js';
import { szv } from '../src/variants.js';

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

    const warned = (re: RegExp) => warn.mock.calls.some(c => re.test(String(c[0])));

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
        expect(warned(/config must be an object/)).toBe(true);
    });

    it('warns when a variant dimension is not an object', () => {
        // @ts-expect-error — variants.size must be an object of values
        szv({ variants: { size: 'sm' } });
        expect(warned(/variants\.size must be an object/)).toBe(true);
    });

    it('warns when a variant value is a primitive, and skips it at render', () => {
        const f = szv({
            // @ts-expect-error — variant value must be an sz object
            variants: { size: { sm: 'px-2' } },
        });
        expect(f({ size: 'sm' })).toEqual({}); // primitive skipped, no crash
        expect(warned(/variants\.size\.sm must be an sz object/)).toBe(true);
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
        expect(warned(/unknown variant "color"/)).toBe(true);
    });

    it('warns on an unknown value for a known variant', () => {
        const f = szv({ variants: { size: { sm: { px: 2 } } } });
        // @ts-expect-error — `xl` is not a value of `size`
        f({ size: 'xl' });
        expect(warned(/"xl" is not a value of variant "size"/)).toBe(true);
    });

    it('warns on a forbidden (prototype-polluting) key in a variant value', () => {
        const hostile = JSON.parse('{"size":{"sm":{"__proto__":{"px":9}}}}');
        szv({ variants: hostile.size ? hostile : hostile });
        expect(warned(/forbidden key "__proto__"/)).toBe(true);
    });

    it('dedupes the same warning (hot path safety)', () => {
        const f = szv({ variants: { size: { sm: { px: 2 } } } });
        // @ts-expect-error — repeated unknown value
        f({ size: 'xl' });
        // @ts-expect-error
        f({ size: 'xl' });
        const xlWarns = warn.mock.calls.filter(c => /is not a value of variant/.test(String(c[0])));
        expect(xlWarns.length).toBe(1);
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
