/**
 * sz array composition — later-wins semantics, 3-engine parity.
 *
 * `sz={[a, b]}` composes with LATER WINS: on the same property, a later
 * element's value overrides an earlier one's. Two lanes, one semantic:
 *   - every element a static object → deep merge at build (later leaf wins
 *     per key path, sibling keys survive) → one compiled className;
 *   - anything else (class strings, `cond && obj` guards, dynamic
 *     expressions like a forwarded `szsc` slot) → `szcn(...)` at runtime,
 *     which applies the same later-wins rule per property group; dynamic
 *     elements pass through `_szPart` (string passthrough / object compile).
 *
 * Before this contract, arrays CONCATENATED conflicting classes
 * (`[{text:'base'},{text:'lg'}]` kept both) and stylesheet order decided the
 * winner — a field-reported footgun. rust must stay byte-identical to oxc;
 * babel matches whitespace-normalized.
 */

import { describe, expect, it } from 'vitest';

import {
    isRustTransformAvailable,
    transformOxc,
    transformRust,
    transformSourceCode,
} from '../src/index.js';

const PRELUDE = `const BASE = { p: 2, m: 1 };
declare const szsc: { title?: string } | undefined;
declare const big: boolean;
declare const things: object[];
`;

/**
 * Strip whitespace differences for babel comparisons.
 *
 * @param code - Transformed source to normalize.
 * @returns The code with whitespace runs collapsed to single spaces.
 */
function norm(code: string): string {
    return code.replace(/\s+/g, ' ');
}

function run(engine: 'oxc' | 'babel' | 'rust', attr: string) {
    const source = `${PRELUDE}export const A = () => <div ${attr} />;`;
    const fn =
        engine === 'oxc' ? transformOxc : engine === 'rust' ? transformRust : transformSourceCode;
    const result = fn(source, 'array.tsx');
    return {
        code: result.code,
        div: result.code.match(/<div[\s\S]*?\/>/)?.[0] ?? '',
        classes: [...result.classes],
        usesSzcn: result.usesSzcn,
        usesSzPart: result.usesSzPart,
        usesMerge: result.usesMerge,
    };
}

interface Fixture {
    name: string;
    attr: string;
    /** Expected `<div …/>` from oxc (rust must equal byte-for-byte). */
    expectDiv: string;
    /** Expected class discovery order (identical across engines). */
    classes: string[];
    usesSzcn?: boolean;
    usesSzPart?: boolean;
}

const FIXTURES: Fixture[] = [
    {
        name: 'static same-key override (later wins)',
        attr: 'sz={[{ text: "base", p: 4 }, { text: "lg" }]}',
        expectDiv: '<div className="text-lg p-4" />',
        classes: ['text-lg', 'p-4'],
    },
    {
        name: 'static deep variant merge (sibling leaves survive)',
        attr: 'sz={[{ hover: { bg: "red-500" } }, { hover: { p: 2 } }]}',
        expectDiv: '<div className="hover:bg-red-500 hover:p-2" />',
        classes: ['hover:bg-red-500', 'hover:p-2'],
    },
    {
        name: 'identifier element deep-merges like an inline object',
        attr: 'sz={[BASE, { p: 8 }]}',
        expectDiv: '<div className="p-8 m-1" />',
        classes: ['p-8', 'm-1'],
    },
    {
        name: 'class-string element → szcn lane',
        attr: 'sz={[{ text: "base", p: 4 }, "text-lg font-bold"]}',
        expectDiv: '<div className={szcn("text-base p-4", "text-lg font-bold")} />',
        classes: ['text-base', 'p-4', 'text-lg', 'font-bold'],
        usesSzcn: true,
    },
    {
        name: 'dynamic element (forwarded szsc slot) → _szPart',
        attr: 'sz={[{ text: "base", p: 4 }, szsc?.title]}',
        expectDiv: '<div className={szcn("text-base p-4", _szPart(szsc?.title))} />',
        classes: ['text-base', 'p-4'],
        usesSzcn: true,
        usesSzPart: true,
    },
    {
        name: 'conditional object guard',
        attr: 'sz={[{ p: 4 }, big && { p: 8 }]}',
        expectDiv: '<div className={szcn("p-4", big && "p-8")} />',
        classes: ['p-4', 'p-8'],
        usesSzcn: true,
    },
    {
        name: 'conditional class-string guard',
        attr: 'sz={[{ p: 4 }, big && "p-8"]}',
        expectDiv: '<div className={szcn("p-4", big && "p-8")} />',
        classes: ['p-4', 'p-8'],
        usesSzcn: true,
    },
    {
        name: 'existing className joins as the first szcn argument',
        attr: 'className="card" sz={[{ p: 4 }, szsc?.title]}',
        expectDiv: '<div className={szcn("card", "p-4", _szPart(szsc?.title))} />',
        classes: ['p-4'],
        usesSzcn: true,
        usesSzPart: true,
    },
    {
        name: 'ternary element stays runtime but safelists both branches',
        attr: 'sz={[{ p: 4 }, big ? { m: 2 } : { m: 8 }]}',
        expectDiv: '<div className={szcn("p-4", _szPart(big ? { m: 2 } : { m: 8 }))} />',
        classes: ['p-4', 'm-2', 'm-8'],
        usesSzcn: true,
        usesSzPart: true,
    },
    {
        name: 'falsy guards are dropped before composition',
        attr: 'sz={[false, { p: 4 }, null, undefined, { m: 2 }]}',
        expectDiv: '<div className="p-4 m-2" />',
        classes: ['p-4', 'm-2'],
    },
    {
        name: 'spread element keeps the whole array a runtime value',
        attr: 'sz={[...things, { p: 4 }]}',
        expectDiv: '<div className={_sz([...things, { p: 4 }])} />',
        classes: ['p-4'],
    },
];

