/**
 * On one element `sz` wins over a static class name, at build time.
 *
 * A class name's class goes when a class the `sz` beside it emits sets every
 * property it sets, read from the table the plugin hands the engine; nothing
 * else changes. The class name is never merged with itself, and the `sz`
 * classes come out as they would with no class name. With no table the output
 * is what it always was.
 */
import { describe, expect, it } from 'vitest';

import type { EngineMergeTable } from '../src/index.js';
import { ENGINES, normalizeEmit } from './engine-parity-harness.js';

/** `p` covers `pb` and `px`; `p-4!` is its own context. */
const TABLE: EngineMergeTable = {
    format: 1,
    signatures: { 'p-4': 0, 'p-8': 0, 'pb-2': 1, 'px-2': 2, 'p-4!': 3, 'tw:p-4': 4, 'tw:pb-2': 5 },
    coverage: [[1, 2], [], [], [1, 2], [5], []],
};

/**
 * The element every engine emits.
 *
 * @param element - The JSX element as written.
 * @param options - What the transform is given.
 * @param options.mergeTable - The table to apply, if any.
 * @param options.classPrefix - The stylesheet prefix, if any.
 * @returns The engine name with the emitted element, per engine.
 */
function emit(
    element: string,
    options: { mergeTable?: EngineMergeTable; classPrefix?: string } = {},
): Array<[string, string]> {
    const source = `export const A = ({ c, n }) => ${element};`;
    return ENGINES.map(([name, transform]) => [
        name,
        normalizeEmit(transform(source, 'a.tsx', options).code ?? ''),
    ]);
}

describe('a static class name beside a static sz', () => {
    it.each([
        ['<div className="pb-2" sz={{ p: 4 }} />', 'className="p-4"'],
        ['<div sz={{ p: 4 }} className="pb-2 px-2" />', 'className="p-4"'],
        ['<div class="pb-2" sz={{ p: 4 }} />', 'className="p-4"'],
        ['<Box className="card pb-2" sz={{ p: 4 }} />', 'className="card p-4"'],
        // The class name is never merged with itself: its own order decides.
        ['<div className="pb-2 p-8" sz={{ m: 2 }} />', 'className="pb-2 p-8 m-2"'],
        // A refinement written in sz after the shorthand survives.
        ['<div className="pb-2" sz={{ p: 4, pb: 2 }} />', 'className="p-4 pb-2"'],
        // Importance is its own context.
        ['<div className="p-4!" sz={{ p: 8 }} />', 'className="p-4! p-8"'],
        ['<div className="pb-2" sz={[{ m: 2 }, { p: 4 }]} />', 'className="m-2 p-4"'],
    ])('%s → %s', (element, expected) => {
        for (const [engine, code] of emit(element, { mergeTable: TABLE })) {
            expect(code, engine).toContain(expected);
        }
    });

    it('keeps every class with no table, as before', () => {
        for (const [engine, code] of emit('<div className="pb-2" sz={{ p: 4 }} />')) {
            expect(code, engine).toContain('className="pb-2 p-4"');
        }
    });

    it('reads the prefixed classes a prefixed stylesheet serves', () => {
        const element = '<div className="card tw:pb-2" sz={{ p: 4 }} />';
        for (const [engine, code] of emit(element, { mergeTable: TABLE, classPrefix: 'tw' })) {
            expect(code, engine).toContain('className="card tw:p-4"');
        }
    });

    // Runtime lanes keep their runtime merge: the table does not change them.
    it.each([
        '<div className="pb-2" sz={c ? { p: 4 } : { m: 2 }} />',
        '<div className={n} sz={{ p: 4 }} />',
        '<div className="pb-2" sz={[{ m: 2 }, c && { p: 4 }]} />',
    ])('leaves %s as it is', element => {
        for (const [[engine, withTable], [, without]] of emit(element, {
            mergeTable: TABLE,
        }).map((row, index) => [row, emit(element)[index] as [string, string]] as const)) {
            expect(withTable, engine).toBe(without);
        }
    });

    it('reports the pair for the plugin to check, on a pass with no table', () => {
        for (const [name, transform] of ENGINES) {
            const source = 'export const A = () => <div className="card pb-2" sz={{ p: 4 }} />;';
            const result = transform(source, 'a.tsx', {});
            expect(result.mergeOverrides, name).toEqual([
                { base: ['card', 'pb-2'], over: ['p-4'] },
            ]);
        }
    });
});
