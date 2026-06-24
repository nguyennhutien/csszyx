import { transform } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';
import { szcn } from '../src/merge-classes.js';

// szcn's unit tests assert behaviour on hand-written class strings. This file
// closes the loop: it feeds szcn the className strings the COMPILER actually
// emits for the corresponding `sz` props, proving the token shapes the unit
// tests assume are real csszyx output — not fiction. If a future compiler change
// alters how a variant / important / negative / arbitrary value lowers, this
// breaks here instead of letting the merge silently mis-handle real classes.

/**
 * Compile an sz object to the className string the runtime receives.
 *
 * @param sz - An sz object literal.
 * @returns The compiled className string.
 */
const cn = (sz: Record<string, unknown>) => transform(sz).className;

describe('szcn — round-trip with real compiler output', () => {
    it('merges stacked/group/peer variant classes as emitted', () => {
        expect(
            szcn(cn({ group: { hover: { gap: 2 } } }), cn({ group: { hover: { gap: 8 } } })),
        ).toBe('group-hover:gap-8');
        expect(szcn(cn({ peer: { checked: { p: 2 } } }), cn({ peer: { checked: { p: 8 } } }))).toBe(
            'peer-checked:p-8',
        );
        expect(szcn(cn({ md: { hover: { gap: 2 } } }), cn({ md: { hover: { gap: 8 } } }))).toBe(
            'md:hover:gap-8',
        );
    });

    it('handles arbitrary data / supports / container / selector variants as emitted', () => {
        expect(
            szcn(
                cn({ data: { 'state=open': { gap: 2 } } }),
                cn({ data: { 'state=open': { gap: 8 } } }),
            ),
        ).toBe('data-[state=open]:gap-8');
        expect(
            szcn(
                cn({ supports: { 'display:grid': { gap: 2 } } }),
                cn({ supports: { 'display:grid': { gap: 8 } } }),
            ),
        ).toBe('supports-[display:grid]:gap-8');
        expect(szcn(cn({ '@md': { gap: 2 } }), cn({ '@md': { gap: 8 } }))).toBe('@md:gap-8');
        expect(szcn(cn({ '[&>span]': { gap: 2 } }), cn({ '[&>span]': { gap: 8 } }))).toBe(
            '[&>span]:gap-8',
        );
    });

    it('keeps a variant override isolated from the base, end to end', () => {
        expect(szcn(cn({ gap: 2 }), cn({ group: { hover: { gap: 8 } } }))).toBe(
            'gap-2 group-hover:gap-8',
        );
    });

    it('resolves canonical csszyx important (trailing ! from the sz value) directionally', () => {
        // { p: '8!' } is the documented important form → `p-8!` (Tailwind v4).
        expect(szcn(cn({ pb: '2!' }), cn({ p: '8!' }))).toBe('p-8!');
        expect(szcn(cn({ p: '8!' }), cn({ pb: '2!' }))).toBe('p-8! pb-2!');
    });

    it('resolves negative directional spacing from the sz value', () => {
        expect(szcn(cn({ mt: -2 }), cn({ m: -8 }))).toBe('-m-8');
        expect(szcn(cn({ m: -4 }), cn({ mb: -8 }))).toBe('-m-4 -mb-8');
    });

    it('overrides arbitrary values as emitted', () => {
        expect(szcn(cn({ w: '337px' }), cn({ w: '400px' }))).toBe('w-[400px]');
        expect(szcn(cn({ pb: '2px' }), cn({ p: '9px' }))).toBe('p-[9px]');
    });

    it('applies directional shorthand/longhand coverage to emitted padding/inset/rounded', () => {
        expect(szcn(cn({ pb: 4 }), cn({ p: 8 }))).toBe('p-8');
        expect(szcn(cn({ top: 0 }), cn({ inset: 0 }))).toBe('inset-0');
        expect(szcn(cn({ roundedT: 'sm' }), cn({ rounded: 'lg' }))).toBe('rounded-lg');
    });
});
