import { afterEach, describe, expect, it, vi } from 'vitest';

import { type SzObject, transform } from '../src/transform.js';

const t = (sz: SzObject): string => transform(sz).className;

/**
 * A single CSS property can be set by its canonical key (`position`) or a
 * boolean-sugar alias (`absolute`). Setting both in one object emits
 * duplicate/conflicting classes — the compiler does not dedupe them. These
 * tests lock that output (so docs that warn about it stay honest) and verify
 * the dev-mode diagnostic that flags the collision.
 */
describe('canonical vs boolean-sugar conflict', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('output behaviour (duplicate/conflicting classes)', () => {
        it('{ position: "absolute", relative: true } → "absolute relative"', () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(t({ position: 'absolute', relative: true })).toBe('absolute relative');
        });

        it('{ display: "flex", hidden: true } → "flex hidden"', () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(t({ display: 'flex', hidden: true })).toBe('flex hidden');
        });

        it('{ visibility: "hidden", invisible: true } → "invisible invisible"', () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(t({ visibility: 'hidden', invisible: true })).toBe('invisible invisible');
        });
    });

    describe('dev-mode diagnostic', () => {
        it('warns when a property is set by both canonical key and sugar', () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            t({ position: 'absolute', relative: true });
            expect(spy).toHaveBeenCalledWith(
                expect.stringContaining('is set by both the canonical key "position"'),
            );
        });

        it('does not warn for the canonical key alone', () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            t({ position: 'absolute' });
            expect(spy).not.toHaveBeenCalled();
        });

        it('does not warn for the boolean sugar alone', () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            t({ relative: true });
            expect(spy).not.toHaveBeenCalled();
        });

        it('does not warn across different property groups', () => {
            // display (canonical) + position sugar — separate properties, no clash.
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            t({ display: 'flex', absolute: true });
            expect(spy).not.toHaveBeenCalled();
        });

        it('does not treat the flex shorthand value as the display sugar', () => {
            // { flex: 1 } is the flex-grow shorthand, not display:flex — so pairing
            // it with display: 'grid' is not a conflict.
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            t({ display: 'grid', flex: 1 });
            expect(spy).not.toHaveBeenCalled();
        });
    });
});
