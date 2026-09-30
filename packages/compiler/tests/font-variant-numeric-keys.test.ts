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

import { setSzWarnLocation, transform } from '../src/transform-core.js';
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
        expect(warnings).toContain("Use { numSpacing: 'tabular' }");
        expect(warnings).toContain("Use { numFigure: 'lining' }");
        expect(warnings).toContain("Use { numFraction: 'stacked' }");
        expect(warnings).toContain('canonical key "numOrdinal"');
        expect(warnings).toContain('canonical key "numSlashedZero"');
        expect(warnings).toContain('"fontVariant" was removed');
    });

    // `normal` stands alone in the CSS grammar. Beside a group, which class
    // wins depends on whether the build merges classes (a later key does) or
    // leaves both to Tailwind (`normal-nums` sorts last and always does).
    it.each(ENGINES)('%s reports the reset sharing an object with a group', (_name, engine) => {
        const run = captureWarnings(
            engine,
            "export const A = () => <p sz={{ nums: 'normal', numSpacing: 'tabular', md: { numOrdinal: true, nums: 'normal' } }} />;",
        );
        const warnings = run.warnings.join('\n');

        expect(warnings).toContain('"nums: normal"');
        expect(warnings).toContain('"numSpacing"');
        expect(warnings).toContain('"numOrdinal"');
    });

    it('runtime reports the reset sharing an object with a group, once', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        transform({ numFraction: 'stacked', nums: 'normal' });
        transform({ numFraction: 'stacked', nums: 'normal' });

        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('"numFraction"');
    });

    it('runtime names the location when the build set one', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSzWarnLocation('src/Table.tsx:7');
        try {
            transform({ nums: 'normal', numFigure: 'lining' });
        } finally {
            setSzWarnLocation(undefined);
        }

        expect(String(warn.mock.calls[0]?.[0])).toContain('"nums: normal" at src/Table.tsx:7');
    });
});
