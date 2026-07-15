/**
 * Field-report regression: a runtime expression on a spacing-scale key used to
 * bake `calc(v * var(--spacing))` into the emitted style, silently producing
 * invalid CSS for every string the sz type system accepts on those keys
 * ('full', '100%', '3/12', 'max-content'). Both TS engines must now route the
 * value through __szSpacingVar/__szUnitVar, flag the helper import, and keep
 * engine parity — including the array-element _szPart diagnostic and the
 * best-effort safelist of partially-static array elements.
 */
import { describe, expect, it } from 'vitest';
import { transformSourceCode } from '../src/transform.js';
import { transformOxc } from '../src/transform-oxc.js';

const ENGINES = [
    ['babel', (jsx: string) => transformSourceCode(jsx, 'probe.tsx', {})],
    ['oxc', (jsx: string) => transformOxc(jsx, 'probe.tsx', {})],
] as const;

describe.each(ENGINES)('dynamic spacing/unit lowering (%s)', (_name, run) => {
    it('routes a dynamic spacing value through __szSpacingVar with its key', () => {
        const jsx = 'export const A = ({ width }) => <div sz={{ w: width, h: "max" }} />;';
        const result = run(jsx);
        expect(result.code).toContain('__szSpacingVar(width, "w")');
        expect(result.code).not.toContain('var(--spacing)');
        expect(result.usesSpacingVar).toBe(true);
        expect(result.usesUnitVar).toBe(false);
        // The static sibling still compiles statically.
        expect(result.code).toContain('h-max');
    });

    it('routes dynamic angle and duration values through __szUnitVar', () => {
        const jsx = 'export const A = ({ r, d }) => <div sz={{ rotate: r, delay: d }} />;';
        const result = run(jsx);
        expect(result.code).toContain('__szUnitVar(r, "deg", "rotate")');
        expect(result.code).toContain('__szUnitVar(d, "ms", "delay")');
        expect(result.usesUnitVar).toBe(true);
        expect(result.usesSpacingVar).toBe(false);
    });

    it('does not flag the helpers for purely static or color-only sources', () => {
        const jsx = 'export const A = ({ c }) => <div sz={{ p: 4, bg: c }} />;';
        const result = run(jsx);
        expect(result.usesSpacingVar).toBe(false);
        expect(result.usesUnitVar).toBe(false);
        expect(result.usesColorVar).toBe(true);
    });

    it('precompiles a finite conditional property inside an array object', () => {
        const jsx =
            'export const A = ({ on, other }) => ' +
            '<div sz={[{ py: 2, border: true, opacity: on ? 50 : 100 }, other]} />;';
        const result = run(jsx);
        expect(result.diagnostics).toEqual([]);
        expect(result.code).toContain(
            '_szcn("py-2 border", on ? "opacity-50" : "opacity-100", _szPart(other))',
        );
        // Static siblings and both finite branches are compiler-owned classes.
        for (const cls of ['py-2', 'border', 'opacity-50', 'opacity-100']) {
            expect(result.classes.has(cls)).toBe(true);
        }
    });

    it('safelists nested variant partials inside a degraded array element', () => {
        const jsx =
            'export const B = ({ c, x }) => <div sz={[{ hover: { m: 2, p: c ? 1 : 3 } }, x]} />;';
        const result = run(jsx);
        for (const cls of ['hover:m-2', 'hover:p-1', 'hover:p-3']) {
            expect(result.classes.has(cls)).toBe(true);
        }
    });
});

describe('engine parity for the report scenarios', () => {
    it.each([
        ['export const A = ({ width }) => <div sz={{ w: width, h: "max" }} />;'],
        ['export const A = ({ r, d }) => <div sz={{ rotate: r, delay: d }} />;'],
        [
            'export const A = ({ on, other }) => ' +
                '<div sz={[{ py: 2, border: true, opacity: on ? 50 : 100 }, other]} />;',
        ],
    ])('babel and oxc agree on classes and diagnostics: %s', jsx => {
        const babel = transformSourceCode(jsx, 'probe.tsx', {});
        const oxc = transformOxc(jsx, 'probe.tsx', {});
        expect([...babel.classes].sort()).toEqual([...oxc.classes].sort());
        expect(babel.diagnostics).toEqual(oxc.diagnostics);
    });
});
