import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetStripSzWarnings, stripSzProps } from '../src/strip-sz-props.js';

describe('stripSzProps', () => {
    beforeEach(() => {
        __resetStripSzWarnings();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('removes sz and keeps the rest of the props', () => {
        const out = stripSzProps({ sz: { p: '4' }, id: 'x', className: 'a' });
        expect(out).toEqual({ id: 'x', className: 'a' });
        expect('sz' in out).toBe(false);
    });

    it('returns the same object untouched when there is no sz', () => {
        const props = { id: 'x', className: 'a' };
        expect(stripSzProps(props)).toBe(props);
    });

    it('warns in dev when a raw sz object would leak to the DOM', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        stripSzProps({ sz: { p: '4' }, id: 'x' });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('compilePackages');
    });

    it('warns at most once across renders', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        stripSzProps({ sz: { p: '4' } });
        stripSzProps({ sz: { m: '2' } });
        stripSzProps({ sz: { gap: '1' } });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('does not warn when sz is a string (compiled output) or absent', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        stripSzProps({ sz: 'p-4', id: 'x' });
        stripSzProps({ id: 'x' });
        expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn in production builds', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            stripSzProps({ sz: { p: '4' } });
        } finally {
            process.env.NODE_ENV = prev;
        }
        expect(warn).not.toHaveBeenCalled();
    });

    it('strips a null/undefined/false sz without warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        for (const sz of [null, undefined, false] as const) {
            const out = stripSzProps({ sz, id: 'x' });
            expect(out).toEqual({ id: 'x' });
            expect('sz' in out).toBe(false);
        }
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns on a raw sz array (also an uncompiled leak)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const out = stripSzProps({ sz: [{ p: '4' }], id: 'x' });
        expect(out).toEqual({ id: 'x' });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('does not mutate a frozen props object', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const frozen = Object.freeze({ sz: { p: '4' }, id: 'x' });
        expect(() => stripSzProps(frozen)).not.toThrow();
        expect(stripSzProps(frozen)).toEqual({ id: 'x' });
        expect(frozen).toEqual({ sz: { p: '4' }, id: 'x' });
        expect(warn).toHaveBeenCalled();
    });

    it('returns non-object inputs unchanged', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // @ts-expect-error — exercising a defensive runtime path
        expect(stripSzProps(null)).toBe(null);
        // @ts-expect-error — exercising a defensive runtime path
        expect(stripSzProps('nope')).toBe('nope');
        expect(warn).not.toHaveBeenCalled();
    });
});
