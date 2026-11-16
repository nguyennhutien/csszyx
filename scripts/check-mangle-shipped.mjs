import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Every app built in CI that sets `production.mangle: true` must ship what
 * mangling produces, through the channel its lane delivers the map by: the
 * census tag and the checksum on a page Vite writes, the map in the bundle on
 * a page the framework renders itself (Astro calls no `transformIndexHtml`, so
 * its pages carry no census and the hydration checksum does not run there;
 * `.agent` lane matrix). A lane can
 * drop mangling while every other check passes, and the size advisory says
 * nothing when no map shipped: `astro build` resolves the plugin as a dev
 * server first (content sync), and from the guard added on 2026-06-26 the
 * docs app shipped unmangled until 2026-11-16, its build green throughout.
 *
 * Read from the build output, so it holds whatever framework or bundler built
 * it. An app in the list whose output is missing fails too: a check that
 * passes on output nobody built would claim the lane works.
 */
export const MANGLING_APPS = [
    { app: 'apps/docs', lane: 'Astro', bundle: 'apps/docs/dist/_astro' },
    { app: 'playground/vite-react', lane: 'Vite', page: 'playground/vite-react/dist/index.html' },
];

/** The census tag; its JSON carries one `class:<name>` key per renamed class. */
const CENSUS =
    /<script id="__CSSZYX_MANGLE_MAP__" type="application\/json">([\s\S]*?)<\/script[^>]*>/i;

/** The checksum attribute, under its minified or its full name. */
const CHECKSUM = /\sdata-sz-(?:cs|checksum)="[0-9a-f]{16}"/;

/**
 * What a built page lacks of a mangled build.
 *
 * @param {string | null} html the page, or null when it was not built
 * @returns {string[]} the missing parts, empty when the page is mangled
 */
export function mangleShortfall(html) {
    if (html === null) return ['the page (not built)'];
    const missing = [];
    const census = CENSUS.exec(html)?.[1];
    if (census === undefined) missing.push('the `__CSSZYX_MANGLE_MAP__` census');
    else if (!census.includes('"class:')) missing.push('any class in the census');
    if (!CHECKSUM.test(html)) missing.push('the `data-sz-cs` checksum');
    return missing;
}

/** The runtime map in a built chunk, with at least one entry. */
const BUNDLED_MAP = /mangleMap:\{(?:"[^"]+"|[\w$]+):/;

/**
 * What a built bundle lacks of a mangled build.
 *
 * @param {string[] | null} chunks the JavaScript chunks, or null when none was built
 * @returns {string[]} the missing parts, empty when a chunk carries the map
 */
export function bundleShortfall(chunks) {
    if (chunks === null || chunks.length === 0) return ['the bundle (not built)'];
    return chunks.some(chunk => BUNDLED_MAP.test(chunk)) ? [] : ['a non-empty `mangleMap`'];
}

/**
 * Read the JavaScript chunks of one output folder.
 *
 * @param {string} dir the folder
 * @returns {string[] | null} their text, or null when the folder is missing
 */
function readChunks(dir) {
    if (!existsSync(dir)) return null;
    return readdirSync(dir)
        .filter(name => name.endsWith('.js'))
        .map(name => readFileSync(path.join(dir, name), 'utf8'));
}

function main() {
    const root = process.cwd();
    const problems = MANGLING_APPS.flatMap(({ app, lane, page, bundle }) => {
        const where = page ?? bundle;
        const file = path.join(root, where);
        const missing = page
            ? mangleShortfall(existsSync(file) ? readFileSync(file, 'utf8') : null)
            : bundleShortfall(readChunks(file));
        return missing.length === 0
            ? []
            : [`${app} (${lane}) sets production.mangle but ${where} lacks ${missing.join(', ')}`];
    });
    if (problems.length > 0) {
        throw new Error(`Mangle shipped check failed:\n- ${problems.join('\n- ')}`);
    }
    console.log(`Mangle shipped check passed (${MANGLING_APPS.length} apps).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
