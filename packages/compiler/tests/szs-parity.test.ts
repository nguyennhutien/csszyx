/**
 * `szs` slot-map parity + contract across the three engines.
 *
 * `szs={{ header: { bg: 'gray-100' } }}` compiles each slot VALUE to its class
 * string (keeping the key) so a component forwards `props.szs?.<slot>` into a
 * child className. The v1 contract — identifier keys; pure-literal object or
 * class-string values; custom components only — is enforced identically by
 * babel, oxc, and the native engine, and the compiled output is byte-identical
 * between rust and oxc (babel is compared whitespace-normalized because it
 * reprints the file).
 *
 * Discovery order is part of the contract: per file, every sz-derived class
 * (document order) is discovered BEFORE every szs-derived class (document
 * order), because production mangle IDs are assigned in discovery order.
 *
 * Fixtures are field-named (not `const source = ...`) so the extracted-corpus
 * meta-test does not sample them.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { loadNativeBinding } from '../../core/native/index.js';
import { transformSourceCode } from '../src/transform.js';
import { transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

interface EngineOutput {
    code: string;
    classes: string[];
    diagnostics: number;
}

/**
 * Run one engine and normalize its result shape.
 * @param engine - which engine to run.
 * @param tsx - source to transform.
 * @returns code, ordered classes, and diagnostic count.
 */
function run(engine: 'babel' | 'oxc' | 'rust', tsx: string): EngineOutput {
    let result = transformSourceCode(tsx, 'F.tsx');
    if (engine === 'oxc') result = transformOxc(tsx, 'F.tsx');
    else if (engine === 'rust') result = transformRust(tsx, 'F.tsx');
    return {
        code: typeof result === 'string' ? result : result.code,
        classes: [...(result.classes ?? [])],
        diagnostics: (result.diagnostics ?? []).length,
    };
}

/**
 * Whitespace-normalize a code string for babel comparisons (babel reprints the
 * whole file, so only token-level equality is meaningful).
 * @param code - code to normalize.
 * @returns single-spaced code.
 */
function norm(code: string): string {
    return code.replace(/\s+/g, ' ').trim();
}

const COMPILED: Array<{ name: string; tsx: string; expectAttr: string; classes: string[] }> = [
    {
        name: 'two object slots',
        tsx: 'export const A = () => <Card szs={{ header: { bg: "gray-100" }, icon: { color: "red-500" } }} />;',
        expectAttr: 'szsc={{ header: "bg-gray-100", icon: "text-red-500" }}',
        classes: ['bg-gray-100', 'text-red-500'],
    },
    {
        name: 'variant nested in a slot (hover + md + dark)',
        tsx: 'export const A = () => <Card szs={{ cta: { hover: { bg: "blue-700" }, md: { p: 6 }, dark: { bg: "slate-800" } } }} />;',
        expectAttr: 'szsc={{ cta: "hover:bg-blue-700 md:p-6 dark:bg-slate-800" }}',
        classes: ['hover:bg-blue-700', 'md:p-6', 'dark:bg-slate-800'],
    },
    {
        name: 'color+opacity object in a slot',
        tsx: 'export const A = () => <Card szs={{ frame: { borderColor: { color: "red-700", op: 18 } } }} />;',
        expectAttr: 'szsc={{ frame: "border-red-700/18" }}',
        classes: ['border-red-700/18'],
    },
    {
        name: 'arbitrary value in a slot',
        tsx: 'export const A = () => <Card szs={{ media: { w: "337px", m: -2 } }} />;',
        expectAttr: 'szsc={{ media: "w-[337px] -m-2" }}',
        classes: ['w-[337px]', '-m-2'],
    },
    {
        name: 'empty object slot compiles to an empty string',
        tsx: 'export const A = () => <Card szs={{ header: {}, body: { p: 2 } }} />;',
        expectAttr: 'szsc={{ header: "", body: "p-2" }}',
        classes: ['p-2'],
    },
    {
        name: 'many slots keep source order',
        tsx: 'export const A = () => <Card szs={{ a: { p: 1 }, b: { p: 2 }, c: { p: 3 }, d: { p: 4 }, e: { p: 5 }, f: { p: 6 } }} />;',
        expectAttr: 'szsc={{ a: "p-1", b: "p-2", c: "p-3", d: "p-4", e: "p-5", f: "p-6" }}',
        classes: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6'],
    },
    {
        name: 'dotted (compound) component',
        tsx: 'export const A = () => <Card.Sub szs={{ header: { p: 2 } }} />;',
        expectAttr: 'szsc={{ header: "p-2" }}',
        classes: ['p-2'],
    },
    {
        name: 'duplicate slot keys both compile (runtime last-wins)',
        tsx: 'export const A = () => <Card szs={{ a: { p: 1 }, a: { p: 2 } }} />;',
        expectAttr: 'szsc={{ a: "p-1", a: "p-2" }}',
        classes: ['p-1', 'p-2'],
    },
    {
        name: 'a slot named sz is just a slot',
        tsx: 'export const A = () => <Card szs={{ sz: { p: 1 } }} />;',
        expectAttr: 'szsc={{ sz: "p-1" }}',
        classes: ['p-1'],
    },
    {
        name: 'mixed object + string slots (string kept verbatim)',
        tsx: "export const A = () => <Card szs={{ a: { p: 1 }, b: 'flex gap-2' }} />;",
        expectAttr: `szsc={{ a: "p-1", b: 'flex gap-2' }}`,
        classes: ['p-1', 'flex', 'gap-2'],
    },
];

