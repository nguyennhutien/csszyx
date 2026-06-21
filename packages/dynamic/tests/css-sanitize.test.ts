/**
 * Security tests for the runtime CSS declaration sanitizer. The dynamic CSS
 * generator interpolates arbitrary values into declaration text; these guards
 * must block same-rule injection while leaving every legitimate value intact.
 */

import { describe, expect, it } from 'vitest';
import {
    isSafeCssPropertyName,
    isSafeCssValue,
    isUtilityArbitrarySafe,
} from '../src/css-sanitize.js';
import { generateDeclarations } from '../src/css-generator.js';

describe('isSafeCssValue', () => {
    it('accepts legitimate single values', () => {
        for (const v of [
            'red',
            '#ff0000',
            '1px',
            'calc(1px + 2px)',
            'linear-gradient(to right, red, blue)',
            'var(--x)',
            'url(/img.png)',
            'url("a.png")',
            'url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)', // ; inside url() is fine
            '"some;text"', // ; inside a quoted string is fine
            '1fr 2fr',
        ]) {
            expect(isSafeCssValue(v), v).toBe(true);
        }
    });

    it('rejects same-rule injection and breakout attempts', () => {
        for (const v of [
            'red;position:fixed', // second declaration injection
            'red}', // rule breakout
            'red} body{display:none', // breakout + new rule
            'x</style', // markup breakout attempt
            'a<b',
            '1px{',
            'red;\nposition:fixed', // CRLF/newline
            'red\t;x', // control char
            'calc(1px', // unbalanced paren
            '"unterminated', // unterminated quote
        ]) {
            expect(isSafeCssValue(v), v).toBe(false);
        }
    });
});

describe('isSafeCssPropertyName', () => {
    it('accepts real property names', () => {
        for (const n of ['color', 'background-color', '-webkit-mask', '--my-var', 'mask-type']) {
            expect(isSafeCssPropertyName(n), n).toBe(true);
        }
    });
    it('rejects malformed / injecting names', () => {
        for (const n of ['color;x', 'color:red', 'a b', '', 'co{lor', '1color']) {
            expect(isSafeCssPropertyName(n), n).toBe(false);
        }
    });
});

describe('isUtilityArbitrarySafe', () => {
    it('passes utilities with no arbitrary segment (csszyx-generated)', () => {
        for (const u of ['p-4', 'bg-blue-500', 'opacity-50', 'flex']) {
            expect(isUtilityArbitrarySafe(u), u).toBe(true);
        }
    });
    it('passes legitimate arbitrary values and properties', () => {
        for (const u of ['bg-[url(/i.png)]', 'w-[calc(100%-2rem)]', '[mask-type:luminance]', '[--c:red]']) {
            expect(isUtilityArbitrarySafe(u), u).toBe(true);
        }
    });
    it('rejects injecting arbitrary values and property names', () => {
        for (const u of [
            '[color:red;position:fixed]',
            '[color:red}html{x:y]',
            'w-[1px;display:none]',
            '[a;b:c]',
        ]) {
            expect(isUtilityArbitrarySafe(u), u).toBe(false);
        }
    });
});

describe('generateDeclarations — sanitizer chokepoint', () => {
    it('still emits legitimate arbitrary declarations', () => {
        expect(generateDeclarations('[mask-type:luminance]')).toBe('mask-type: luminance');
        expect(generateDeclarations('opacity-[0.5]')).toBe('opacity: 0.5');
    });
    it('drops injecting arbitrary input (fail-safe, returns empty)', () => {
        for (const u of ['[color:red;position:fixed]', 'w-[1px;display:none]', '[a;b:c]']) {
            expect(generateDeclarations(u), u).toBe('');
        }
    });
});
