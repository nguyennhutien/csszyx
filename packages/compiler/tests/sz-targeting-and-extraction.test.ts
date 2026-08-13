import { describe, expect, it } from 'vitest';
import { transformSource } from '../src/transform-select.js';

// Regression locks for behaviors that are easy to break silently and were
// confirmed by hand during design discussions. Each asserts the EXACT contract
// downstream guidance + the design-system patterns rely on, so a refactor that
// changes where `sz` lands, how szv is extracted, or how a semantic color is
// emitted fails here instead of shipping a hidden side-effect.

describe('sz targets: html tag vs component vs runtime value', () => {
    it('rewrites sz on an HTML tag to className ON the tag', () => {
        const r = transformSource('export const A = () => <div sz={{ p: 4, bg: "blue-500" }} />;');
        expect(r.code).toContain('<div className="p-4 bg-blue-500"');
        expect(r.classes.has('p-4')).toBe(true);
        expect(r.classes.has('bg-blue-500')).toBe(true);
    });

    it('rewrites sz on a COMPONENT to a className PROP (not an sz object)', () => {
        // <Box sz={{...}}> compiles to <Box className="..."> — the component
        // receives `className`, NOT `sz`, and must forward it to a real tag.
        // This is the "putting sz on a component is not enough" contract.
        const r = transformSource('export const B = () => <Box sz={{ p: 4, bg: "blue-500" }} />;');
        expect(r.code).toContain('<Box className="p-4 bg-blue-500"');
        expect(r.code).not.toContain('sz={');
        // The classes are still extracted/safelisted from the literal.
        expect(r.classes.has('p-4')).toBe(true);
        expect(r.classes.has('bg-blue-500')).toBe(true);
    });

    it('lowers a runtime sz value to _sz() and extracts no classes', () => {
        const r = transformSource('export const C = ({ sz }) => <div sz={sz} />;');
        expect(r.code).toContain('_sz(sz)');
        expect(r.classes.size).toBe(0);
    });
});

describe('szv extraction is declaration-based (indirection does not break it)', () => {
    const config =
        'const v = szv({ variants: { sev: { warn: { bg: { color: "warning", op: 10 } }, ok: { bg: { color: "success", op: 10 } } } } });';
    const expected = ['bg-success/10', 'bg-warning/10'];
    const sorted = (r: { classes: Set<string> }) => [...r.classes].sort();

    it('extracts every variant class from the config declaration alone (no usage)', () => {
        const r = transformSource(`import { szv } from "csszyx"; ${config}`);
        expect(sorted(r)).toEqual(expected);
    });

    it('extracts the same classes when used directly in sz=', () => {
        const r = transformSource(
            `import { szv } from "csszyx"; ${config} export const X = ({ sev }) => <div sz={v({ sev })} />;`,
        );
        expect(sorted(r)).toEqual(expected);
    });

    it('extracts the same classes when the factory output flows through splitBoxSz', () => {
        const r = transformSource(
            `import { szv, splitBoxSz } from "csszyx"; ${config} export const X = ({ sev }) => { const { outer, inner } = splitBoxSz(v({ sev })); return <div sz={outer}><span sz={inner} /></div>; };`,
        );
        expect(sorted(r)).toEqual(expected);
    });
});

describe('custom semantic @theme colors emit first-class classes', () => {
    // A semantic token (registered via @theme { --color-warning }) must lower to
    // a real utility, not an arbitrary/invalid class. Tailwind generates the CSS
    // (incl. color-mix for /op) once the token is a theme color.
    const cls = (src: string) =>
        transformSource(`export const X = () => <div sz={${src}} />;`).code;

    it('emits bg-<token> for a semantic background color', () => {
        expect(cls('{ bg: "warning" }')).toContain('className="bg-warning"');
    });

    it('emits bg-<token>/<op> for a semantic color with opacity', () => {
        expect(cls('{ bg: { color: "warning", op: 10 } }')).toContain('className="bg-warning/10"');
    });

    it('emits text-<token> for a semantic text color', () => {
        expect(cls('{ color: "warning" }')).toContain('className="text-warning"');
    });
});
