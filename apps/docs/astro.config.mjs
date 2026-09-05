import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import { defineConfig, fontProviders } from 'astro/config';
import csszyx from 'csszyx/vite';
import tailwindcss from '@tailwindcss/vite';
import csszyxDarkTheme from './src/themes/csszyx-dark.json' with { type: 'json' };
import csszyxLightTheme from './src/themes/csszyx-light.json' with { type: 'json' };
import ecTwoslash from 'expressive-code-twoslash';
import remarkGfm from 'remark-gfm';

/**
 * The three families this site sets, served from `src/assets/fonts`.
 *
 * They used to come from `fontProviders.google()`, which made every build
 * anywhere depend on fonts.gstatic.com answering. It stopped answering five
 * times in three days — always HTTP 404, across all three families and both CI
 * systems. The cause is not a flaky network: Astro caches the resolved gstatic
 * URL for about two days and does not re-resolve inside that window, so when
 * Google rotates a file the cached URL is simply gone. A build that fetches in
 * that gap cannot succeed, and no amount of caching on our side fixes it —
 * caching the resolved URL is what extends the exposure.
 *
 * The files are the exact bytes that build already shipped, so this removes the
 * network dependency without changing a glyph.
 */
const LOCAL_FAMILIES = [
    {
        name: 'IBM Plex Sans',
        cssVariable: '--font-ibm-plex-sans',
        weights: [300, 400, 500, 600, 700],
        styles: ['normal', 'italic'],
    },
    {
        name: 'JetBrains Mono',
        cssVariable: '--font-jetbrains-mono',
        weights: [400, 500, 600, 700],
        styles: ['normal', 'italic'],
    },
    {
        name: 'Geist Mono',
        cssVariable: '--font-geist-mono',
        weights: [400, 500, 600, 700],
        styles: ['normal'],
    },
];

/**
 * The `unicode-range` Google served for the latin subset.
 *
 * Carried verbatim rather than omitted: without it the browser downloads the
 * face for any text at all, including scripts these files do not cover.
 */
const LATIN_SUBSET = [
    'U+0000-00FF',
    'U+0131',
    'U+0152-0153',
    'U+02BB-02BC',
    'U+02C6',
    'U+02DA',
    'U+02DC',
    'U+0304',
    'U+0308',
    'U+0329',
    'U+2000-206F',
    'U+20AC',
    'U+2122',
    'U+2191',
    'U+2193',
    'U+2212',
    'U+2215',
    'U+FEFF',
    'U+FFFD',
];

/**
 * Vendored file for one family and style.
 *
 * Each style is ONE variable font covering the whole weight range, which is
 * why five files serve twenty-two faces.
 *
 * @param {string} name - Family name as declared above.
 * @param {string} style - `normal` or `italic`.
 * @returns {string} Filename under `src/assets/fonts`.
 */
function fontFile(name, style) {
    return `${name.toLowerCase().replaceAll(' ', '-')}-latin-${style}.woff2`;
}

/**
 * Styles ordered so the fallback metrics come out unchanged.
 *
 * Astro derives the `size-adjust` and `*-override` values of the Arial
 * fallback from whichever variant it measures FIRST for a family — the metrics
 * cache is keyed by family name — and Google's response happened to list
 * italic first. Emitting in that same order keeps those numbers identical to
 * the fetched build, which is what makes this change provably invisible.
 *
 * Measured: with `normal` first, IBM Plex Sans shifts from `size-adjust`
 * 99.5961% to 101.1663%. That is a real difference in how the page is laid out
 * before the webfont paints, and picking the better face for it is a CLS
 * decision on its own merits — not something to change as a side effect of
 * removing a network dependency.
 *
 * @param {Array<string>} styles - Styles declared for the family.
 * @returns {Array<string>} The same styles, italic first.
 */
function inMeasurementOrder(styles) {
    return [...styles].sort((left, right) => Number(right === 'italic') - Number(left === 'italic'));
}

