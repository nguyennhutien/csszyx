import { describe, expect, it } from 'vitest';

import { handleValidate } from '../src/tools/validate';

describe('csszyx_validate', () => {
    it('accepts a correct sz object', () => {
        const data = JSON.parse(handleValidate({ sz: { p: 4, bg: 'red-500' } }).content[0].text);
        expect(data.valid).toBe(true);
        expect(data.errors).toBeUndefined();
        expect(data.transformResult.className).toContain('p-4');
        expect(data.transformResult.className).toContain('bg-red-500');
    });

    it('catches CSS property names and suggests the sz key', () => {
        const data = JSON.parse(handleValidate({ sz: { padding: 4 } }).content[0].text);
        expect(data.valid).toBe(false);
        expect(data.errors[0].key).toBe('padding');
        expect(data.errors[0].suggestion).toContain("'p'");
    });

    it('catches unknown props', () => {
        const data = JSON.parse(handleValidate({ sz: { unknownProp: 'value' } }).content[0].text);
        expect(data.valid).toBe(false);
        expect(data.errors[0].message).toContain("Unknown prop 'unknownProp'");
    });

    // flex's boolean sugar was removed, but flex stays a valid PROPERTY_MAP key
    // for shorthand values (flex:'auto' → flex-auto, flex:1 → flex-1). Those
    // non-boolean values must NOT trigger a warning.
    it('does NOT warn for dual-purpose props with valid non-boolean values', () => {
        for (const value of ['auto', 'none', 1] as const) {
            const data = JSON.parse(handleValidate({ sz: { flex: value } }).content[0].text);
            expect(data.valid).toBe(true);
            expect(data.warnings).toBeUndefined();
        }
    });

    it('accepts variant keys (hover, focus, dark, sm, md, ...)', () => {
        const data = JSON.parse(
            handleValidate({ sz: { hover: { bg: 'blue-600' }, dark: { color: 'white' } } })
                .content[0].text,
        );
        expect(data.valid).toBe(true);
        expect(data.errors).toBeUndefined();
    });

    it('accepts the css escape-hatch key', () => {
        const data = JSON.parse(
            handleValidate({ sz: { p: 4, css: { writingMode: 'vertical-lr' } } }).content[0].text,
        );
        expect(data.valid).toBe(true);
    });

    it('reports multiple errors in a single pass', () => {
        const data = JSON.parse(
            handleValidate({ sz: { padding: 4, margin: 2, fakeKey: true } }).content[0].text,
        );
        expect(data.valid).toBe(false);
        expect(data.errors.length).toBeGreaterThanOrEqual(3);
    });

    it('flags a removed boolean-sugar alias (flex: true) with the canonical replacement', () => {
        // `{ flex: true }` emits no class now — must not pass as valid (a silent
        // no-op that drops the display utility on an upgrade).
        const data = JSON.parse(handleValidate({ sz: { flex: true } }).content[0].text);
        expect(data.valid).toBe(false);
        expect(data.errors[0].key).toBe('flex');
        expect(data.errors[0].suggestion).toContain('display: "flex"');
    });

    it('accepts the canonical display form the suggestion points to', () => {
        const data = JSON.parse(handleValidate({ sz: { display: 'flex' } }).content[0].text);
        expect(data.valid).toBe(true);
        expect(data.transformResult.className).toBe('flex');
    });
});
