import solidJs from '@astrojs/solid-js';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import csszyx from 'csszyx/vite';

export default defineConfig({
    integrations: [solidJs()],
    vite: {
        plugins: [
            // csszyx must run before Tailwind so generated utility classes are visible.
            csszyx({ build: { parser: process.env.CSSZYX_PARSER ?? 'oxc' } }),
            tailwindcss(),
        ],
    },
});
