import { describe, expect, it } from 'vitest';

import { mergeSignatureFromCss } from '../src/merge-signature.js';

describe('mergeSignatureFromCss', () => {
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
                    context: '&:hover',
                    properties: [
                        '--tw-padding',
                        'padding-bottom',
                        'padding-left',
                        'padding-right',
                        'padding-top',
                    ],
                },
                {
                    context: '@media (forced-colors: active)|&:hover',
                    properties: ['outline-color', 'outline-style', 'outline-width'],
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
            '@media (width >= 48rem)|&',
        );
    });

    it('normalizes a context at-rule with no parameters', () => {
        const css = '@starting-style { .opacity-0 { opacity: 0; } }';

        expect(mergeSignatureFromCss('opacity-0', css)?.rules[0]?.context).toBe(
            '@starting-style|&',
        );
    });
});
