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
import { existsSync, readdirSync, statSync } from 'node:fs';
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
        if (!existsSync(path.join(dir, `${id}.html`))) problems.push(`no page e/${id}.html`);
    }
    if (!existsSync(path.join(dir, '404.html'))) problems.push('no page e/404.html');
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
