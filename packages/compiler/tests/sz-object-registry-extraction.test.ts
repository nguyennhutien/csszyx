/**
 * Registry extraction for plain exported sz objects.
 *
 * The design-system pattern is not always a variant table. A module that just
 * exports `export const cardSz = { p: 4 }` was invisible to the registry, so an
 * importer fell back to the runtime and its classes reached no safelist — the
 * class text existed nowhere in any output, so nothing downstream was told to
 * generate the CSS.
 *
 * The extractor is shared with the szv one on purpose: the bundler builds the
 * registry ONCE and hands the same entries to every engine, so cross-module
 * knowledge cannot differ per parser. Entries carry their kind because the two
 * are not interchangeable — an szv config is a variant TABLE, a plain object is
 * a VALUE, and the consumer machinery for each is different.
 *
 * The qualification bar is deliberately the local one: an object qualifies
 * across a module boundary exactly when the identical literal would resolve
 * declared in the consuming file. A second, narrower predicate here would be
 * the subset-predicate failure this repo has already shipped once.
 */
import { describe, expect, it } from 'vitest';

import { extractCrossModuleRegistryEntries } from '../src/cross-module-extract.js';

/**
 * Extract, keeping only the plain-object entries.
 *
 * @param source - Module source text.
 * @returns Export name to its recorded value.
 */
function szObjects(source: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const entry of extractCrossModuleRegistryEntries(source, '/p/styles.ts')) {
        if (entry.kind === 'sz-object') out[entry.exportName] = entry.value;
    }
    return out;
}

describe('exported static sz objects reach the registry', () => {
    it('records a plain exported object literal', () => {
        expect(szObjects("export const cardSz = { p: 4, rounded: 'lg' };")).toEqual({
            cardSz: { p: 4, rounded: 'lg' },
        });
    });

    it('records nested variant objects, which are still one static value', () => {
        expect(szObjects("export const cardSz = { p: 4, hover: { bg: 'blue-500' } };")).toEqual({
            cardSz: { p: 4, hover: { bg: 'blue-500' } },
        });
    });

    it('sees through the TS assertions authors are told to write', () => {
        expect(szObjects('export const a = { p: 4 } as const;')).toEqual({ a: { p: 4 } });
        expect(szObjects('export const b = { p: 4 } satisfies object;')).toEqual({ b: { p: 4 } });
    });

    it('records every declarator of a multi-name export', () => {
        expect(szObjects('export const a = { p: 4 }, b = { m: 2 };')).toEqual({
            a: { p: 4 },
            b: { m: 2 },
        });
    });

    it('keeps property order, which decides mangle token order downstream', () => {
        const recorded = szObjects('export const a = { z: 1, m: 2, p: 4 };') as {
            a: Record<string, unknown>;
        };
        expect(Object.keys(recorded.a)).toEqual(['z', 'm', 'p']);
    });
});

describe('what the registry refuses to carry', () => {
    it.each([
        ['a call result', 'export const a = build();'],
        ['a value read from another binding', 'const S = 4;\nexport const a = { p: S };'],
        ['a computed key', "const k = 'p';\nexport const a = { [k]: 4 };"],
        ['a spread of anything', 'export const a = { ...base, p: 4 };'],
        ['a non-object value', "export const a = 'p-4';"],
        ['a let binding', 'export let a = { p: 4 };'],
        ['a non-exported object', 'const a = { p: 4 };'],
        ['a default export', 'export default { p: 4 };'],
    ])('refuses %s', (_label, source) => {
        // Refusing costs the optimization and nothing else: the importer keeps
        // the runtime path it has today, and says so.
        expect(szObjects(source)).toEqual({});
    });

    it('refuses a name the runtime owns, so a shadowing export cannot hijack it', () => {
        expect(szObjects('export const szr = { p: 4 };')).toEqual({});
    });
});

describe('the two kinds stay apart', () => {
    it('tags an szv factory and a plain object differently in one module', () => {
        const tsx = [
            "import { szv } from '@csszyx/runtime';",
            "export const table = szv({ base: { p: 4 }, variants: { tone: { a: { bg: 'red-500' } } } });",
            'export const plain = { m: 2 };',
        ].join('\n');
        const kinds = Object.fromEntries(
            extractCrossModuleRegistryEntries(tsx, '/p/styles.ts').map(entry => [
                entry.exportName,
                entry.kind,
            ]),
        );
        expect(kinds).toEqual({ table: 'szv-config', plain: 'sz-object' });
    });

    it('does not record an szv call as a plain object', () => {
        const tsx =
            "import { szv } from '@csszyx/runtime';\nexport const t = szv({ base: { p: 4 } });";
        expect(szObjects(tsx)).toEqual({});
    });
});
