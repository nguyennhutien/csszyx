import type { SzObject } from '@csszyx/compiler/browser';
import { SzDepthError } from '@csszyx/compiler/browser';
import { describe, expect, it, vi } from 'vitest';
import { purifySz } from '../src/purify.js';

describe('purifySz', () => {
    it('drops unknown top-level keys, keeps allowed ones', () => {
        const drops: string[] = [];
        const out = purifySz({ bgColor: 'red', evilKey: 'x', bg: 'blue', p: 4 } as SzObject, {
            onDrop: path => drops.push(path),
        });
        expect(out).toEqual({ bg: 'blue', p: 4 });
        expect(drops).toContain('bgColor');
        expect(drops).toContain('evilKey');
    });

    it('drops values that could inject a second CSS declaration', () => {
        expect(purifySz({ bg: 'red;position:fixed;inset:0' } as SzObject)).toEqual({});
        expect(purifySz({ bg: 'red}' } as SzObject)).toEqual({});
    });

    it('drops prototype-polluting keys without polluting Object.prototype', () => {
        const hostile = JSON.parse(
            '{"__proto__":{"polluted":1},"constructor":{"x":1},"bg":"red"}',
        ) as SzObject;
        const out = purifySz(hostile);
        expect(out).toEqual({ bg: 'red' });
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('recursively purifies a variant object', () => {
        const out = purifySz({
            hover: { bg: 'red', evil: 'x', focus: { opacity: 50 } },
        } as SzObject);
        expect(out).toEqual({ hover: { bg: 'red', focus: { opacity: 50 } } });
    });

    it('leaves a fully-valid sz object unchanged', () => {
        const valid = {
            p: 4,
            bg: 'red',
            opacity: 50,
            hover: { opacity: 70 },
        } as SzObject;
        expect(purifySz(valid)).toEqual(valid);
    });

    it('keeps property sub-objects (bg:{color,op}) while validating their values', () => {
        expect(purifySz({ bg: { color: 'red', op: 50 } } as SzObject)).toEqual({
            bg: { color: 'red', op: 50 },
        });
        // an unsafe value inside the sub-object is dropped
        expect(purifySz({ bg: { color: 'red;x', op: 50 } } as SzObject)).toEqual({
            bg: { op: 50 },
        });
    });

    it('strips url()/expression() in strict mode, keeps them when strict:false', () => {
        const sz = { bg: '[url(/img.png)]' } as SzObject;
        expect(purifySz(sz)).toEqual({}); // strict default
        expect(purifySz(sz, { strict: false })).toEqual({ bg: '[url(/img.png)]' });
    });

    it('throws SzDepthError on hostile deep nesting', () => {
        let deep: SzObject = { bg: 'red' };
        for (let i = 0; i < 100; i++) deep = { hover: deep };
        expect(() => purifySz(deep)).toThrow(SzDepthError);
    });

    it('recognizes SPECIAL_VARIANTS keys directly (data/aria grouping keys)', () => {
        const out = purifySz({ data: { active: { bg: 'red' } } } as SzObject);
        expect(out).toEqual({ data: { active: { bg: 'red' } } });
    });

    it('recognizes @-prefixed container/supports-style variant keys', () => {
        const out = purifySz({ '@container': { bg: 'red' } } as SzObject);
        expect(out).toEqual({ '@container': { bg: 'red' } });
    });

    it('recognizes a bracket-wrapped arbitrary selector key', () => {
        const out = purifySz({ '[&:hover]': { bg: 'red' } } as SzObject);
        expect(out).toEqual({ '[&:hover]': { bg: 'red' } });
    });

    it('recognizes group-/peer- compound variant keys', () => {
        const out = purifySz({ 'peer-checked': { bg: 'red' } } as SzObject);
        expect(out).toEqual({ 'peer-checked': { bg: 'red' } });
    });

    it('recognizes a bracketed arbitrary functional variant key (min-[…])', () => {
        const out = purifySz({ 'min-[500px]': { display: 'flex' } } as SzObject);
        expect(out).toEqual({ 'min-[500px]': { display: 'flex' } });
    });

    it('drops a key that looks nothing like a known key or a variant', () => {
        const drops: string[] = [];
        const out = purifySz({ totallyMadeUp: { bg: 'red' } } as SzObject, {
            onDrop: path => drops.push(path),
        });
        expect(out).toEqual({});
        expect(drops).toContain('totallyMadeUp');
    });

    it('throws SzDepthError on hostile deep nesting reached through a property sub-object', () => {
        // The existing "hostile deep nesting" test above nests entirely through
        // variant keys (hover -> hover -> ...), which recurses via
        // sanitizeObject's own depth counter. Deep nesting reached through a
        // plain property's sub-object value (not a variant) recurses through
        // purifyValue's independent depth guard instead — a different code path
        // that needs its own coverage.
        let deep: SzObject = { x: 'red' } as SzObject;
        for (let i = 0; i < 40; i++) deep = { nested: deep } as unknown as SzObject;
        expect(() => purifySz({ bg: deep } as SzObject)).toThrow(SzDepthError);
    });

    it('returns {} for non-object input', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // @ts-expect-error — defensive runtime path
        expect(purifySz(null)).toEqual({});
        // @ts-expect-error — defensive runtime path
        expect(purifySz('nope')).toEqual({});
        warn.mockRestore();
    });
});
