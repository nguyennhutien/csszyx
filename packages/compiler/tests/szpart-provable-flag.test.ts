/**
 * The `szPartArgsProvable` metadata flag, across three engines.
 *
 * `sz={[{ p: 4 }, extra]}` emits `_szPart(extra)`, and importing that helper
 * from the main entry ships the browser transform whether or not an object
 * can ever arrive. When every emitted `_szPart` argument is provably a string
 * or falsy — the szr proof's vocabulary — the bundler can import the merge
 * helpers from the compiler-free `/merge` entry instead. The flag must agree
 * across engines, or a `build.parser` flip would change which entry a file
 * imports.
 */
import { describe, expect, it } from 'vitest';
import { transformSourceCode } from '../src/transform.js';
import { transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

type Engine = (
    source: string,
    filename?: string,
) => { usesSzPart: boolean; szPartArgsProvable: boolean };

const LANES: ReadonlyArray<readonly [string, Engine]> = [
    ['babel', transformSourceCode as Engine],
    ['oxc', transformOxc as Engine],
    ...(isRustTransformAvailable() ? ([['rust', transformRust as Engine]] as const) : []),
];

/** [name, source, expected provable, expected usesSzPart] matrix. */
const MATRIX: ReadonlyArray<readonly [string, string, boolean, boolean]> = [
    [
        'template element is provable',
        'export const A = ({ n }) => <div sz={[{ p: 4 }, `col-${n}`]} />;',
        true,
        true,
    ],
    [
        'ternary of strings is provable',
        'export const A = ({ on }) => <div sz={[{ p: 4 }, on ? `a-${on}` : `b-${on}`]} />;',
        true,
        true,
    ],
    [
        'parenthesized template element is provable',
        'export const A = ({ n }) => <div sz={[{ p: 4 }, (`col-${n}`)]} />;',
        true,
        true,
    ],
    [
        'logical templates are provable',
        'export const A = ({ n }) => <div sz={[{ p: 4 }, `a-${n}` || `b-${n}`]} />;',
        true,
        true,
    ],
    [
        'nested string array is provable',
        "export const A = () => <div sz={[{ p: 4 }, ['a', false, null]]} />;",
        true,
        true,
    ],
    [
        'nested array hole is not provable',
        "export const A = () => <div sz={[{ p: 4 }, ['a', , 'b']]} />;",
        false,
        true,
    ],
    [
        'nested array spread is not provable',
        "export const A = ({ rest }) => <div sz={[{ p: 4 }, ['a', ...rest]]} />;",
        false,
        true,
    ],
    [
        'identifier element is not provable',
        'export const A = ({ extra }) => <div sz={[{ p: 4 }, extra]} />;',
        false,
        true,
    ],
    [
        'member element is not provable',
        'export const A = ({ p }) => <div sz={[{ m: 2 }, p.extra]} />;',
        false,
        true,
    ],
    [
        'call element is not provable',
        'export const A = () => <div sz={[{ m: 2 }, mk()]} />;',
        false,
        true,
    ],
    [
        'no dynamic parts — vacuously provable',
        'export const A = () => <div sz={{ p: 4 }} />;',
        true,
        false,
    ],
    [
        'logical string element compiles without _szPart at all',
        "export const A = ({ on }) => <div sz={[{ p: 4 }, on && 'extra-x']} />;",
        true,
        false,
    ],
];

describe.each(LANES)('%s lane', (_lane, engine) => {
    it.each(MATRIX)('%s', (_name, source, provable, usesSzPart) => {
        const result = engine(source, '/p/t.tsx');
        expect(result.szPartArgsProvable).toBe(provable);
        expect(result.usesSzPart).toBe(usesSzPart);
    });
});

describe('three-engine flag parity', () => {
    it.each(MATRIX)('identical flags for: %s', (_name, source) => {
        const shapes = LANES.map(([, engine]) => {
            const result = engine(source, '/p/t.tsx');
            return `${result.usesSzPart}/${result.szPartArgsProvable}`;
        });
        expect(new Set(shapes).size).toBe(1);
    });
});
