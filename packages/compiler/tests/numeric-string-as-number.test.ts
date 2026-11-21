/**
 * How a number and a numeric string lower, per key (ADR 0037).
 *
 * Which of four cells a key sits in is a fact about Tailwind, measured by
 * comparing the bare class with the bracket class for the same number
 * (`.agent` report, 2026-11-20; gated by `numeric-key-cells.test.ts` in the
 * oracle package):
 *
 * - The bracket is valid CSS that means something else (20 keys: the percent
 *   keys `opacity`, `scale*`, `zoom`, the filters, and `leading`). A number
 *   keeps Tailwind's scale (`opacity-50` = 50%); a numeric string is the CSS
 *   value itself (`opacity: '.5'` → `opacity-[0.5]` = 50%).
 * - The bracket is invalid CSS (spacing, angles, times, integer-only keys). A
 *   numeric string is the number, so `{ p: '4' }` from JSON writes `p-4`.
 * - Bare and bracket are the same CSS (`grow`, `shrink`, `flex`, `stroke`,
 *   `strokeWidth`, `tabSize` on integers). Both write the bare class Tailwind
 *   users write by hand; a decimal, where the bare class is dead, brackets.
 * - The bare class is always dead (`aspect`, `weight`): always the bracket.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __szFactorVar } from '../src/spacing-var.js';
import { __resetSzWarnDedupForTests, type SzObject, transform } from '../src/transform-core.js';
import { ENGINES } from './engine-parity-harness.js';
import { szCodeOf } from './helpers/sz-console-line.js';

/** sz object and the class every lane writes for it. */
const CASES: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
    // A numeric string on a key whose bracket means the CSS value.
    [{ opacity: '.33' }, 'opacity-[0.33]'],
    [{ opacity: '0.33' }, 'opacity-[0.33]'],
    [{ opacity: '0.330' }, 'opacity-[0.33]'],
    [{ opacity: 33 }, 'opacity-33'],
    [{ scale: '1.25' }, 'scale-[1.25]'],
    [{ scale: 125 }, 'scale-125'],
    [{ scaleX: '-1' }, 'scale-x-[-1]'],
    [{ zoom: '1.5' }, 'zoom-[1.5]'],
    [{ brightness: '1.25' }, 'brightness-[1.25]'],
    [{ grayscale: '.5' }, 'grayscale-[0.5]'],
    [{ backdropOpacity: '.5' }, 'backdrop-opacity-[0.5]'],
    [{ backdropSaturate: '1.5' }, 'backdrop-saturate-[1.5]'],
    [{ leading: '1.5' }, 'leading-[1.5]'],
    [{ leading: 6 }, 'leading-6'],
    [{ leading: 1.4 }, 'leading-1.4'],
    [{ hover: { opacity: '.5' } }, 'hover:opacity-[0.5]'],
    [{ opacity: '.5!' }, 'opacity-[0.5]!'],
    // A numeric string on a key whose bracket is no CSS is the number.
    [{ p: '4' }, 'p-4'],
    [{ p: '.5' }, 'p-0.5'],
    [{ mt: '-2' }, '-mt-2'],
    [{ z: '1.5' }, 'z-1.5'],
    [{ rotate: '45' }, 'rotate-45'],
    [{ animationDelay: '200' }, '[animation-delay:200ms]'],
    [{ hover: { p: '.5' } }, 'hover:p-0.5'],
    [{ p: '4!' }, 'p-4!'],
    // Bare and bracket are the same CSS: the bare class, or the bracket where
    // the bare class is dead.
    [{ grow: 2 }, 'grow-2'],
    [{ grow: '2' }, 'grow-2'],
    [{ grow: 2.5 }, 'grow-[2.5]'],
    [{ shrink: '2.5' }, 'shrink-[2.5]'],
    [{ flex: 1.5 }, 'flex-[1.5]'],
    [{ strokeWidth: 1.5 }, 'stroke-[1.5]'],
    [{ tabSize: '2.5' }, 'tab-[2.5]'],
    // The bare class is always dead.
    [{ aspect: 2 }, 'aspect-[2]'],
    [{ aspect: '1.6' }, 'aspect-[1.6]'],
    [{ weight: 700 }, 'font-[700]'],
    [{ weight: '700' }, 'font-[700]'],
    // Text keys keep their string.
    [{ content: '"4"' }, "content-['4']"],
];

