// @vitest-environment jsdom
/**
 * `dynamic()` writes CSS itself, so a class it does not fully understand emits
 * no rule rather than a wrong one.
 *
 * - A variant it does not know (`group-hover:`, `peer-focus:`, or text a
 *   runtime value smuggled in before a `:`) used to be dropped and the utility
 *   applied without it: `w-'a';position:fixed` declared `position: fixed`, so
 *   any utility `dynamic` knows could be injected through a runtime value.
 * - A whole-utility arbitrary property, which `css:` lowers to, is build-time
 *   only (user decision, 2026-11-22): `dynamic` emits nothing for it and says so
 *   in development. A runtime value goes through a property key or `style`.
 * - A `:` inside brackets or parentheses belongs to the value
 *   (`bg-[url(https://x.example/a.png)]`), not to a variant.
 */

import { type SzObject, transform } from '@csszyx/compiler/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    __resetUnsupportedWarningsForTests,
    generateCSSRule,
    parseVariants,
} from '../src/css-generator.js';
import { isSafeCssValue } from '../src/css-sanitize.js';

beforeEach(() => {
    __resetUnsupportedWarningsForTests();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('a class dynamic() does not fully understand emits no rule', () => {
    it.each([
        // A runtime value carrying `:` and a utility name after it.
        "w-'a';position:fixed",
        'w-1px_position:fixed',
        'p-x:fixed',
        'bg-x:inset-0',
        'opacity-1:z-50',
        // Variants dynamic() has no selector for.
        'group-hover:bg-red-500',
        'peer-focus:fixed',
        'aria-checked:bg-red-500',
        'data-open:p-4',
        // `css:` lowers to a whole-utility arbitrary property.
        '[color:red]',
        '[--brand:url(https://evil.example/x)]',
        'hover:[color:red]',
        'md:[position:fixed]',
    ])('%s', className => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(generateCSSRule(className)).toBe('');
    });
});

describe('a runtime value cannot add a declaration through dynamic()', () => {
    // The path `dynamic()` takes: the sz object to classes, each class to a
    // rule. Measured 2026-11-22: 16 of these 132 inputs declared
    // `position: fixed` before the fix.
    const payloads = [
        '1px;position:fixed;inset:0',
        '1px}body{display:none',
        '1px</style><script>alert(1)</script>',
        '1px]_p-[2px',
        'x];position:fixed;[y',
        'red\\3b position:fixed',
        'url(https://evil.example/track)',
        'url("x);position:fixed;(")',
        'calc(1px);position:fixed',
        '--a;position:fixed',
        "'a';position:fixed",
        '1px\nposition:fixed',
        // An escape or a quote reads as a bracket to a scanner that skips them,
        // so a `;` looked nested while CSS reads it at the top level.
        'x\\(;position:fixed;--z:\\)',
        '(--a\\();position:fixed;--z:\\))',
        'calc(1px\\();position:fixed;--z:\\))',
        '(--a"(");position:fixed;--z:(")")',
        "calc(1px'(');position:fixed;--z:(')')",
        'x\\[;position:fixed;--z:\\]',
        // A comment is nothing to CSS, so a bracket or quote inside one
        // opens nothing, while a scanner that reads it does.
        'calc(1px)/*(*/;position:fixed;/*)*/',
        'var(--a)/*(*/;position:fixed;/*)*/',
        'url(x)/*"*/;position:fixed;/*"*/',
        "url(x)/*'*/;position:fixed;/*'*/",
        'x/*[*/;position:fixed;/*]*/',
        // An unquoted url ends at its first `)`, and a quote or a `(` inside
        // it makes it a bad url, so neither opens anything to CSS.
        "url(a'b)c;position:fixed;d'e)",
        'url(a"b)c;position:fixed;d"e)',
        'url(a()x;position:fixed;)',
    ];
    const keys = [
        'w',
        'p',
        'bg',
        'color',
        'content',
        'gridCols',
        'opacity',
        'shadow',
        'rotate',
        'bgImg',
        '--brand',
    ];
    it.each(keys)('on `%s`', key => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        for (const payload of payloads) {
            const { className } = transform({ [key]: payload } as SzObject);
            for (const cls of className.split(' ').filter(Boolean)) {
                const rule = generateCSSRule(cls);
                if (rule === '') continue;
                const message = `${key}: ${JSON.stringify(payload)} -> ${rule}`;
                expect(/<|>/.test(rule), message).toBe(false);
                // The CSSOM reads the rule, so escapes, quotes and comments
                // count as the browser counts them. A rule it refuses is
                // dropped, as the injector drops it.
                const sheet = new CSSStyleSheet();
                try {
                    sheet.insertRule(rule);
                } catch {
                    continue;
                }
                const { style } = sheet.cssRules[0] as CSSStyleRule;
                const declared = Array.from({ length: style.length }, (_, i) => style[i]);
                for (const name of ['position', 'display', 'inset', 'z-index', 'top', 'left']) {
                    expect(declared, message).not.toContain(name);
                }
            }
        }
    });
});

