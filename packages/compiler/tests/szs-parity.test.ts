/**
 * `szs` slot-map parity + contract across both engine artifacts.
 *
 * `szs={{ header: { bg: 'gray-100' } }}` compiles each slot VALUE to its class
 * string (keeping the key) so a component forwards `props.szs?.<slot>` into a
 * child className. The v1 contract — identifier keys; pure-literal object or
 * class-string values; custom components only — is enforced identically by
 * both artifacts, and the compiled output is byte-identical between the native
 * and wasm artifacts.
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
import { transformRust } from '../src/transform-rust.js';
import { transformWasm } from '../src/transform-wasm.js';

import { ENGINES, type ParityEngine, RUST_LANE } from './engine-parity-harness.js';

interface EngineOutput {
    code: string;
    classes: string[];
    diagnostics: number;
}

/**
 * Run one engine artifact and normalize its result shape.
 * @param transform - which artifact to run.
 * @param tsx - source to transform.
 * @returns code, ordered classes, and diagnostic count.
 */
function run(transform: ParityEngine, tsx: string): EngineOutput {
    const result = transform(tsx, 'F.tsx');
    return {
        code: result.code ?? '',
        classes: [...(result.classes ?? [])],
        diagnostics: (result.diagnostics ?? []).length,
    };
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
            // Binding absent — the native lane is reported by the harness.
        }
    });

    for (const fixture of COMPILED) {
        it(`compiles — ${fixture.name}`, () => {
            for (const [name, transform] of ENGINES) {
                const out = run(transform, fixture.tsx);
                expect(out.code, `${name} emits the shared format`).toContain(fixture.expectAttr);
                expect(out.classes, `${name} classes in slot order`).toEqual(fixture.classes);
                expect(out.diagnostics, `${name} diagnostics`).toBe(0);
            }
        });

        it.skipIf(!RUST_LANE)(`native is byte-identical to wasm — ${fixture.name}`, () => {
            const wasm = run(transformWasm as ParityEngine, fixture.tsx);
            const rust = run(transformRust as ParityEngine, fixture.tsx);
            expect(rust.code, 'native code equals wasm byte-for-byte').toBe(wasm.code);
            expect(rust.classes, 'native class order equals wasm').toEqual(wasm.classes);
            expect(rust.diagnostics).toBe(wasm.diagnostics);
        });
    }

    for (const fixture of REJECTED) {
        it(`leaves the attribute untouched with a diagnostic — ${fixture.name}`, () => {
            for (const [name, transform] of ENGINES) {
                const out = run(transform, fixture.tsx);
                expect(out.code, `${name} leaves the source unchanged`).toBe(fixture.tsx);
                expect(out.classes, `${name} classes`).toEqual([]);
                expect(out.diagnostics, `${name} records one diagnostic`).toBe(1);
            }
        });
    }

    it('discovery order: sz classes first, then szs classes, across elements', () => {
        const tsx =
            'export const A = () => (<Card sz={{ m: 1 }} szs={{ a: { p: 1 } }}><Card.Sub szs={{ b: { p: 2 } }} sz={{ m: 2 }} /></Card>);';
        const expected = ['m-1', 'm-2', 'p-1', 'p-2'];
        for (const [name, transform] of ENGINES) {
            expect(run(transform, tsx).classes, name).toEqual(expected);
        }
    });

    it('is idempotent: re-transforming pass-1 output changes nothing and warns nothing', () => {
        const tsx =
            'export const A = () => <Card sz={{ p: 4 }} szs={{ header: { bg: "gray-100" } }} />;';
        for (const [name, transform] of ENGINES) {
            const first = run(transform, tsx);
            const second = run(transform, first.code);
            expect(second.code, `${name} pass-2 output stable`).toBe(first.code);
            expect(second.diagnostics, `${name} pass-2 emits no diagnostics`).toBe(0);
        }
    });

    it('empty szs map renames to szsc without classes or diagnostics', () => {
        const tsx = 'export const A = () => <Card szs={{}} />;';
        for (const [name, transform] of ENGINES) {
            const out = run(transform, tsx);
            expect(out.code, name).toContain('szsc={{}}');
            expect(out.classes, name).toEqual([]);
            expect(out.diagnostics, name).toBe(0);
        }
    });
});