describe.each(CASES)('%j', (sz, expected) => {
    beforeEach(() => {
        __resetSzWarnDedupForTests();
    });

    it('lowers in the runtime core', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect(transform(sz as SzObject).className).toBe(expected);
        } finally {
            spy.mockRestore();
        }
    });

    it.each(ENGINES)('lowers through the %s engine', (_name, engine) => {
        const source = `export const A = () => <div sz={${JSON.stringify(sz)}} />;`;
        const { code = '' } = engine(source, { filename: '/p/src/Numeric.tsx' });
        expect(code).toContain(`className="${expected}"`);
    });
});

/**
 * The codes every lane reports for one sz object.
 *
 * @param sz - The object.
 * @returns Runtime codes, then each engine's.
 */
function codesFor(sz: Record<string, unknown>): string[][] {
    __resetSzWarnDedupForTests();
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((line: string) => {
        lines.push(line);
    });
    try {
        transform(sz as SzObject);
    } finally {
        spy.mockRestore();
    }
    const source = `export const A = () => <div sz={${JSON.stringify(sz)}} />;`;
    return [
        lines.map(szCodeOf),
        ...ENGINES.map(([, engine]) =>
            (engine(source, { filename: '/p/src/W.tsx' }).issues ?? []).map(issue => issue.code),
        ),
    ];
}

describe('a factor string above 1 on a key CSS clamps at 1', () => {
    it.each([
        [{ opacity: '50' }],
        [{ grayscale: '2' }],
        [{ backdropInvert: '1.5' }],
        [{ hover: { sepia: '100' } }],
    ])('%j is reported on every lane', sz => {
        for (const codes of codesFor(sz)) expect(codes).toContain('clamped-factor');
    });

    it.each([
        [{ opacity: '1' }],
        [{ opacity: '.5' }],
        [{ opacity: 50 }],
        [{ scale: '105' }],
        [{ brightness: '2' }],
        [{ weight: '700' }],
    ])('%j is not', sz => {
        for (const codes of codesFor(sz)) expect(codes).not.toContain('clamped-factor');
    });
});

describe('a runtime value on a factor key', () => {
    it.each(ENGINES)('goes through the factor helper on the %s engine', (_name, engine) => {
        const { code = '' } = engine(
            'export const A = ({ x }) => <div sz={{ opacity: x, leading: x, grow: x }} />;',
            { filename: '/p/src/R.tsx' },
        );
        expect(code).toContain('"--_sz-opacity": __szFactorVar(x, "opacity")');
        expect(code).toContain('"--_sz-leading": __szFactorVar(x, "leading")');
        expect(code).toContain('"--_sz-grow": x');
    });

    it('resolves a number as the static number and a string as the CSS value', () => {
        expect(__szFactorVar(50, 'opacity')).toBe('50%');
        expect(__szFactorVar('0.5', 'opacity')).toBe('0.5');
        expect(__szFactorVar(150, 'scale')).toBe('150%');
        expect(__szFactorVar(6, 'leading')).toBe('calc(6 * var(--spacing))');
        expect(__szFactorVar('1.5', 'leading')).toBe('1.5');
        expect(__szFactorVar('normal', 'leading')).toBe('normal');
        expect(__szFactorVar(Number.NaN, 'opacity')).toBeUndefined();
        expect(__szFactorVar(undefined, 'opacity')).toBeUndefined();
    });

    it('omits an empty value silently and warns once on a value with no CSS', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        for (const empty of [null, false, '']) {
            expect(__szFactorVar(empty, 'factorvartestkey')).toBeUndefined();
        }
        expect(warn).not.toHaveBeenCalled();
        expect(__szFactorVar({ sm: 0.5 }, 'factorvartestkey')).toBeUndefined();
        expect(__szFactorVar({ md: 1 }, 'factorvartestkey')).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('dynamic-unresolvable');
        warn.mockRestore();
    });
});
