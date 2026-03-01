import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
    integrations: [
        starlight({
            title: 'CSSzyx',
            logo: {
                src: './src/assets/logo.svg',
                alt: 'CSSzyx',
                replacesTitle: true,
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
                    autogenerate: { directory: 'guide' },
                },
                {
                    label: 'Reference',
                    autogenerate: { directory: 'reference' },
                },
            ],
        }),
    ],
});
