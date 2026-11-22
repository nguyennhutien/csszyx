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
    /**
     * The properties a rule body declares, read as CSS reads it: an escape
     * (`\\3b`) is a character of the value, and a `;` inside quotes or
     * parentheses belongs to its token, so neither ends a declaration.
     *
     * @param body - The text between a rule's braces.
     * @returns Each top-level declaration's property name.
     */
    function declaredProperties(body: string): string[] {
        const names: string[] = [];
        let depth = 0;
        let quote: string | null = null;
        let start = 0;
        for (let i = 0; i <= body.length; i++) {
            const char = body[i];
            if (char === '\\') {
                i++;
            } else if (quote !== null) {
                if (char === quote) quote = null;
            } else if (char === '"' || char === "'") {
                quote = char;
            } else if (char === '(') {
                depth++;
            } else if (char === ')') {
                depth--;
            } else if ((char === ';' && depth === 0) || i === body.length) {
                const declaration = body.slice(start, i).trim();
                if (declaration !== '')
                    names.push(declaration.slice(0, declaration.indexOf(':')).trim());
                start = i + 1;
            }
        }
        return names;
    }

    it.each(keys)('on `%s`', key => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        for (const payload of payloads) {
            const { className } = transform({ [key]: payload } as SzObject);
            for (const cls of className.split(' ').filter(Boolean)) {
                const rule = generateCSSRule(cls);
                const body = rule.slice(rule.indexOf('{') + 1, rule.lastIndexOf('}'));
                const message = `${key}: ${JSON.stringify(payload)} -> ${rule}`;
                // One rule, no markup, and nothing but the key's own properties.
                expect(rule.split('{').length, message).toBeLessThanOrEqual(2);
                expect(/<|>/.test(body), message).toBe(false);
                for (const name of declaredProperties(body)) {
                    expect(['position', 'display', 'inset', 'z-index'], message).not.toContain(
                        name,
                    );
                }
            }
        }
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
