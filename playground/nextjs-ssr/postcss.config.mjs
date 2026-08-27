/** @type {import('postcss-load-config').Config} */
const config = {
    plugins: {
        // Points Tailwind at the csszyx safelist; must run before Tailwind.
        '@csszyx/unplugin/postcss': {},
        '@tailwindcss/postcss': {},
    },
};

export default config;
