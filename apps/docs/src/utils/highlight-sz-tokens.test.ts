import { describe, expect, it } from 'vitest';

import { highlightSzTokens } from './highlight-sz-tokens.js';

describe('highlightSzTokens', () => {
    it('highlights keys and scalar value types while preserving whitespace', () => {
        expect(highlightSzTokens(`{p: 4, active: true, color: 'red-500'}`, '')).toBe(
            '<span style="color:light-dark(#94a3b8,#475569)">{</span>' +
                '<span class="key">p</span>: <span class="number">4</span>' +
                '<span style="color:light-dark(#94a3b8,#475569)">,</span> ' +
                '<span class="key">active</span>: <span class="boolean">true</span>' +
                '<span style="color:light-dark(#94a3b8,#475569)">,</span> ' +
                '<span class="key">color</span>' +
                '<span style="color:light-dark(#94a3b8,#475569)">:</span> ' +
                '<span class="string">\'red-500\'</span>' +
                '<span style="color:light-dark(#94a3b8,#475569)">}</span>',
        );
    });

    it('uses animated hero classes for symbols and tokens', () => {
        expect(highlightSzTokens('{scale: -0.5}', 'ho-')).toBe(
            '<span class="ho-symbol">{</span>' +
                '<span class="ho-key">scale</span>: <span class="ho-number">-0.5</span>' +
                '<span class="ho-symbol">}</span>',
        );
    });

    it('preserves incomplete and unrecognized text during typing', () => {
        expect(highlightSzTokens('{custom: value', '')).toContain('value');
        expect(highlightSzTokens('"unfinished', '')).toBe('"unfinished');
    });
});
