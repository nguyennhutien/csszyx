/**
 * `font-variant-numeric` as one sz key per group of its grammar.
 *
 * CSS spells the property `normal | [ <figure> || <spacing> || <fraction> ||
 * ordinal || slashed-zero ]`: each group once, `normal` alone. Tailwind gives
 * every group its own variable so classes combine, and inside a group the
 * stylesheet order decides, not the author. One key per group makes the object
 * say what CSS does: a later value of the same group replaces the earlier one,
 * different groups combine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

afterEach(() => {
    vi.restoreAllMocks();
});

const GROUPS: ReadonlyArray<readonly [string, string, string]> = [
    ['nums', 'normal', 'normal-nums'],
    ['numFigure', 'lining', 'lining-nums'],
    ['numFigure', 'oldstyle', 'oldstyle-nums'],
    ['numSpacing', 'proportional', 'proportional-nums'],
    ['numSpacing', 'tabular', 'tabular-nums'],
    ['numFraction', 'diagonal', 'diagonal-fractions'],
    ['numFraction', 'stacked', 'stacked-fractions'],
];

describe('font-variant-numeric keys', () => {
    it.each(GROUPS)('runtime lowers %s: %s to %s', (key, value, className) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(transform({ [key]: value }).className).toBe(className);
        expect(warn).not.toHaveBeenCalled();
    });

    it('runtime lowers the two single-keyword groups as flags', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(transform({ numOrdinal: true, numSlashedZero: true }).className).toBe(
            'ordinal slashed-zero',
        );
        expect(warn).not.toHaveBeenCalled();
    });

    it.each(ENGINES)('%s lowers every group and combines different groups', (_name, engine) => {
        const run = captureWarnings(
            engine,
            `export const A = () => (
                <p sz={{ numSpacing: 'tabular', numFigure: 'oldstyle', numFraction: 'diagonal', numOrdinal: true, numSlashedZero: true, md: { nums: 'normal' } }} />
            );`,
        );

        expect(run.className?.split(' ').sort()).toEqual(
            [
                'diagonal-fractions',
                'md:normal-nums',
                'oldstyle-nums',
                'ordinal',
                'slashed-zero',
                'tabular-nums',
            ].sort(),
        );
        expect(run.warnings).toEqual([]);
    });

    it.each(ENGINES)(
        '%s keeps a misspelled value findable and apart from project CSS',
        (_name, engine) => {
            const run = captureWarnings(
                engine,
                "export const A = () => <p sz={{ numSpacing: 'tabulr', numFraction: 'stackd' }} />;",
            );

            // The group's own suffix, so the typo is never a bare `tabulr` that a
            // project's component CSS could be named.
            expect(run.className).toBe('tabulr-nums stackd-fractions');
            expect(run.warnings.join('\n')).toContain('numSpacing');
        },
    );

    it.each(ENGINES)('%s takes a runtime value only where Tailwind can', (_name, engine) => {
        const run = captureWarnings(
            engine,
            `export const A = ({ c, v }) => (
                <p sz={{ numSlashedZero: c, numSpacing: c ? 'tabular' : undefined, numFigure: v }} />
            );`,
        );
        const code = run.result.code ?? '';

        expect(code).toContain('__szBoolClass(c, "numSlashedZero", "slashed-zero")');
        expect(code).toContain('c ? "tabular-nums"');
        expect(code).not.toContain('--_sz-num-figure');
        expect(run.warnings.join('\n')).toContain('"numFigure" cannot take a runtime value');
    });

    it.each(ENGINES)('%s names the new key for every spelling it replaces', (_name, engine) => {
        const run = captureWarnings(
            engine,
            `export const A = () => (
                <p sz={{ tabularNums: true, liningNums: true, stackedFractions: true, ordinal: true, slashedZero: true, fontVariant: 'tabular-nums' }} />
            );`,
        );
        const warnings = run.warnings.join('\n');

        expect(run.className ?? '').toBe('');
        expect(warnings).toContain('"tabularNums" was replaced');
        expect(warnings).toContain("Use { numSpacing: 'tabular' }");
        // These were canonical keys, not sugar; the sugar wording misnamed them.
        expect(warnings).not.toContain('boolean sugar');
        expect(warnings).toContain("Use { numFigure: 'lining' }");
        expect(warnings).toContain("Use { numFraction: 'stacked' }");
        expect(warnings).toContain('canonical key "numOrdinal"');
        expect(warnings).toContain('canonical key "numSlashedZero"');
        expect(warnings).toContain('"fontVariant" was removed');
    });

    // `normal` stands alone in the CSS grammar, so the object's order settles
    // it: the reset replaces the groups written before it, the groups written
    // after it replace the reset.
    it.each(ENGINES)('%s settles the reset and its groups by the object order', (_name, engine) => {
        const run = captureWarnings(
            engine,
            "export const A = () => <p sz={{ numSpacing: 'tabular', nums: 'normal', md: { nums: 'normal', numOrdinal: true } }} />;",
        );

        expect(run.className).toBe('normal-nums md:ordinal');
        expect(run.warnings).toEqual([]);
    });

    it('runtime settles the reset and its groups by the object order', () => {
        expect(transform({ nums: 'normal', numFraction: 'stacked' }).className).toBe(
            'stacked-fractions',
        );
        expect(transform({ numFraction: 'stacked', nums: 'normal' }).className).toBe('normal-nums');
    });

    it('runtime says a replaced flag was replaced, not that sugar was removed', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(transform({ stackedFractions: true }).className).toBe('');
        expect(String(warn.mock.calls[0]?.[0])).toBe(
            '[csszyx] "stackedFractions" was replaced. Use { numFraction: \'stacked\' } instead, or run `csszyx migrate`.',
        );
    });
});
