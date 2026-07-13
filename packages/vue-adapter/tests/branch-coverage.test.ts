/**
 * Targets the specific branches the existing suites don't reach: the
 * value-extraction edge cases in extractValue/extractObjectNode, the
 * <template> boundary-character scan in extractTemplate, the sz-attribute-
 * at-offset-0 case in findVueSzAttribute, and the malformed-tag paths in
 * mergeClassAttributes.
 */
import { describe, expect, it } from 'vitest';

import {
    extractTemplate,
    mergeClassAttributes,
    parseObjectLiteral,
    transformTemplate,
} from '../src/index.js';

describe('extractValue edge branches', () => {
    it('rejects a unary plus (only unary minus on a numeric literal is supported)', () => {
        const result = transformTemplate('<div :sz="{ p: +4 }" />');
        expect(result.count).toBe(0);
        expect(result.code).toContain(':sz=');
    });

    it('treats an array hole as null instead of failing the whole array', () => {
        const result = transformTemplate('<div :sz="{ p: 4, list: [1, , 3] }" />');
        expect(result.count).toBe(1);
        expect(result.code).toContain('p-4');
    });

    it('rejects the whole object when an array element is unsupported', () => {
        const result = transformTemplate('<div :sz="{ p: 4, list: [1, fn()] }" />');
        expect(result.count).toBe(0);
        expect(result.code).toContain(':sz=');
    });
});

describe('extractObjectNode key branches', () => {
    it('accepts a quoted string key as an alternative to an identifier key', () => {
        expect(parseObjectLiteral(`{ 'p': 4 }`)).toEqual({ p: 4 });
    });

    it('rejects a key that is neither an identifier nor a string/number literal', () => {
        // A BigInt property key parses as a Literal whose value is neither
        // a string nor a number, falling through every supported case.
        expect(parseObjectLiteral('{ 1n: 4 }')).toBeNull();
    });
});

describe('parseObjectLiteral defensive catch branch', () => {
    it('returns null instead of throwing when given a non-string value', () => {
        expect(parseObjectLiteral(null as unknown as string)).toBeNull();
    });
});

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
        expect(result).toEqual({ code: 'class="p-4"', count: 1, transformed: true });
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
});
