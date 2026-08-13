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

import {
    extractCrossModuleRegistryEntries,
    unwrapExpression,
} from '../src/cross-module-extract.js';

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

describe('values the extractor refuses', () => {
    it('refuses a null literal — not a class-producing value', () => {
        expect(szObjects('export const a = { p: null };')).toEqual({});
    });

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

    it('refuses unary operators other than minus', () => {
        expect(szObjects('export const a = { m: +2 };')).toEqual({});
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
        expect(extractCrossModuleRegistryEntries('export let a;', '/p/styles.ts')).toEqual([]);
    });

    it('ignores a destructuring export', () => {
        expect(
            extractCrossModuleRegistryEntries(
                'export const { a } = szv({ tone: { red: {} } });',
                '/p/styles.ts',
            ),
        ).toEqual([]);
    });

    it('ignores a namespaced szv call — only a bare szv identifier qualifies', () => {
        expect(
            extractCrossModuleRegistryEntries(
                'export const f = ns.szv({ tone: { red: {} } });',
                '/p/styles.ts',
            ),
        ).toEqual([]);
    });
});

describe('unwrapExpression', () => {
    it('stops on a wrapper node that carries no inner expression', () => {
        // No parse produces this shape — a TS wrapper always has an
        // expression — but the walker runs on nodes cast from `unknown`, so
        // the guard is what keeps a malformed node from looping forever.
        const orphan = { type: 'ParenthesizedExpression' } as Parameters<
            typeof unwrapExpression
        >[0];
        expect(unwrapExpression(orphan)).toBe(orphan);
    });
});
