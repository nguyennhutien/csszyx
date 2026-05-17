import { describe, expect, it } from 'vitest';

import { hasTokens, mergeThemes, parseThemeBlocks } from '../src/theme-scanner.js';

describe('parseThemeBlocks', () => {
    it('returns empty theme for CSS with no @theme block', () => {
        const css = `
body { margin: 0; }
.foo { color: red; }
`;
        const result = parseThemeBlocks(css);
        expect(result.colors).toEqual([]);
        expect(result.spacings).toEqual([]);
        expect(result.fonts).toEqual([]);
        expect(result.radii).toEqual([]);
        expect(result.shadows).toEqual([]);
    });

    it('extracts color tokens from @theme block', () => {
        const css = `
@theme {
    --color-brand: #ff0000;
    --color-brand-dark: #cc0000;
}
`;
        const result = parseThemeBlocks(css);
        expect(result.colors).toEqual(['brand', 'brand-dark']);
    });

    it('strips trailing numeric shade suffix from color tokens', () => {
        const css = `
@theme {
    --color-brand-50: #fff8f0;
    --color-brand-500: #ff6600;
    --color-brand-900: #1a0500;
}
`;
        const result = parseThemeBlocks(css);
        // All three should deduplicate to a single 'brand' token
        expect(result.colors).toEqual(['brand']);
    });

    it('keeps named segments that look like shades but are not purely numeric', () => {
        const css = `
@theme {
    --color-brand-dark: #cc0000;
    --color-brand-dark-50: #ffddd0;
}
`;
        const result = parseThemeBlocks(css);
        // 'brand-dark-50' strips trailing -50 → 'brand-dark', deduped
        expect(result.colors).toEqual(['brand-dark']);
    });

    it('extracts spacing tokens', () => {
        const css = `
@theme {
    --spacing-xl: 3rem;
    --spacing-2xs: 0.25rem;
}
`;
        const result = parseThemeBlocks(css);
        expect(result.spacings).toEqual(['2xs', 'xl']);
    });

    it('extracts font tokens', () => {
        const css = `
@theme {
    --font-display: "Playfair Display", serif;
    --font-body: "Inter", sans-serif;
}
`;
        const result = parseThemeBlocks(css);
        expect(result.fonts).toEqual(['body', 'display']);
    });

    it('extracts radius tokens', () => {
        const css = `
@theme {
    --radius-button: 0.375rem;
    --radius-card: 1rem;
}
`;
        const result = parseThemeBlocks(css);
        expect(result.radii).toEqual(['button', 'card']);
    });

    it('extracts shadow tokens', () => {
        const css = `
@theme {
    --shadow-card: 0 4px 12px rgb(0 0 0 / 0.1);
}
`;
        const result = parseThemeBlocks(css);
        expect(result.shadows).toEqual(['card']);
    });

    it('handles multiple @theme blocks', () => {
        const css = `
@theme {
    --color-brand: #f00;
}
/* some other rules */
@theme {
    --color-accent: #0f0;
    --spacing-xl: 3rem;
}
`;
        const result = parseThemeBlocks(css);
        expect(result.colors).toEqual(['accent', 'brand']);
        expect(result.spacings).toEqual(['xl']);
    });

    it('handles @theme inline { } syntax', () => {
        const css = `
@theme inline {
    --color-primary: #007bff;
}
`;
        const result = parseThemeBlocks(css);
        expect(result.colors).toEqual(['primary']);
    });

    it('handles @theme inside @layer', () => {
        const css = `
@layer base {
    @theme {
        --color-brand: #ff0000;
    }
}
`;
        const result = parseThemeBlocks(css);
        expect(result.colors).toEqual(['brand']);
    });

    it('ignores unknown CSS custom properties', () => {
        const css = `
@theme {
    --my-custom-thing: 42px;
    --animation-speed: 0.3s;
    --color-brand: #f00;
}
`;
        const result = parseThemeBlocks(css);
        expect(result.colors).toEqual(['brand']);
        expect(result.spacings).toEqual([]);
        expect(result.fonts).toEqual([]);
    });

    it('returns tokens sorted alphabetically', () => {
        const css = `
@theme {
    --color-zinc: #71717a;
    --color-amber: #f59e0b;
    --color-brand: #ff0000;
}
`;
        const result = parseThemeBlocks(css);
        expect(result.colors).toEqual(['amber', 'brand', 'zinc']);
    });

    it('deduplicates tokens within the same block', () => {
        const css = `
@theme {
    --color-brand-100: #ffe0d0;
    --color-brand-200: #ffc1a1;
    --color-brand-500: #ff6600;
}
`;
        const result = parseThemeBlocks(css);
        expect(result.colors).toEqual(['brand']);
    });
});

describe('mergeThemes', () => {
    it('returns empty theme for empty array', () => {
        const result = mergeThemes([]);
        expect(result.colors).toEqual([]);
        expect(result.spacings).toEqual([]);
    });

    it('merges tokens from multiple themes', () => {
        const a = { colors: ['brand'], spacings: ['xl'], fonts: [], radii: [], shadows: [] };
        const b = {
            colors: ['accent'],
            spacings: ['xl'],
            fonts: ['display'],
            radii: [],
            shadows: [],
        };
        const result = mergeThemes([a, b]);
        expect(result.colors).toEqual(['accent', 'brand']);
        expect(result.spacings).toEqual(['xl']); // deduped
        expect(result.fonts).toEqual(['display']);
    });

    it('returns sorted output after merge', () => {
        const a = {
            colors: ['z-color', 'a-color'],
            spacings: [],
            fonts: [],
            radii: [],
            shadows: [],
        };
        const b = { colors: ['m-color'], spacings: [], fonts: [], radii: [], shadows: [] };
        const result = mergeThemes([a, b]);
        expect(result.colors).toEqual(['a-color', 'm-color', 'z-color']);
    });
});

describe('hasTokens', () => {
    it('returns false for empty theme', () => {
        expect(hasTokens({ colors: [], spacings: [], fonts: [], radii: [], shadows: [] })).toBe(
            false,
        );
    });

    it('returns true when any category has tokens', () => {
        expect(
            hasTokens({ colors: ['brand'], spacings: [], fonts: [], radii: [], shadows: [] }),
        ).toBe(true);
        expect(
            hasTokens({ colors: [], spacings: [], fonts: [], radii: [], shadows: ['card'] }),
        ).toBe(true);
    });
});
