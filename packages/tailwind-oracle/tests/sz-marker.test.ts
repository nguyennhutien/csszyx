/**
 * The two cheap text gates the build reads a module through: one decides
 * whether the transform lowers it, the other whether the prescan reads it
 * for the safelist. `csszyx check` reads through the second, so a module the
 * transform lowers must always pass it too.
 */
import { describe, expect, it } from 'vitest';

import { fileMayContainSafelistableSz, moduleMayHoldSz } from '../src/sz-marker.js';

describe('moduleMayHoldSz', () => {
    it.each([
        ['an sz attribute', '<div sz={{ p: 4 }} />'],
        ['an szs attribute', '<Card szs={{ body: { p: 4 } }} />'],
        ['an sz key', 'const p = { sz: { p: 4 } };'],
        ['a spaced sz key', '<Card szs = {{ sz : { p: 4 } }} />'],
        ['an sz string', 'const p = { sz: "p-4" };'],
        ['an szr call', 'szr({ p: 4 })'],
    ])('reads %s', (_name, code) => {
        expect(moduleMayHoldSz(code)).toBe(true);
    });

    it.each([
        ['a size', 'const size = 4;'],
        ['a variable named sz', 'const sz = 1;'],
    ])('passes over %s', (_name, code) => {
        expect(moduleMayHoldSz(code)).toBe(false);
    });
});

describe('fileMayContainSafelistableSz', () => {
    it.each([
        ['an szv call', 'export const b = szv({ base: { p: 4 } });'],
        ['a dynamic call', "dynamic({ p: 'p-4' })"],
        ['an unspaced sz key with no value yet', 'sz:'],
    ])('reads %s, which the transform gate does not need', (_name, code) => {
        expect(fileMayContainSafelistableSz(code)).toBe(true);
    });

    it('passes over text that only says sz', () => {
        expect(fileMayContainSafelistableSz('const sz = 1; const size = sz;')).toBe(false);
    });

    it('reads every module the transform gate reads', () => {
        const parts = ['sz', 'szs', 'szr', 'szv', ' ', '=', ':', '(', '{', '"', "'", 'x', '\n'];
        // Every string of up to four parts: small enough to run in full.
        let strings = [''];
        for (let length = 0; length < 4; length++) {
            strings = strings.flatMap(prefix => parts.map(part => prefix + part));
            for (const code of strings) {
                if (moduleMayHoldSz(code)) {
                    expect(fileMayContainSafelistableSz(code), JSON.stringify(code)).toBe(true);
                }
            }
        }
    });
});
