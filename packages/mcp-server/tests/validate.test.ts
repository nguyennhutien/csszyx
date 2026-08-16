import { KNOWN_SPECIAL_PROPERTIES } from '@csszyx/compiler';
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

    it('surfaces compiler console warnings as warnings', () => {
        // A spacing value off Tailwind's quarter-step scale generates no CSS —
        // the compiler flags that via console.warn, which the tool captures
        // instead of letting it vanish into the MCP server's stderr. (Unique
        // value: the compiler dedupes this warning per key/value per process.)
        const before = console.warn;
        const data = JSON.parse(handleValidate({ sz: { p: 1.3 } }).content[0].text);
        expect(data.valid).toBe(true);
        expect(data.warnings).toHaveLength(1);
        expect(data.warnings[0]).toContain('spacing scale');
        // The interceptor must not leak past the call.
        expect(console.warn).toBe(before);
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

    it('accepts canonical properties lowered by dedicated compiler branches', () => {
        const specialEntries = Object.fromEntries(
            [...KNOWN_SPECIAL_PROPERTIES].map(key => [key, 'test']),
        );
        const data = JSON.parse(
            handleValidate({
                sz: specialEntries,
            }).content[0].text,
        );

        expect(data.valid).toBe(true);
        expect(data.errors).toBeUndefined();
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

    it('reports a transformError (and omits transformResult) when transform() itself throws', () => {
        // Keys all pass the key-level checks (hover is a known variant), but
        // nesting past the compiler's MAX_SZ_DEPTH guard makes the real
        // transform() call throw a genuine SzDepthError.
        let deep: Record<string, unknown> = { p: 4 };
        for (let i = 0; i < 40; i++) {
            deep = { hover: deep };
        }
        const data = JSON.parse(handleValidate({ sz: deep }).content[0].text);

        expect(data.valid).toBe(false);
        expect(data.transformError).toContain('maximum depth');
        expect(data.transformResult).toBeUndefined();
    });
});
