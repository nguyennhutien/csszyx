import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import { defineConfig, fontProviders } from 'astro/config';
import csszyx from 'csszyx/vite';
import tailwindcss from '@tailwindcss/vite';
import csszyxDarkTheme from './src/themes/csszyx-dark.json' with { type: 'json' };
import csszyxLightTheme from './src/themes/csszyx-light.json' with { type: 'json' };
import ecTwoslash from 'expressive-code-twoslash';

const docsLandingGlobalVarTokens = [
    '--lp-border',
    '--lp-surface',
    '--lp-text',
    '--lp-text-muted',
];

export default defineConfig({
    site: 'https://csszyx.com',
    redirects: {
        '/docs': '/docs/introduction',
    },
    fonts: [
        {
            provider: fontProviders.google(),
            name: 'IBM Plex Sans',
            cssVariable: '--font-ibm-plex-sans',
            weights: [300, 400, 500, 600, 700],
            styles: ['normal', 'italic'],
        },
        {
            provider: fontProviders.google(),
            name: 'JetBrains Mono',
            cssVariable: '--font-jetbrains-mono',
            weights: [400, 500, 600, 700],
            styles: ['normal', 'italic'],
        },
        {
            provider: fontProviders.google(),
            name: 'Geist Mono',
            cssVariable: '--font-geist-mono',
            weights: [400, 500, 600, 700],
            styles: ['normal'],
        },
    ],
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
                        { label: 'Migrate from Tailwind', slug: 'docs/migrate' },
                        { label: 'Sz Props Basics', slug: 'docs/sz-props' },
                        { label: 'Variants & Modifiers', slug: 'docs/variants' },
                        { label: 'SSR & Hydration', slug: 'docs/ssr' },
                    ],
                },
                {
                    label: 'Guides',
                    items: [
                        { label: 'Reusing Styles', slug: 'docs/reusing-styles' },
                        { label: 'Component Variants (szv)', slug: 'docs/szv' },
                        { label: 'Runtime Injection', slug: 'docs/dynamic' },
                        { label: 'CDN — Vanilla HTML', slug: 'docs/cdn-html' },
                        { label: 'MCP Server', slug: 'docs/mcp-server' },
                        { label: 'VS Code Extension', slug: 'docs/vscode' },
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
                                            tokens: docsLandingGlobalVarTokens,
                                        }
                                    : undefined,
                        },
                        build: { scanCss: 'src/styles/landing.css' },
                    })),
            ...(process.env.CSSZYX_BENCH_NO_TAILWIND === '1' ? [] : [tailwindcss()]),
        ],
    },
});
