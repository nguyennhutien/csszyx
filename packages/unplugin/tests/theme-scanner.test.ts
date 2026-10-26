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
        expect(result.breakpoints).toEqual([]);
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

    it('extracts tokens from @theme with option keywords (static, reference, combos)', () => {
        // Tailwind v4 option keywords after @theme must not hide the block:
        // only matching `inline` silently dropped `@theme static` palettes
        // from the szcn groups (vui report finding 7).
        const variants = [
            '@theme static { --color-danger: red; --color-salmon-a-400: pink; }',
            '@theme inline static { --color-danger: red; --color-salmon-a-400: pink; }',
            '@theme reference { --color-danger: red; --color-salmon-a-400: pink; }',
        ];
        for (const css of variants) {
            expect(parseThemeBlocks(css).colors, css).toEqual(['danger', 'salmon-a-400']);
        }
    });

    it('does not treat @themes or other at-rules as a theme block', () => {
        expect(parseThemeBlocks('@themes { --color-decoy: red; }').colors).toEqual([]);
    });

    it('ignores unterminated theme preludes and blocks', () => {
        expect(parseThemeBlocks('@theme static').colors).toEqual([]);
        expect(parseThemeBlocks('@theme { --color-decoy: red;').colors).toEqual([]);
    });

    it('keeps a shade, which is part of the class Tailwind serves', () => {
        // `--color-brand-500` is served as `bg-brand-500`; `bg-brand` styles
        // nothing, so the token is the whole name.
        const css = `
@theme {
    --color-brand-50: #fff8f0;
    --color-brand-500: #ff6600;
    --color-sky-a-400: oklch(72.08% 0.1632 239.291);
}
`;
        expect(parseThemeBlocks(css).colors).toEqual(['brand-50', 'brand-500', 'sky-a-400']);
    });

    it('reads every Tailwind namespace, the longer prefix first', () => {
        const css = `
@theme {
    --animate-bulk-edit-actions-in: bulk-edit-actions-in 200ms ease-in-out;
    --ease-snappy: cubic-bezier(0.2, 0, 0, 1);
    --blur-soft: 6px;
    --drop-shadow-lift: 0 2px 4px #0003;
    --inset-shadow-well: inset 0 1px #0002;
    --text-shadow-glow: 0 0 4px #fff;
    --text-huge: 4rem;
    --tracking-loose: 0.1em;
    --leading-airy: 2;
    --perspective-deep: 2000px;
    --container-card: 24rem;
    --aspect-poster: 2 / 3;
    @keyframes bulk-edit-actions-in { from { transform: translateY(-100%); } }
}
`;
        const result = parseThemeBlocks(css);
        expect(result.animations).toEqual(['bulk-edit-actions-in']);
        expect(result.easings).toEqual(['snappy']);
        expect(result.blurs).toEqual(['soft']);
        expect(result.dropShadows).toEqual(['lift']);
        expect(result.insetShadows).toEqual(['well']);
        expect(result.textShadows).toEqual(['glow']);
        expect(result.textSizes).toEqual(['huge']);
        expect(result.trackings).toEqual(['loose']);
        expect(result.leadings).toEqual(['airy']);
        expect(result.perspectives).toEqual(['deep']);
        expect(result.containers).toEqual(['card']);
        expect(result.aspects).toEqual(['poster']);
        expect(result.shadows).toEqual([]);
    });

    it('leaves out the companion variable of a token, which is no class', () => {
        // `--text-xl--line-height` is the line height `text-xl` sets with it.
        const css = `
@theme {
    --text-xl: 1.25rem;
    --text-xl--line-height: 1.75rem;
    --font-display--font-feature-settings: "ss01";
}
`;
        const result = parseThemeBlocks(css);
        expect(result.textSizes).toEqual(['xl']);
        expect(result.fonts).toEqual([]);
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

    it('extracts custom breakpoint tokens', () => {
        const css = `
@theme {
    --breakpoint-tablet: 40rem;
    --breakpoint-3xl: 120rem;
}
`;
        const result = parseThemeBlocks(css);
        expect(result.breakpoints).toEqual(['3xl', 'tablet']);
    });

    it('keeps full breakpoint names without shade-stripping', () => {
        const css = `
@theme {
    --breakpoint-2xl: 96rem;
    --breakpoint-desktop: 80rem;
}
`;
        const result = parseThemeBlocks(css);
        // Breakpoint names are literal — the numeric-shade collapse must not apply.
        expect(result.breakpoints).toEqual(['2xl', 'desktop']);
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
    --color-brand-500: #ffe0d0;
    --color-brand-500: #ff6600;
}
`;
        const result = parseThemeBlocks(css);
        expect(result.colors).toEqual(['brand-500']);
    });
});

describe('mergeThemes', () => {
    it('returns empty theme for empty array', () => {
        const result = mergeThemes([]);
        expect(result.colors).toEqual([]);
        expect(result.spacings).toEqual([]);
    });

    it('merges tokens from multiple themes', () => {
        const a = {
            colors: ['brand'],
            spacings: ['xl'],
            fonts: [],
            textSizes: [],
            fontWeights: [],
            radii: [],
            shadows: [],
            breakpoints: ['tablet'],
        };
        const b = {
            colors: ['accent'],
            spacings: ['xl'],
            fonts: ['display'],
            textSizes: [],
            fontWeights: [],
            radii: [],
            shadows: [],
            breakpoints: ['desktop'],
        };
        const result = mergeThemes([a, b]);
        expect(result.colors).toEqual(['accent', 'brand']);
        expect(result.spacings).toEqual(['xl']); // deduped
        expect(result.fonts).toEqual(['display']);
        expect(result.breakpoints).toEqual(['desktop', 'tablet']);
    });

    it('returns sorted output after merge', () => {
        const a = {
            colors: ['z-color', 'a-color'],
            spacings: [],
            fonts: [],
            textSizes: [],
            fontWeights: [],
            radii: [],
            shadows: [],
            breakpoints: [],
        };
        const b = {
            colors: ['m-color'],
            spacings: [],
            fonts: [],
            textSizes: [],
            fontWeights: [],
            radii: [],
            shadows: [],
            breakpoints: [],
        };
        const result = mergeThemes([a, b]);
        expect(result.colors).toEqual(['a-color', 'm-color', 'z-color']);
    });
});

describe('hasTokens', () => {
    it('returns false for empty theme', () => {
        expect(
            hasTokens({
                colors: [],
                spacings: [],
                fonts: [],
                textSizes: [],
                fontWeights: [],
                radii: [],
                shadows: [],
                breakpoints: [],
            }),
        ).toBe(false);
    });

    it('returns true when any category has tokens', () => {
        expect(
            hasTokens({
                colors: ['brand'],
                spacings: [],
                fonts: [],
                textSizes: [],
                fontWeights: [],
                radii: [],
                shadows: [],
                breakpoints: [],
            }),
        ).toBe(true);
        expect(
            hasTokens({
                colors: [],
                spacings: [],
                fonts: [],
                textSizes: [],
                fontWeights: [],
                radii: [],
                shadows: [],
                breakpoints: ['tablet'],
            }),
        ).toBe(true);
    });
});

describe('szcn merge-group namespaces (--text-*, --font-weight-*)', () => {
    it('routes font-weight tokens to fontWeights, not font families', () => {
        // Ordering trap: `font-weight-` must match BEFORE `font-` — startsWith
        // would otherwise file `font-weight-chunky` under FAMILIES as the
        // garbage token "weight-chunky".
        const theme = parseThemeBlocks(`
            @theme {
                --font-display: 'Inter', sans-serif;
                --font-weight-chunky: 900;
                --text-huge: 4rem;
                --color-brand: oklch(0.7 0.1 250);
            }
        `);
        expect(theme.fonts).toEqual(['display']);
        expect(theme.fontWeights).toEqual(['chunky']);
        expect(theme.textSizes).toEqual(['huge']);
        expect(theme.colors).toEqual(['brand']);
    });

    it('numeric font-weight token names survive (no shade collapse)', () => {
        const theme = parseThemeBlocks('@theme { --font-weight-450: 450; }');
        expect(theme.fontWeights).toEqual(['450']);
    });
});
