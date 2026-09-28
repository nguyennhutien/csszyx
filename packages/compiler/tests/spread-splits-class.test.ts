/**
 * A spread between a class name and `sz` keeps them two attributes.
 *
 * `sz` and a class name on one element are one attribute everywhere else, and
 * `sz` wins inside it. Across a spread csszyx cannot know what the spread
 * carries, and the platform already has a rule for attributes written on
 * either side of one: in React, Preact, Solid and Qwik the later one replaces
 * the earlier. So each keeps the place it was written in, the `sz` classes
 * come out as a class name of their own where `sz` stood, and the build says
 * that the class name before the spread no longer applies.
 */
import { describe, expect, it } from 'vitest';

import { type EngineMergeTable, szDiagnosticKindOf } from '../src/index.js';
import { ENGINES, normalizeEmit } from './engine-parity-harness.js';

/** `p` covers `pb`. */
const TABLE: EngineMergeTable = {
    format: 1,
    signatures: { 'p-4': 0, 'pb-2': 1 },
    coverage: [[1], []],
};

/**
 * What every engine makes of one element.
 *
 * @param element - The JSX element as written.
 * @param mergeTable - The table to apply, if any.
 * @returns The engine name, the emitted code and the diagnostics, per engine.
 */
function transformElement(element: string, mergeTable?: EngineMergeTable) {
    const source = `export const A = ({ c, n, r }) => ${element};`;
    return ENGINES.map(([name, transform]) => {
        const result = transform(source, 'a.tsx', mergeTable ? { mergeTable } : {});
        return { name, code: normalizeEmit(result.code ?? ''), diagnostics: result.diagnostics };
    });
}

describe('a class name and sz on either side of a spread', () => {
    it.each([
        [
            '<div className="card pb-2" {...r} sz={{ p: 4 }} />',
            'className="card pb-2" {...r} className="p-4"',
        ],
        ['<div class="card" {...r} sz={{ p: 4 }} />', 'class="card" {...r} className="p-4"'],
        ['<div className={c} {...r} sz={{ p: 4 }} />', 'className={c} {...r} className="p-4"'],
        [
            '<div className="card" {...r} {...c} sz={{ p: 4 }} />',
            'className="card" {...r} {...c} className="p-4"',
        ],
        [
            '<div sz={{ p: 4 }} {...r} className="card" />',
            'className="p-4" {...r} className="card"',
        ],
        // A spread is a wall: what is written on one side merges, and each
        // side becomes one class name where its `sz` stood.
        [
            '<div className="card" sz={{ p: 4 }} {...r} sz={{ m: 2 }} />',
            'className="card p-4" {...r} className="m-2"',
        ],
        ['<div sz={{ p: 4 }} {...r} sz={{ m: 2 }} />', 'className="p-4" {...r} className="m-2"'],
        [
            '<div className="a" {...r} className="b" sz={{ p: 4 }} />',
            'className="a" {...r} className="b p-4"',
        ],
        [
            '<div sz={{ p: 4 }} sz={{ m: 2 }} {...r} className="card" />',
            'className="p-4 m-2" {...r} className="card"',
        ],
    ])('%s keeps both where they were written', (element, expected) => {
        for (const { name, code } of transformElement(element)) {
            expect(code, name).toContain(expected);
        }
    });

    it.each([
        ['a ternary', '<div className="card" {...r} sz={{ p: n ? 4 : 2 }} />'],
        ['an array', '<div className="card" {...r} sz={[{ p: 4 }, n && { m: 2 }]} />'],
        ['a runtime value', '<div className="card" {...r} sz={n} />'],
    ])('leaves the class name before the spread alone for %s', (_name, element) => {
        for (const { name, code } of transformElement(element)) {
            expect(code, name).toContain('className="card" {...r} className=');
            expect(code, name).not.toContain('"card",');
        }
    });

    it('writes the CSS variables of every side into the one style', () => {
        for (const { name, code } of transformElement(
            '<div style={{ color: "red" }} sz={{ p: n }} {...r} sz={{ m: c }} />',
        )) {
            expect(code, name).toContain('"--_sz-p"');
            expect(code, name).toContain('"--_sz-m"');
            expect(code.match(/style=/g), name).toHaveLength(1);
        }
    });

    it.each([
        [
            '<div className={c} sz={{ p: n ? 4 : 2 }} {...r} className="d" />',
            'className={_szMerge(c, n ? "p-4" : "p-2")} {...r} className="d"',
        ],
        [
            '<div className={c} sz={[{ p: 4 }, n && { m: 2 }]} {...r} sz={{ m: 2 }} />',
            'className={_szcn(c, "p-4", n && "m-2")} {...r} className="m-2"',
        ],
    ])('%s merges a runtime side as it would without the spread', (element, expected) => {
        for (const { name, code } of transformElement(element)) {
            expect(code, name).toContain(expected);
        }
    });

    it.each([
        [
            '<div className="card pb-2" sz={{ p: 4 }} {...r} className="d" />',
            'className="card p-4" {...r} className="d"',
        ],
        [
            '<div className="x" {...r} className="card pb-2" sz={{ p: 4 }} />',
            'className="x" {...r} className="card p-4"',
        ],
    ])('%s removes what sz covers on its own side', (element, expected) => {
        for (const { name, code } of transformElement(element, TABLE)) {
            expect(code, name).toContain(expected);
        }
    });

    it('removes nothing from the class name across the spread', () => {
        for (const { name, code } of transformElement(
            '<div className="card pb-2" {...r} sz={{ p: 4 }} />',
            TABLE,
        )) {
            expect(code, name).toContain('className="card pb-2" {...r} className="p-4"');
        }
    });

    it('says the class name no longer applies, in production too', () => {
        for (const { name, diagnostics } of transformElement(
            '<div className="card pb-2" {...r} sz={{ p: 4 }} />',
        )) {
            const split = diagnostics.filter(
                message => szDiagnosticKindOf(message) === 'spread-split-class',
            );
            expect(split, name).toHaveLength(1);
            expect(split[0], name).toContain('<div>');
            expect(split[0], name).toContain('`card pb-2` will not apply');
        }
    });

    it('names every earlier side, and does not call two sz on two sides a duplicate', () => {
        for (const { name, diagnostics } of transformElement(
            '<div className="card" sz={{ p: 4 }} {...r} sz={{ m: 2 }} />',
        )) {
            expect(
                diagnostics.map(message => szDiagnosticKindOf(message)),
                name,
            ).toEqual(['spread-split-class']);
            expect(diagnostics[0], name).toContain(
                '`card` and the classes of an earlier `sz` will not apply',
            );
        }
    });

    it.each([
        ['<div {...r} className="card pb-2" sz={{ p: 4 }} />', 'className="card pb-2 p-4"'],
        ['<div className="card pb-2" sz={{ p: 4 }} {...r} />', 'className="card pb-2 p-4"'],
        ['<div className="a" {...r} className="b" />', 'className="a" {...r} className="b"'],
    ])('%s still merges when no spread stands between', (element, expected) => {
        for (const { name, code, diagnostics } of transformElement(element)) {
            expect(code, name).toContain(expected);
            expect(
                diagnostics.filter(message => szDiagnosticKindOf(message) === 'spread-split-class'),
                name,
            ).toEqual([]);
        }
    });
});
