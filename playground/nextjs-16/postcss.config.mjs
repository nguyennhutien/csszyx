// The cross-module lane runs its own Next process and must see only the
// safelist its route owns, so nothing another lane rewrites can move it.
//
// Every other lane names its files explicitly too: the plugin's default is
// the one file csszyx writes when nothing says otherwise, and the Turbopack
// lanes here pass `--output-file` / `safelistOutputFile` so several lanes can
// share one checkout. Left at the default, the loader lane's classes would
// only reach Tailwind through the safelist the webpack lane happens to write
// into the shared default file, which is not the wiring under test.
const xmodLane = process.env.CSSZYX_NEXT16_TURBO_XMOD === '1';

/** @type {import('postcss-load-config').Config} */
const config = {
    plugins: {
        // Points Tailwind at the csszyx safelists; must run before Tailwind.
        '@csszyx/unplugin/postcss': xmodLane
            ? { safelistFiles: ['.csszyx/xmod/classes.txt'] }
            : { safelistFiles: ['.csszyx/csszyx-classes.txt', '.csszyx/next-loader-classes.txt'] },
        '@tailwindcss/postcss': {},
    },
};

export default config;