describe('sz array composition — later wins (3-engine parity)', () => {
    for (const fixture of FIXTURES) {
        it(fixture.name, () => {
            const oxc = run('oxc', fixture.attr);
            const babel = run('babel', fixture.attr);
            expect(oxc.div, 'oxc emission').toBe(fixture.expectDiv);
            expect(norm(babel.div), 'babel matches (normalized)').toBe(norm(fixture.expectDiv));
            expect(oxc.classes, 'oxc class discovery order').toEqual(fixture.classes);
            expect(babel.classes, 'babel class discovery order').toEqual(fixture.classes);
            expect(oxc.usesSzcn, 'oxc usesSzcn').toBe(fixture.usesSzcn ?? false);
            expect(oxc.usesSzPart, 'oxc usesSzPart').toBe(fixture.usesSzPart ?? false);
            expect(babel.usesSzcn, 'babel usesSzcn').toBe(fixture.usesSzcn ?? false);
            expect(babel.usesSzPart, 'babel usesSzPart').toBe(fixture.usesSzPart ?? false);
        });

        it.skipIf(!isRustTransformAvailable())(`rust is byte-identical — ${fixture.name}`, () => {
            const oxc = run('oxc', fixture.attr);
            const rust = run('rust', fixture.attr);
            expect(rust.code, 'rust code equals oxc byte-for-byte').toBe(oxc.code);
            expect(rust.classes, 'rust class discovery order equals oxc').toEqual(oxc.classes);
            expect(rust.usesSzcn).toBe(oxc.usesSzcn);
            expect(rust.usesSzPart).toBe(oxc.usesSzPart);
        });
    }

    it('arrays no longer set usesMerge (szcn replaced _szMerge for composition)', () => {
        for (const engine of ['oxc', 'babel'] as const) {
            const out = run(engine, 'sz={[{ p: 4 }, big && { p: 8 }]}');
            expect(out.usesMerge, engine).toBe(false);
        }
        if (isRustTransformAvailable()) {
            expect(run('rust', 'sz={[{ p: 4 }, big && { p: 8 }]}').usesMerge).toBe(false);
        }
    });

    it('three-level deep merge keeps unrelated branches intact', () => {
        const attr =
            'sz={[{ md: { hover: { bg: "red-500", p: 2 } } }, { md: { hover: { bg: "blue-500" } } }]}';
        const oxc = run('oxc', attr);
        expect(oxc.div).toBe('<div className="md:hover:bg-blue-500 md:hover:p-2" />');
        if (isRustTransformAvailable()) {
            expect(run('rust', attr).code).toBe(oxc.code);
        }
    });
});
