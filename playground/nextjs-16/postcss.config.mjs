// The cross-module lane runs its own Next process and must see only the
// safelist its route owns, so nothing another lane rewrites can move it. Every
// other lane gets the plugin's defaults: the prebuild file and the Turbopack
// loader file.
const xmodLane = process.env.CSSZYX_NEXT16_TURBO_XMOD === '1';

/** @type {import('postcss-load-config').Config} */
const config = {
    plugins: {
        // Points Tailwind at the csszyx safelists; must run before Tailwind.
        '@csszyx/unplugin/postcss': xmodLane
            ? { safelistFiles: ['.csszyx/xmod/classes.html'] }
            : {},
        '@tailwindcss/postcss': {},
    },
};

export default config;
