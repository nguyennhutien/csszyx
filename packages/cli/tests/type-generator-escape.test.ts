import { describe, expect, it } from 'vitest';

import { generateTypeDeclarations } from '../src/generator/type-generator.js';
import type { ResolvedTheme } from '../src/scanner/tailwind-scanner.js';

function gen(theme: Partial<ResolvedTheme>): string {
    return generateTypeDeclarations(theme as ResolvedTheme, { includeComments: false });
}

// The emitter builds value unions via generateUnionType (e.g. `bg?: 'brand' | …`).
// Theme keys flow into those single-quoted string literals, so a hostile key must
// not be able to break out of the literal or inject a newline.
describe('generateTypeDeclarations union escaping (F1)', () => {
    it('emits valid color tokens byte-identically', () => {
        const out = gen({ colors: { brand: '#111', 'brand-dark': '#000' } });
        expect(out).toContain("'brand'");
        expect(out).toContain("'brand-dark'");
    });

    it('escapes a hostile color name so it cannot break the union literal', () => {
        const out = gen({ colors: { "ev'il": '#000', brand: '#111' } });
        expect(out).toContain("'ev\\'il'");
        expect(out).not.toContain("'ev'il'");
    });

    it('escapes backslash and newline in a token', () => {
        const out = gen({ colors: { 'e\\f': '#000', 'c\nd': '#000' } });
        expect(out).toContain("'e\\\\f'");
        expect(out).toContain("'c\\nd'");
    });
});
