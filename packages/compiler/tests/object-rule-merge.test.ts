/**
 * A later sz key replaces an earlier one whose CSS it covers, at build time.
 *
 * The engine does not read CSS. The plugin works out which of a file's classes
 * cover which from the project's compiled stylesheet and hands the engine that
 * table; the engine only applies it to each static object it lowers. With no
 * table the output is what it always was, so every lane that cannot build one
 * keeps today's classes rather than guessing.
 *
 * The table below is written by hand in the shape the plugin writes: a class
 * maps to a signature id, and each id lists the ids it covers. Signatures carry
 * no value, so `p-4` and `p-8` share one.
 */
import { describe, expect, it } from 'vitest';

import type { EngineMergeTable } from '../src/index.js';
import { ENGINES, normalizeEmit } from './engine-parity-harness.js';

/** `p` covers `pb` and `px`; `size` covers `w`. */
const TABLE: EngineMergeTable = {
    format: 1,
    signatures: {
        'p-4': 0,
        'p-8': 0,
        'pb-2': 1,
        'px-2': 2,
        'size-8': 3,
        'w-4': 4,
        'tw:p-4': 5,
        'tw:pb-2': 6,
        'hover:p-4': 7,
    },
    coverage: [[1, 2], [], [], [4], [], [6], [], []],
};

/**
 * The className every engine emits for one element.
 *
 * @param sz - The sz expression as written.
 * @param options - What the transform is given.
 * @param options.mergeTable - The table to apply, if any.
 * @param options.classPrefix - The stylesheet prefix, if any.
 * @returns The engine name with the emitted element, per engine.
 */
function emit(
    sz: string,
    options: { mergeTable?: EngineMergeTable; classPrefix?: string } = {},
): Array<[string, string]> {
    const source = `export const A = ({ c, n }) => <div sz={${sz}} />;`;
    return ENGINES.map(([name, transform]) => [
        name,
        normalizeEmit(transform(source, 'a.tsx', options).code ?? ''),
    ]);
}

describe('the object rule with a merge table', () => {
    it.each([
        ['{ pb: 2, p: 4 }', 'className="p-4"'],
        ['{ w: 4, size: 8 }', 'className="size-8"'],
        ['{ pb: 2, px: 2, p: 4 }', 'className="p-4"'],
        ['[{ pb: 2 }, { p: 4 }]', 'className="p-4"'],
    ])('drops what a later key covers: %s', (sz, expected) => {
        for (const [name, code] of emit(sz, { mergeTable: TABLE })) {
            expect(code, name).toContain(expected);
        }
    });

    it('keeps a later key that only refines an earlier one', () => {
        for (const [name, code] of emit('{ p: 4, pb: 2 }', { mergeTable: TABLE })) {
            expect(code, name).toContain('className="p-4 pb-2"');
        }
    });

    it('keeps a class in another context', () => {
        for (const [name, code] of emit('{ pb: 2, hover: { p: 4 } }', { mergeTable: TABLE })) {
            expect(code, name).toContain('className="pb-2 hover:p-4"');
        }
    });

    it('reads the table by the class name the stylesheet prefix gives', () => {
        for (const [name, code] of emit('{ pb: 2, p: 4 }', {
            mergeTable: TABLE,
            classPrefix: 'tw',
        })) {
            expect(code, name).toContain('className="tw:p-4"');
        }
    });

    it('applies inside an szs slot', () => {
        const source = 'export const A = () => <Card szs={{ root: { pb: 2, p: 4 } }} />;';
        for (const [name, transform] of ENGINES) {
            const code = normalizeEmit(
                transform(source, 'a.tsx', { mergeTable: TABLE }).code ?? '',
            );
            expect(code, name).toContain('root: "p-4"');
        }
    });
});

describe('what the table does not decide', () => {
    it.each([
        // A value only known at run time is not in the static object.
        '{ p: n, pb: 2 }',
        // Neither is a branch: which one renders is decided later.
        '{ pb: 2, p: c ? 4 : 8 }',
    ])('leaves %s as it compiles without a table', sz => {
        const withTable = emit(sz, { mergeTable: TABLE });
        const without = emit(sz);
        expect(withTable).toEqual(without);
    });

    it.each([
        ['a static selection', "{ s: 'a' }"],
        ['a runtime selection', '{ s: n }'],
    ])('leaves an szv branch as the runtime szv resolves it, for %s', (_, selection) => {
        // The precompiled table stands in for `szv` at run time, which lowers
        // the selected object with no table: merging a branch at build would
        // make the class list depend on whether the config precompiled.
        const source = [
            "import { szv, szr } from 'csszyx';",
            'const F = szv({ base: { pb: 2, p: 4 }, variants: { s: { a: { m: 1 } } } });',
            `export const A = ({ n }) => <div className={szr(F(${selection}))} />;`,
        ].join('\n');
        for (const [name, transform] of ENGINES) {
            const withTable = transform(source, 'a.tsx', { mergeTable: TABLE }).code ?? '';
            const without = transform(source, 'a.tsx').code ?? '';
            expect(normalizeEmit(withTable), name).toBe(normalizeEmit(without));
            expect(without, name).toContain('pb-2 p-4');
        }
    });

    it('changes nothing when no table is given', () => {
        for (const [name, code] of emit('{ pb: 2, p: 4 }')) {
            expect(code, name).toContain('className="pb-2 p-4"');
        }
    });

    it('refuses a table in a format it does not read, and says so', () => {
        const source = 'export const A = () => <div sz={{ pb: 2, p: 4 }} />;';
        for (const [name, transform] of ENGINES) {
            const result = transform(source, 'a.tsx', { mergeTable: { ...TABLE, format: 99 } });
            expect(normalizeEmit(result.code ?? ''), name).toContain('className="pb-2 p-4"');
            expect((result.diagnostics ?? []).join('\n'), name).toMatch(/merge table.*format 99/);
        }
    });
});
