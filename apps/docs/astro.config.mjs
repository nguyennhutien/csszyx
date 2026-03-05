import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import csszyx from 'csszyx/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    integrations: [
        react(),
        starlight({
            title: 'CSSzyx',
            components: {
                SiteTitle: './src/components/overrides/SiteTitle.astro',
                Head: './src/components/overrides/Head.astro',
            },
            customCss: ['./src/styles/design-system.css'],
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
                        { label: 'Introduction', slug: 'guide/introduction' },
                        { label: 'Installation', slug: 'guide/installation' },
                        { label: 'Sz Props Basics', slug: 'guide/sz-props' },
                        { label: 'Variants & Modifiers', slug: 'guide/variants' },
                        { label: 'SSR & Hydration', slug: 'guide/ssr' },
                    ],
                },
                {
                    label: 'Props Reference',
                    items: [
                        { label: 'Layout', slug: 'reference/layout' },
                        { label: 'Spacing', slug: 'reference/spacing' },
                        { label: 'Sizing', slug: 'reference/sizing' },
                        { label: 'Typography', slug: 'reference/typography' },
                        { label: 'Backgrounds', slug: 'reference/backgrounds' },
                        { label: 'Borders', slug: 'reference/borders' },
                        { label: 'Effects & Filters', slug: 'reference/effects' },
                        { label: 'Transforms', slug: 'reference/transforms' },
                        { label: 'Transitions & Animation', slug: 'reference/transitions' },
                        { label: 'Interactivity', slug: 'reference/interactivity' },
                        { label: 'Flexbox & Grid', slug: 'reference/flex-grid' },
                        { label: 'Tables, SVG & Misc', slug: 'reference/misc' },
                    ],
                },
                {
                    label: 'API Reference',
                    items: [
                        { label: 'Runtime Helpers', slug: 'reference/runtime' },
                        { label: 'Plugin Config', slug: 'reference/config' },
                        { label: 'SSR Hydration API', slug: 'reference/hydration' },
                    ],
                },
            ],
        }),
    ],
    vite: {
        plugins: [
            // csszyx MUST come before tailwindcss.
            ...csszyx({ production: { mangle: true } }),
            tailwindcss(),
        ],
    },
});