describe('isSafeCssValue reads a value as the CSSOM does', () => {
    // Three bypasses (an escape, a comment, an unquoted url) were each a text
    // around a `;` that the scanner read as nesting and CSS did not. This
    // checks every such text up to a bound rather than the last one found:
    // each value is `left;position:fixed;right`, with `left` up to three and
    // `right` up to two of the pieces a CSS tokenizer treats specially. All
    // three known bypasses fit inside the bound.
    const pieces = ['(', ')', '"', "'", '\\', '/*', '*/', 'url(', 'a', ' '];

    /**
     * Every sequence of up to `max` pieces, joined.
     *
     * @param max - The longest sequence.
     * @returns The joined texts, the empty one included.
     */
    function sequences(max: number): string[] {
        let level = [''];
        const all = [''];
        for (let length = 1; length <= max; length++) {
            level = level.flatMap(text => pieces.map(piece => text + piece));
            all.push(...level);
        }
        return all;
    }

    // About 160 ms locally, 4,798 values accepted and read. One sheet is
    // reused and the result asserted once, since a new sheet and an `expect`
    // per value cost more; the timeout covers a shared CI runner, measured
    // about 27x slower than a local run on the first version of this test.
    it('declares only the property itself for every value it accepts', {
        timeout: 20_000,
    }, () => {
        const rights = sequences(2);
        const sheet = new CSSStyleSheet();
        const escaped: string[] = [];
        let accepted = 0;
        for (const left of sequences(3)) {
            for (const right of rights) {
                const value = `${left};position:fixed;${right}`;
                if (!isSafeCssValue(value)) continue;
                accepted++;
                try {
                    sheet.insertRule(`.x { width: ${value} }`, 0);
                } catch {
                    continue;
                }
                const { style } = sheet.cssRules[0] as CSSStyleRule;
                if (style.getPropertyValue('position') !== '') escaped.push(value);
                sheet.deleteRule(0);
            }
        }
        expect(escaped).toEqual([]);
        // Values the scanner accepts must exist, or the check proves nothing.
        expect(accepted).toBeGreaterThan(100);
    });
});

describe('a known variant still applies', () => {
    it.each([
        ['hover:bg-red-500', ':hover'],
        ['focus:hover:bg-red-500', ':focus:hover'],
        ['dark:text-white', '.dark '],
        ['md:p-4', 'padding'],
    ])('%s', (className, part) => {
        expect(generateCSSRule(className)).toContain(part);
    });
});

describe('a colon inside brackets or parentheses is part of the value', () => {
    it('splits a variant only outside them', () => {
        expect(parseVariants('hover:bg-[url(https://x.example/a.png)]').utility).toBe(
            'bg-[url(https://x.example/a.png)]',
        );
        expect(parseVariants('bg-(--a:b)').utility).toBe('bg-(--a:b)');
    });
});

describe('development says why nothing was emitted', () => {
    it('names an unknown variant and a css: property once each', () => {
        vi.stubEnv('NODE_ENV', 'development');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        generateCSSRule('group-hover:bg-red-500');
        generateCSSRule('group-hover:bg-blue-500');
        generateCSSRule('[color:red]');
        generateCSSRule('[color:blue]');
        const lines = warn.mock.calls.map(([line]) => String(line));
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('dynamic-unsupported');
        expect(lines[0]).toContain('group-hover');
        expect(lines[1]).toContain('dynamic-unsupported');
        expect(lines[1]).toContain('css:');
    });

    it('stays quiet in production', () => {
        vi.stubEnv('NODE_ENV', 'production');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(generateCSSRule('peer-hover:p-4')).toBe('');
        expect(warn).not.toHaveBeenCalled();
    });
});
