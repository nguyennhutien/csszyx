/**
 * The `/e/` page gate, run on small built sites made for each case.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pageIds, pageProblems } from './check-diagnostic-pages.mjs';

/**
 * The heading a built page holds.
 *
 * @param {string} name - The page's file name.
 * @returns {string} Its heading.
 */
const headingOf = name =>
    name === '404.html'
        ? '<h1>Unknown code</h1>'
        : `<h1><code>${name.slice(0, -'.html'.length)}</code></h1>`;

/**
 * A built site holding the given pages under `e/`, each with its heading.
 *
 * @param {string[]} names - File names to create.
 * @returns {string} The site's directory.
 */
function site(names) {
    const dist = mkdtempSync(path.join(tmpdir(), 'csszyx-e-pages-'));
    mkdirSync(path.join(dist, 'e'));
    for (const name of names) writeFileSync(path.join(dist, 'e', name), headingOf(name));
    return dist;
}

/** Every page the gate wants. */
const complete = () => [...pageIds().map(id => `${id}.html`), '404.html'];

test('a site with every page passes', () => {
    const dist = site(complete());
    assert.deepEqual(pageProblems(dist), []);
    rmSync(dist, { recursive: true });
});

test('wants a page for every live id but not for an old upper-case code', () => {
    assert.ok(pageIds().includes('other'));
    assert.ok(!pageIds().includes('CSSZYX_NATIVE_UNAVAILABLE'));
});

test('names a missing code page and a missing 404 page', () => {
    const dist = site(
        complete().filter(name => name !== 'unknown-key.html' && name !== '404.html'),
    );
    assert.deepEqual(pageProblems(dist), ['no page e/unknown-key.html', 'no page e/404.html']);
    rmSync(dist, { recursive: true });
});

test('rejects an empty page and a page holding another code', () => {
    const dist = site(complete());
    writeFileSync(path.join(dist, 'e', 'unknown-key.html'), '');
    writeFileSync(path.join(dist, 'e', '404.html'), headingOf('canonical-key.html'));
    assert.deepEqual(pageProblems(dist), [
        'e/unknown-key.html does not hold <h1><code>unknown-key</code></h1>',
        'e/404.html does not hold <h1>Unknown code</h1>',
    ]);
    rmSync(dist, { recursive: true });
});

test('rejects a code page built as a directory', () => {
    const dist = site(complete());
    mkdirSync(path.join(dist, 'e', 'unknown-key'));
    assert.deepEqual(pageProblems(dist), [
        'e/unknown-key/ is a directory; a code page is one flat file',
    ]);
    rmSync(dist, { recursive: true });
});

test('reports a site with no e/ directory at all', () => {
    const dist = mkdtempSync(path.join(tmpdir(), 'csszyx-e-pages-'));
    assert.deepEqual(pageProblems(dist), [`${path.join(dist, 'e')} does not exist`]);
    rmSync(dist, { recursive: true });
});
