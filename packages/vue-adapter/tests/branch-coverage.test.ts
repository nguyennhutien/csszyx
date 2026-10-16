/**
 * Targets the specific branches the existing suites don't reach: the
 * <template> boundary-character scan in extractTemplate, the
 * sz-attribute-at-offset-0 case in findVueSzAttribute, the reference decoding
 * of attribute values, and the malformed-tag paths in mergeClassAttributes.
 */
import { describe, expect, it } from 'vitest';

import { decodeCharacterReferences } from '../src/character-references.js';
import { extractTemplate, mergeClassAttributes, transformTemplate } from '../src/index.js';

describe('extractTemplate boundary scanning', () => {
    it('returns null for an empty source without ever entering the scan loop', () => {
        expect(extractTemplate('')).toBeNull();
    });

    it('skips a look-alike "<templateXYZ" tag and finds the real <template> after it', () => {
        const source = '<templateXYZ></templateXYZ><template>hi</template>';
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

describe('findVueSzAttribute at offset 0', () => {
    it('matches an unprefixed sz attribute starting at the very beginning of the string', () => {
        const result = transformTemplate('sz="{ p: 4 }"');
        expect(result).toEqual({
            code: 'class="p-4"',
            count: 1,
            transformed: true,
            diagnostics: [],
        });
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

describe('mergeClassAttributes malformed/non-element tags', () => {
    it('leaves an unterminated tag (no closing ">") untouched', () => {
        const input = '<div class="a" :class="b"';
        expect(mergeClassAttributes(input)).toBe(input);
    });

    it('skips a closing tag while still merging the matching opening tag', () => {
        const input = '<div class="foo" :class="bar"></div>';
        const result = mergeClassAttributes(input);
        expect(result).toContain(`:class="['foo', bar]"`);
        expect(result).toContain('</div>');
    });

    it('keeps a quote or a backslash in a merged class inside its string', () => {
        expect(mergeClassAttributes(`<div class="a&#39;b\\c&#34;" :class="bar" />`)).toContain(
            `:class="['a\\'b\\\\c&#34;', bar]"`,
        );
    });
});
