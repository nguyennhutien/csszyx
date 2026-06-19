import { afterEach, describe, expect, it, vi } from 'vitest';

import { type SzObject, transform } from '../src/transform.js';

const t = (sz: SzObject): string => transform(sz).className;

/**
 * Boolean-sugar aliases for single-property utilities (display/position/
 * visibility/isolation/text-transform/font-style/text-decoration-line/
 * font-smoothing) were removed in favour of one canonical key per property.
 * A removed key now emits no class and warns in dev, pointing at the canonical
 * form. These tests lock that contract so the sugar cannot silently return.
 */
describe('removed boolean sugar', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const removed: Array<[string, string]> = [
        ['flex', "{ display: 'flex' }"],
        ['hidden', "{ display: 'none' }"],
        ['block', "{ display: 'block' }"],
        ['absolute', "{ position: 'absolute' }"],
        ['relative', "{ position: 'relative' }"],
        ['invisible', "{ visibility: 'hidden' }"],
        ['isolate', "{ isolation: 'isolate' }"],
        ['uppercase', "{ textTransform: 'uppercase' }"],
        ['italic', "{ fontStyle: 'italic' }"],
        ['underline', "{ decoration: 'underline' }"],
        ['antialiased', "{ fontSmoothing: 'grayscale' }"],
    ];

    for (const [key, canonical] of removed) {
        it(`{ ${key}: true } emits nothing and names the canonical form`, () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(t({ [key]: true } as SzObject)).toBe('');
            expect(spy).toHaveBeenCalledWith(
                expect.stringContaining(`"${key}" boolean sugar was removed`),
            );
            expect(spy).toHaveBeenCalledWith(expect.stringContaining(canonical));
        });
    }

    it('does not break the flex shorthand (flex: 1 / flex: "auto")', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(t({ flex: 1 } as SzObject)).toBe('flex-1');
        expect(t({ flex: 'auto' } as SzObject)).toBe('flex-auto');
        expect(t({ flex: 'none' } as SzObject)).toBe('flex-none');
    });

    it('keeps non-removed boolean shorthands working', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(t({ truncate: true } as SzObject)).toBe('truncate');
        expect(t({ grow: true } as SzObject)).toBe('grow');
        expect(t({ ring: true } as SzObject)).toBe('ring');
        expect(t({ tabularNums: true } as SzObject)).toBe('tabular-nums');
        expect(t({ srOnly: true } as SzObject)).toBe('sr-only');
    });

    describe('canonical replacements produce the right class', () => {
        const cases: Array<[SzObject, string]> = [
            [{ display: 'flex' }, 'flex'],
            [{ display: 'none' }, 'hidden'],
            [{ position: 'absolute' }, 'absolute'],
            [{ visibility: 'hidden' }, 'invisible'],
            [{ isolation: 'isolate' }, 'isolate'],
            [{ textTransform: 'uppercase' }, 'uppercase'],
            [{ textTransform: 'none' }, 'normal-case'],
            [{ fontStyle: 'italic' }, 'italic'],
            [{ fontStyle: 'normal' }, 'not-italic'],
            [{ decoration: 'underline' }, 'underline'],
            [{ decoration: 'none' }, 'no-underline'],
            [{ fontSmoothing: 'grayscale' }, 'antialiased'],
            [{ fontSmoothing: 'subpixel' }, 'subpixel-antialiased'],
        ];
        for (const [sz, expected] of cases) {
            it(`${JSON.stringify(sz)} → ${expected}`, () => {
                expect(t(sz)).toBe(expected);
            });
        }
    });
});