const REJECTED: Array<{ name: string; tsx: string }> = [
    {
        name: 'host element',
        tsx: 'export const A = () => <div szs={{ header: { p: 2 } }} />;',
    },
    {
        name: 'identifier slot value',
        tsx: 'export const A = ({ v }) => <Card szs={{ header: v }} />;',
    },
    {
        name: 'conditional slot value',
        tsx: 'export const A = ({ c }) => <Card szs={{ header: c ? { p: 2 } : { p: 4 } }} />;',
    },
    {
        name: 'spread inside a slot object',
        tsx: 'const b = { p: 2 }; export const A = () => <Card szs={{ header: { ...b } }} />;',
    },
    {
        name: 'spread inside the slot map',
        tsx: 'const m = {}; export const A = () => <Card szs={{ ...m }} />;',
    },
    {
        name: 'computed slot key',
        tsx: 'const k = "h"; export const A = () => <Card szs={{ [k]: { p: 2 } }} />;',
    },
    {
        name: 'string-literal slot key',
        tsx: 'export const A = () => <Card szs={{ "header-x": { p: 2 } }} />;',
    },
    {
        name: 'numeric slot key',
        tsx: 'export const A = () => <Card szs={{ 1: { p: 2 } }} />;',
    },
    {
        name: 'non-object szs value',
        tsx: 'export const A = () => <Card szs="header" />;',
    },
    {
        name: 'array szs value',
        tsx: 'export const A = () => <Card szs={[{ p: 2 }]} />;',
    },
    {
        name: 'identifier nested inside a slot object',
        tsx: 'const v = 4; export const A = () => <Card szs={{ header: { p: v } }} />;',
    },
];

