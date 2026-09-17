/**
 * Where Tailwind's Scanner looks, built the way its integrations build it.
 *
 * `@tailwindcss/postcss` 4.3.3 hands its Scanner nothing for `source(none)`,
 * the whole base for an import with no `source(...)`, the named path
 * otherwise, then every `@source` rule. The census the merge table is built
 * from has to read the same files, or a class Tailwind generated CSS for
 * would have no entry.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadCandidateScanner, scanSourcesOf } from '../src/candidate-scanner.js';

const created: string[] = [];
afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('scanSourcesOf', () => {
    const rule = { base: '/app/styles', pattern: '../lib', negated: false };

    it('scans only the @source rules under source(none)', () => {
        expect(scanSourcesOf({ root: 'none', sources: [rule] }, '/app')).toEqual([rule]);
    });

    it('scans the whole project when the import names no source', () => {
        expect(scanSourcesOf({ root: null, sources: [] }, '/app')).toEqual([
            { base: '/app', pattern: '**/*', negated: false },
        ]);
    });

    it('scans the named path, then the rules', () => {
        const negated = { base: '/app/styles', pattern: './legacy', negated: true };
        expect(
            scanSourcesOf(
                { root: { base: '/app/styles', pattern: '../src' }, sources: [negated] },
                '/app',
            ),
        ).toEqual([{ base: '/app/styles', pattern: '../src', negated: false }, negated]);
    });
});

describe('loadCandidateScanner', () => {
    it('answers null for a project with no Tailwind integration to load it from', () => {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-no-scanner-'));
        created.push(dir);
        expect(loadCandidateScanner(dir)).toBeNull();
    });

    it('answers null for an oxide that predates the Scanner', () => {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-old-oxide-'));
        created.push(dir);
        writeFileSync(join(dir, 'package.json'), '{ "name": "app" }\n');
        const oxide = join(dir, 'node_modules/@tailwindcss/oxide');
        mkdirSync(oxide, { recursive: true });
        writeFileSync(
            join(oxide, 'package.json'),
            '{ "name": "@tailwindcss/oxide", "main": "index.js" }\n',
        );
        writeFileSync(join(oxide, 'index.js'), 'module.exports = {};\n');

        expect(loadCandidateScanner(dir)).toBeNull();
    });
});
