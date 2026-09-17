import { describe, expect, it } from 'vitest';

import { horizontalProperty, mergeSignatureFromCss } from '../src/merge-signature.js';

describe('custom-property identity', () => {
    it.each(['ltr', 'rtl'] as const)('preserves opaque names in %s text', direction => {
        // Exhaust the logical fragments and positions rather than sampling one
        // spelling. CSS custom identifiers have no physical/logical semantics.
        for (const fragment of [
            'inline-size',
            'block-size',
            'inline-start',
            'inline-end',
            'block-start',
            'block-end',
            'border-start-start-radius',
        ]) {
            for (const length of [0, 32, 4096]) {
                for (const [prefix, suffix] of [
                    ['', ''],
                    ['Card-', '-value'],
                    ['é-', '-e\u0301'],
                    ['x'.repeat(length), 'y'.repeat(length)],
                ]) {
                    const property = `--${prefix}${fragment}${suffix}`;
                    expect(horizontalProperty(property, direction)).toBe(property);
                }
            }
        }
    });
});

describe('mergeSignatureFromCss', () => {
    it('does not normalize another class resembling an internal placeholder', () => {
        const direct = mergeSignatureFromCss('a', '.a.a { color: red; }');
        const nested = mergeSignatureFromCss('a', '.a.__csszyx_candidate__ { color: red; }');
        expect(nested).not.toEqual(direct);
    });

    it('includes declarations nested under a candidate selector', () => {
        const signature = mergeSignatureFromCss(
            'card',
            '.card { color: red; &:hover { padding: 1rem; } }',
        );
        expect(signature?.rules.flatMap(rule => rule.properties)).toContain('padding-top');
        expect(signature?.rules).toHaveLength(2);
    });

    it('preserves ancestor selectors around a candidate', () => {
        const direct = mergeSignatureFromCss('card', '.card { color: red; }');
        const nested = mergeSignatureFromCss('card', '.parent { .card { color: red; } }');
        expect(nested).not.toEqual(direct);
    });

    it('keeps importance attached to the property that declares it', () => {
        const first = mergeSignatureFromCss('a', '.a { color: red !important; padding: 1rem; }');
        const second = mergeSignatureFromCss('b', '.b { color: red; padding: 1rem !important; }');
        expect(first).not.toEqual(second);
    });

    it('normalizes variants, nested at-rules, important and custom properties', () => {
        const css = String.raw`
            @property --tw-padding { syntax: "*"; inherits: false; }
            .hover\:p-4:hover {
                --tw-padding: 1rem;
                padding: 1rem !important;
                @media (forced-colors: active) { outline: 1px solid transparent; }
            }
            @keyframes hover\:p-4 { from { color: red; } }
        `;

        expect(mergeSignatureFromCss('hover:p-4', css)).toEqual({
            rules: [
                {
                    context:
                        '[[["selector","&:hover"],["at-rule","media","(forced-colors: active)"]],false]',
                    properties: ['outline-color', 'outline-style', 'outline-width'],
                },
                {
                    context: '[[["selector","&:hover"]],false]',
                    properties: ['--tw-padding'],
                },
                {
                    context: '[[["selector","&:hover"]],true]',
                    properties: ['padding-bottom', 'padding-left', 'padding-right', 'padding-top'],
                },
            ],
            important: true,
        });
    });

    it('returns null when CSS has no declaration owned by the candidate', () => {
        expect(mergeSignatureFromCss('missing', '.other { padding: 1rem; }')).toBeNull();
        expect(mergeSignatureFromCss('missing', null)).toBeNull();
    });

    it('retains an at-rule that wraps the candidate selector', () => {
        const css = String.raw`@media (width >= 48rem) { .md\:p-4 { padding: 1rem; } }`;

        expect(mergeSignatureFromCss('md:p-4', css)?.rules[0]?.context).toBe(
            '[[["at-rule","media","(width >= 48rem)"],["selector","&"]],false]',
        );
    });

    it('normalizes a context at-rule with no parameters', () => {
        const css = '@starting-style { .opacity-0 { opacity: 0; } }';

        expect(mergeSignatureFromCss('opacity-0', css)?.rules[0]?.context).toBe(
            '[[["at-rule","starting-style",""],["selector","&"]],false]',
        );
    });
});
