/**
 * Security tests for the runtime CSS declaration sanitizer. The dynamic CSS
 * generator interpolates arbitrary values into declaration text; these guards
 * must block same-rule injection while leaving every legitimate value intact.
 */

import { describe, expect, it } from 'vitest';
import { generateDeclarations } from '../src/css-generator.js';
import {
    isSafeCssPropertyName,
    isSafeCssValue,
    isUtilityArbitrarySafe,
    isUtilityStructureSafe,
} from '../src/css-sanitize.js';

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
            '"launch 🚀"',
            'url( /img.png )', // whitespace around an unquoted url is allowed
            "url( 'a;b' )", // a quoted url is a function holding a string
            'xurl(a b)', // `xurl(` is another function, not a url
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
            'x\\(;position:fixed;--z:\\)', // an escaped paren opens nothing
            'red\\', // an escape outside a string
            'a\\🚀b',
            'u\\72l(a"b)c;position:fixed;d"e)', // an escaped name spelling `url(`
            "url(a'b)c;position:fixed;d'e)", // a quote makes a bad url
            'URL(a()x;position:fixed;)', // so does a `(`, in any case
            'url(a b)', // whitespace inside the url
            'url(/img.png', // an unclosed url
            'url(\u007f)', // a control character
            'calc(1px)/*(*/;position:fixed;/*)*/', // a comment opens nothing
            'red/**/',
        ]) {
            expect(isSafeCssValue(v), v).toBe(false);
        }
    });

    it('skips an escaped quote inside a quoted string instead of ending the string', () => {
        // content: "a\"b" — the backslash must consume the escaped quote so the
        // scanner doesn't treat it as the string terminator.
        expect(isSafeCssValue('"a\\"b"')).toBe(true);
    });

    it('does not go negative on a stray closing paren (no injection risk either way)', () => {
        // A lone trailing ")" with no matching "(" can't break out of the
        // declaration (it isn't {, }, <, > or a bare ;), so it's left alone —
        // this exercises the paren-depth guard that keeps depth clamped at 0.
        expect(isSafeCssValue('red)')).toBe(true);
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
        for (const u of [
            'bg-[url(/i.png)]',
            'w-[calc(100%-2rem)]',
            '[mask-type:luminance]',
            '[--c:red]',
            'content-["🧭"]',
        ]) {
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

    it('rejects a bracket segment whose inner brackets do not balance', () => {
        // First `[` to last `]` spans two utilities: `width: 1px] p-[2px`.
        for (const u of [
            'w-[1px]_p-[2px]',
            'w-[a]b]',
            'w-[[a]',
            'grid-cols-[a]_[b]',
            '[--c:a]b]',
        ]) {
            expect(isUtilityArbitrarySafe(u), u).toBe(false);
        }
        // Balanced inner brackets are values: grid line names.
        for (const u of [
            'grid-cols-[[a]_1fr_[b]]',
            'grid-rows-[[top]_auto]',
            '[--c:[x]]',
            // A bracket inside a quoted string is text, an escaped quote included.
            'content-["[x"]',
            "content-['a\\'[']",
        ]) {
            expect(isUtilityArbitrarySafe(u), u).toBe(true);
        }
    });

    it('treats a malformed bracket pair (close before open) as safe — downstream emits nothing', () => {
        // lastIndexOf(']') < indexOf('['): there's no well-formed [...] segment
        // to validate, and the generator's own bracket checks won't match this
        // shape either, so it's passed through rather than rejected outright.
        expect(isUtilityArbitrarySafe('a]b[c')).toBe(true);
    });
});

describe('isUtilityStructureSafe', () => {
    it.each([
        'p-4',
        'bg-red-500/50',
        'text-[14px]',
        'bg-[#fff]/50',
        'bg-red-500/[0.5]',
        'bg-[#fff]!',
        'bg-(--brand)',
        'text-(length:--fs)',
        'bg-(--c)/50',
        // The modifier can be a custom property too.
        'bg-blue-500/(--alpha)',
        'bg-[#fff]/(--a)',
        'bg-(--c)/(--a)',
    ])('accepts %s', utility => {
        expect(isUtilityStructureSafe(utility)).toBe(true);
    });

    it.each([
        // The text after a bracket's `]` is copied into the rule as well.
        'bg-[#fff]/(--a;position:fixed)',
        'bg-[#fff]/x;position:fixed',
        'w-[1px]x',
        'bg-blue-500/(--a;position:fixed)',
        'bg-blue-500/(red)',
        'bg-(red)',
        'w-a;position:fixed',
    ])('refuses %s', utility => {
        expect(isUtilityStructureSafe(utility)).toBe(false);
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
