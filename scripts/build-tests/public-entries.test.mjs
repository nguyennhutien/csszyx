// Every entry a published package exports has one row on the Public API page,
// with a kind the page defines, so a new entry cannot ship without a decision.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PAGE = path.join(ROOT, 'apps/docs/src/content/docs/docs/reference/public-api.mdx');
const KINDS = new Set(['public', 'generated', 'internal']);

/** @returns {string[]} Every entry of every published package, as an importer writes it. */
function publishedEntries() {
    const entries = [];
    for (const dir of readdirSync(path.join(ROOT, 'packages'))) {
        let manifest;
        try {
            manifest = JSON.parse(
                readFileSync(path.join(ROOT, 'packages', dir, 'package.json'), 'utf8'),
            );
        } catch {
            continue;
        }
        // The platform packages carry the native binary for `@csszyx/core`.
        if (manifest.private || /^@csszyx\/core-/.test(manifest.name)) continue;
        const exported = manifest.exports;
        // An `exports` whose keys are conditions (`import`, `require`) and
        // not subpaths is the one entry `.`.
        const keys =
            exported === undefined || typeof exported === 'string' ? [] : Object.keys(exported);
        const subpaths = keys.some(key => key.startsWith('.'))
            ? keys.filter(key => key.startsWith('.') && !key.endsWith('package.json'))
            : ['.'];
        for (const subpath of subpaths) {
            entries.push(subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`);
        }
    }
    return entries.sort();
}

/** @returns {Map<string, string[]>} Each entry the page lists, with the kinds it gives it. */
function pageRows() {
    const rows = new Map();
    for (const [, entry, kind] of readFileSync(PAGE, 'utf8').matchAll(
        /^\| `([^`]+)` \| (\w+) \|/gm,
    )) {
        rows.set(entry, [...(rows.get(entry) ?? []), kind]);
    }
    return rows;
}

test('the Public API page lists every published entry once, with a kind it defines', () => {
    const rows = pageRows();
    for (const entry of publishedEntries()) {
        const kinds = rows.get(entry) ?? [];
        assert.equal(kinds.length, 1, `${entry} has ${kinds.length} rows on the Public API page`);
        assert.ok(KINDS.has(kinds[0]), `${entry} has the kind ${kinds[0]}`);
    }
});

test('the Public API page lists no entry a package does not export', () => {
    const published = new Set(publishedEntries());
    for (const entry of pageRows().keys()) {
        assert.ok(published.has(entry), `${entry} is listed but no package exports it`);
    }
});