describe('szs slot-map parity', () => {
    beforeAll(() => {
        try {
            loadNativeBinding();
        } catch {
            // Binding absent — rust assertions are skipped below.
        }
    });

    for (const fixture of COMPILED) {
        it(`compiles — ${fixture.name}`, () => {
            const oxc = run('oxc', fixture.tsx);
            const babel = run('babel', fixture.tsx);
            expect(oxc.code, 'oxc emits the shared format').toContain(fixture.expectAttr);
            // babel keeps a kept string slot's ORIGINAL quotes (verbatim), so the
            // expected attribute text matches without quote rewriting.
            expect(norm(babel.code), 'babel matches (normalized)').toContain(
                norm(fixture.expectAttr),
            );
            expect(oxc.classes, 'oxc classes in slot order').toEqual(fixture.classes);
            expect(babel.classes, 'babel classes in slot order').toEqual(fixture.classes);
            expect(oxc.diagnostics).toBe(0);
            expect(babel.diagnostics).toBe(0);
        });

        it.skipIf(!isRustTransformAvailable())(`rust is byte-identical — ${fixture.name}`, () => {
            const oxc = run('oxc', fixture.tsx);
            const rust = run('rust', fixture.tsx);
            expect(rust.code, 'rust code equals oxc byte-for-byte').toBe(oxc.code);
            expect(rust.classes, 'rust class order equals oxc').toEqual(oxc.classes);
            expect(rust.diagnostics).toBe(oxc.diagnostics);
        });
    }

    for (const fixture of REJECTED) {
        it(`leaves the attribute untouched with a diagnostic — ${fixture.name}`, () => {
            const oxc = run('oxc', fixture.tsx);
            const babel = run('babel', fixture.tsx);
            expect(oxc.code, 'oxc leaves the source unchanged').toBe(fixture.tsx);
            expect(oxc.classes).toEqual([]);
            expect(oxc.diagnostics, 'oxc records one diagnostic').toBe(1);
            expect(babel.classes).toEqual([]);
            expect(babel.diagnostics, 'babel records one diagnostic').toBe(1);
        });

        it.skipIf(!isRustTransformAvailable())(
            `rust also rejects it identically — ${fixture.name}`,
            () => {
                const rust = run('rust', fixture.tsx);
                expect(rust.code, 'rust leaves the source unchanged').toBe(fixture.tsx);
                expect(rust.classes).toEqual([]);
                expect(rust.diagnostics, 'rust records one diagnostic').toBe(1);
            },
        );
    }

    it('discovery order: sz classes first, then szs classes, across elements', () => {
        const tsx =
            'export const A = () => (<Card sz={{ m: 1 }} szs={{ a: { p: 1 } }}><Card.Sub szs={{ b: { p: 2 } }} sz={{ m: 2 }} /></Card>);';
        const expected = ['m-1', 'm-2', 'p-1', 'p-2'];
        expect(run('oxc', tsx).classes).toEqual(expected);
        expect(run('babel', tsx).classes).toEqual(expected);
        if (isRustTransformAvailable()) {
            expect(run('rust', tsx).classes).toEqual(expected);
        }
    });

    it('is idempotent: re-transforming pass-1 output changes nothing and warns nothing', () => {
        const tsx =
            'export const A = () => <Card sz={{ p: 4 }} szs={{ header: { bg: "gray-100" } }} />;';
        for (const engine of ['oxc', 'babel'] as const) {
            const first = run(engine, tsx);
            const second = run(engine, first.code);
            expect(norm(second.code), `${engine} pass-2 output stable`).toBe(norm(first.code));
            expect(second.diagnostics, `${engine} pass-2 emits no diagnostics`).toBe(0);
        }
        if (isRustTransformAvailable()) {
            const first = run('rust', tsx);
            const second = run('rust', first.code);
            expect(second.code, 'rust pass-2 output stable').toBe(first.code);
            expect(second.diagnostics).toBe(0);
        }
    });

    it('empty szs map renames to szsc without classes or diagnostics', () => {
        const tsx = 'export const A = () => <Card szs={{}} />;';
        for (const engine of ['oxc', 'babel'] as const) {
            const out = run(engine, tsx);
            expect(norm(out.code)).toContain(norm('szsc={{}}'));
            expect(out.classes).toEqual([]);
            expect(out.diagnostics).toBe(0);
        }
        if (isRustTransformAvailable()) {
            const out = run('rust', tsx);
            expect(out.code).toContain('szsc={{}}');
            expect(out.diagnostics).toBe(0);
        }
    });
});
