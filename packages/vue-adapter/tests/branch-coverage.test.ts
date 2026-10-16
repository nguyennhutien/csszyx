/**
 * Targets the branches the other suites don't reach: the root template's
 * bounds as Vue reads them, and the reference decoding of attribute values.
 */
import { describe, expect, it } from 'vitest';

import { decodeCharacterReferences } from '../src/character-references.js';
import { extractTemplate } from '../src/index.js';

describe('extractTemplate boundary scanning', () => {
    it('returns null for an empty source', () => {
        expect(extractTemplate('')).toBeNull();
    });

    it('skips a look-alike "<templatexyz" block and finds the real <template> after it', () => {
        const source = '<templatexyz></templatexyz><template>hi</template>';
        const info = extractTemplate(source);
        expect(info?.content).toBe('hi');
    });

    it.each([
        ['\t', 'tab'],
        ['\n', 'newline'],
        ['\r', 'carriage-return'],
    ])('accepts %j as the boundary character right after <template', (char, content) => {
        const source = `<template${char}>${content}</template>`;
        expect(extractTemplate(source)?.content).toBe(content);
    });
});

describe('decodeCharacterReferences', () => {
    it('returns a value without references as it is, with no offsets', () => {
        expect(decodeCharacterReferences('{ p: 4 }', 10)).toEqual({ source: '{ p: 4 }' });
    });

    it('decodes named, decimal and hexadecimal references and maps each unit', () => {
        expect(decodeCharacterReferences('a&amp;&#65;&#x42;b', 10)).toEqual({
            source: 'a&ABb',
            offsets: [10, 11, 16, 21, 27],
        });
    });

    it('maps both units of an astral code point to its reference', () => {
        expect(decodeCharacterReferences('&#x1F600;', 0)).toEqual({
            source: '\u{1F600}',
            offsets: [0, 0],
        });
    });

    it('leaves an unknown name and an out-of-range code point as written', () => {
        expect(decodeCharacterReferences('&bogus;&#x110000;', 0).source).toBe('&bogus;&#x110000;');
    });
});
