/**
 * Disqualification edges of the cross-module registry extractor.
 *
 * The extractor's contract is as much about what it REFUSES as what it
 * records: every non-literal shape it let through would become a registry
 * entry whose consumer bails, so each rejection branch here is a behavioural
 * promise, not dead defensiveness. These tests pin the full rejection
 * surface — key shapes, value shapes, declarator shapes — through real
 * parses of the exact source an author could write.
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
    for (const entry of extractCrossModuleRegistryEntries(source, { filename: '/p/styles.ts' })) {
        if (entry.kind === 'sz-object') out[entry.exportName] = entry.value;
    }
    return out;
}

describe('object keys the extractor accepts', () => {
    it('records string-literal keys verbatim', () => {
        expect(szObjects("export const a = { 'max-w': 'sm' };")).toEqual({
            a: { 'max-w': 'sm' },
        });
    });

    it('stringifies numeric keys, matching the engine extractor', () => {
        expect(szObjects("export const a = { 1: 'x' };")).toEqual({ a: { '1': 'x' } });
    });
});

describe('object keys the extractor refuses', () => {
    it('refuses a bigint literal key — no branch stringifies it', () => {
        expect(szObjects("export const a = { 1n: 'x' };")).toEqual({});
    });

    it('refuses a computed key even when its expression is constant', () => {
        expect(szObjects("export const a = { ['p']: 4 };")).toEqual({});
    });
});

describe('values the extractor skips', () => {
    it('drops a null value, as the same literal written locally does', () => {
        // `{ p: null }` beside `sz=` lowers to no class at all, so the export
        // is a static object with nothing in it rather than a refusal.
        expect(szObjects('export const a = { p: null, m: 2 };')).toEqual({ a: { m: 2 } });
    });
});

describe('values the extractor refuses', () => {
    it('refuses an array value', () => {
        expect(szObjects('export const a = { p: [4] };')).toEqual({});
    });

    it('refuses a nested object whose own contents fail evaluation', () => {
        expect(szObjects('export const a = { hover: { p: [4] } };')).toEqual({});
    });
});

describe('negated values', () => {
    it('records a negated number literal', () => {
        expect(szObjects('export const a = { m: -2 };')).toEqual({ a: { m: -2 } });
    });

    it('records a unary plus on a number, which the local evaluator reads', () => {
        expect(szObjects('export const a = { m: +2 };')).toEqual({ a: { m: 2 } });
    });

    it('refuses other unary operators', () => {
        expect(szObjects('export const a = { m: !0 };')).toEqual({});
    });

    it('refuses a negated non-literal', () => {
        expect(szObjects('export const a = { m: -pad };')).toEqual({});
    });

    it('refuses a negated non-number literal', () => {
        expect(szObjects("export const a = { m: -'s' };")).toEqual({});
    });
});

describe('declarators that are not factories or objects', () => {
    it('ignores an exported declaration without an initializer', () => {
        expect(
            extractCrossModuleRegistryEntries('export let a;', { filename: '/p/styles.ts' }),
        ).toEqual([]);
    });

    it('ignores a destructuring export', () => {
        expect(
            extractCrossModuleRegistryEntries('export const { a } = szv({ tone: { red: {} } });', {
                filename: '/p/styles.ts',
            }),
        ).toEqual([]);
    });

    it('ignores a namespaced szv call — only a bare szv identifier qualifies', () => {
        expect(
            extractCrossModuleRegistryEntries('export const f = ns.szv({ tone: { red: {} } });', {
                filename: '/p/styles.ts',
            }),
        ).toEqual([]);
    });
});
