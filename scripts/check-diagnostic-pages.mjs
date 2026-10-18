#!/usr/bin/env node

/**
 * Every csszyx message links to `https://csszyx.com/e/<code>`, and a link
 * printed into a deployed app or an old log can never be taken back. This
 * checks a built docs site holds a page for every id the registry makes public,
 * as a flat `e/<code>.html` (Cloudflare Pages answers `/e/<code>` with it
 * directly; a directory `e/<code>/index.html` answers with a 308 first), plus
 * the `e/404.html` an unknown code gets.
 *
 * Usage: node scripts/check-diagnostic-pages.mjs <dist>
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { DIAGNOSTICS, REMOVED } from './diagnostics/registry.mjs';
import { ID_PATTERN } from './gen-diagnostic-codes.mjs';

/**
 * The ids that must have a page: every live id, and every removed id the URL
 * grammar fits.
 *
 * @returns {string[]} The ids.
 */
export function pageIds() {
    return [
        ...DIAGNOSTICS.map(entry => entry.id),
        ...REMOVED.filter(entry => ID_PATTERN.test(entry.id)).map(entry => entry.id),
    ];
}

/**
 * What is wrong with one page: missing, or built without its heading (an
 * empty file, or another page's content).
 *
 * @param {string} file - The page.
 * @param {string} heading - The heading it must hold.
 * @returns {string[]} At most one problem.
 */
function pageProblem(file, heading) {
    const name = `e/${path.basename(file)}`;
    if (!existsSync(file)) return [`no page ${name}`];
    if (!readFileSync(file, 'utf8').includes(heading)) return [`${name} does not hold ${heading}`];
    return [];
}

/**
 * What is wrong with a built site's `/e/` pages.
 *
 * @param {string} dist - The built site.
 * @returns {string[]} One problem per missing or misplaced page.
 */
export function pageProblems(dist) {
    const dir = path.join(dist, 'e');
    if (!existsSync(dir)) return [`${dir} does not exist`];
    const problems = [];
    for (const id of pageIds()) {
        problems.push(...pageProblem(path.join(dir, `${id}.html`), `<h1><code>${id}</code></h1>`));
    }
    problems.push(...pageProblem(path.join(dir, '404.html'), '<h1>Unknown code</h1>'));
    for (const name of readdirSync(dir)) {
        if (statSync(path.join(dir, name)).isDirectory()) {
            problems.push(`e/${name}/ is a directory; a code page is one flat file`);
        }
    }
    return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const problems = pageProblems(path.resolve(process.argv[2] ?? 'apps/docs/dist'));
    for (const problem of problems) console.error(`[check-diagnostic-pages] ${problem}`);
    process.exit(problems.length === 0 ? 0 : 1);
}