const docsLandingGlobalVarTokens = [
    '--lp-border',
    '--lp-surface',
    '--lp-text',
    '--lp-text-muted',
    '--trans-fast',
    '--trans-smooth',
];

export default defineConfig({
    site: 'https://csszyx.com',
    redirects: {
        '/docs': '/docs/introduction',
    },
    // GFM (tables, strikethrough, …) is not applied to .mdx by default in this
    // setup, so markdown tables rendered as raw `| --- |` text. Adding remark-gfm
    // here is inherited by the MDX pipeline (extendMarkdownConfig) and renders
    // tables for both .md and .mdx.
    markdown: {
        remarkPlugins: [remarkGfm],
    },
    fonts: LOCAL_FAMILIES.map(family => ({
        provider: fontProviders.local(),
        name: family.name,
        cssVariable: family.cssVariable,
        // Provider-specific config goes under `options`; `variants` is the
        // local provider's own shape, not a family-level key.
        options: {
            variants: inMeasurementOrder(family.styles).flatMap(style =>
                // One variant per weight rather than a `"300 700"` range:
                // Google served one variable file per style and Astro emitted a
                // separate @font-face for each declared weight. Keeping that
                // shape is what lets the generated CSS be diffed against the
                // fetched build and shown to be unchanged. A range would render
                // correctly too, but it would change the output and forfeit
                // that proof.
                family.weights.map(weight => ({
                    src: [`./src/assets/fonts/${fontFile(family.name, style)}`],
                    weight,
                    style,
                    unicodeRange: LATIN_SUBSET,
                })),
            ),
        },
    })),
    integrations: [
        react(),
        starlight({
            title: 'CSSzyx',
            favicon: '/csszyx-favicon.svg',
            components: {
                SiteTitle: './src/components/overrides/SiteTitle.astro',
                Head: './src/components/overrides/Head.astro',
            },
            customCss: ['./src/styles/design-system.css'],
            expressiveCode: {
                plugins: [ecTwoslash()],
                themes: [csszyxDarkTheme, csszyxLightTheme],
                styleOverrides: {
                    borderColor: '#ffffff0f',
                    frames: {
                        editorTabBarBackground: '#050505',
                        editorActiveTabForeground: '#E1E4E8',
                        editorActiveTabBackground: '#050505',
                        editorActiveTabBorderColor: 'transparent',
                        editorTabBarBorderBottomColor: '#25252f',
                        editorTabBorderRadius: '0px',
                        terminalBackground: '#050505',
                        terminalTitlebarBackground: '#050505',
                        terminalTitlebarBorderBottomColor: '#ffffff0f',
                    },
                    textMarkers: {
                        markBackground: 'rgba(45, 213, 151, 0.08)',
                        markBorderColor: 'rgba(45, 213, 151, 0.4)',
                    },
                },
            },
            social: [
                {
                    icon: 'github',
                    label: 'GitHub',
                    href: 'https://github.com/nguyennhutien/csszyx',
                },
            ],
            sidebar: [
                {
                    label: 'Getting Started',
                    items: [
                        { label: 'Introduction', slug: 'docs/introduction' },
                        { label: 'Installation', slug: 'docs/installation' },
                        { label: 'Monorepo & Content Scope', slug: 'docs/monorepo-content-scope' },
                        { label: 'Migrate from Tailwind', slug: 'docs/migrate' },
                        { label: 'Sz Props Basics', slug: 'docs/sz-props' },
                        { label: 'Variants & Modifiers', slug: 'docs/variants' },
                        { label: 'SSR & Hydration', slug: 'docs/ssr' },
                    ],
                },
                {
                    label: 'Guides',
                    items: [
                        { label: 'Build-Time vs Runtime', slug: 'docs/build-time-vs-runtime' },
                        { label: 'Benchmark a Real App', slug: 'docs/benchmarking' },
                        { label: 'Reusing Styles', slug: 'docs/reusing-styles' },
                        { label: 'Styling Component Parts', slug: 'docs/compound-components' },
                        { label: 'Box Model Routing', slug: 'docs/box-model-splitbox' },
                        { label: 'Component Variants (szv)', slug: 'docs/szv' },
                        { label: 'Runtime Injection', slug: 'docs/dynamic' },
                        { label: 'CDN — Vanilla HTML', slug: 'docs/cdn-html' },
                        { label: 'MCP Server', slug: 'docs/mcp-server' },
                        { label: 'TypeScript Autocomplete', slug: 'docs/typescript-plugin' },
                        { label: 'VS Code Extension', slug: 'docs/vscode' },
                        { label: 'Testing Components', slug: 'docs/testing' },
                    ],
                },
                {
                    label: 'Props Reference',
                    items: [
                        { label: 'Layout', slug: 'docs/reference/layout' },
                        { label: 'Spacing', slug: 'docs/reference/spacing' },
                        { label: 'Sizing', slug: 'docs/reference/sizing' },
                        { label: 'Typography', slug: 'docs/reference/typography' },
                        { label: 'Backgrounds', slug: 'docs/reference/backgrounds' },
                        { label: 'Borders', slug: 'docs/reference/borders' },
                        { label: 'Effects & Filters', slug: 'docs/reference/effects' },
                        { label: 'Transforms', slug: 'docs/reference/transforms' },
                        { label: 'Transitions & Animation', slug: 'docs/reference/transitions' },
                        { label: 'Interactivity', slug: 'docs/reference/interactivity' },
                        { label: 'Flexbox & Grid', slug: 'docs/reference/flex-grid' },
                        { label: 'Tables, SVG & Misc', slug: 'docs/reference/misc' },
                    ],
                },
                {
                    label: 'API Reference',
                    items: [
                        { label: 'Runtime Helpers', slug: 'docs/reference/runtime' },
                        { label: 'Plugin Config', slug: 'docs/reference/config' },
                        { label: 'Warnings & Troubleshooting', slug: 'docs/reference/warnings' },
                        { label: 'Global Variable Mangling', slug: 'docs/reference/global-var-mangling' },
                        { label: 'SSR Hydration API', slug: 'docs/reference/hydration' },
                    ],
                },
            ],
        }),
    ],
    vite: {
        resolve: {
            tsconfigPaths: false,
        },
        plugins: [
            // csszyx MUST come before tailwindcss.
            // CSSZYX_BENCH_NO_CSSZYX=1 skips the csszyx plugin entirely so the
            // pipeline-profile bench can measure a Tailwind-only baseline.
            // CSSZYX_BENCH_NO_TAILWIND=1 additionally skips the Tailwind plugin
            // so the bench can measure the Astro/Vite/React-only floor.
            // CSSZYX_BENCH_MANGLE_VARS=1 opts into CSS variable mangling for
            // output-size benches only. These are opt-in validation knobs and
            // are intentionally absent from normal production docs builds.
            // CSSZYX_BENCH_MANGLE_GLOBAL_VARS=1 opts into explicit g-tier
            // aliases for docs landing tokens so Phase H can validate a
            // real app without changing normal docs builds.
            ...(process.env.CSSZYX_BENCH_NO_CSSZYX === '1' ||
            process.env.CSSZYX_BENCH_NO_TAILWIND === '1'
                ? []
                : csszyx({
                        production: {
                            mangle: true,
                            mangleVars: process.env.CSSZYX_BENCH_MANGLE_VARS === '1',
                            mangleGlobalVars:
                                process.env.CSSZYX_BENCH_MANGLE_GLOBAL_VARS === '1'
                                    ? {
                                            enabled: true,
                                            emitMap:
                                                process.env
                                                    .CSSZYX_BENCH_NO_GLOBAL_VAR_MAP === '1'
                                                    ? false
                                                    : undefined,
                                            tokens: docsLandingGlobalVarTokens,
                                        }
                                    : undefined,
                        },
                        build: { parser: 'rust', scanCss: 'src/styles/landing.css' },
                    })),
            ...(process.env.CSSZYX_BENCH_NO_TAILWIND === '1' ? [] : [tailwindcss()]),
        ],
    },
});
