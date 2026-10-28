/**
 * `classNameToSzObject` takes the project's Tailwind answers the way the
 * `migrate` command does, and says which classes a table decided unasked.
 *
 * A few of migrate's refusals read csszyx's own tables (a sign on a keyword,
 * a fraction on a key); the project's Tailwind is the authority on whether a
 * class is served, so the programmatic call and the MCP `reverse` tool need
 * the same two-pass shape the command has: convert, ask about the classes the
 * tables decided, convert again with the answers.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { classNameToSzObject } from '../src/migrate.js';
import { askProjectTailwind } from '../src/scanner/project-answers.js';

/**
 * A project root whose stylesheet imports Tailwind, with `body` after it.
 *
 * @param body - Extra stylesheet text; null for a root with no stylesheet.
 * @returns The root; the caller removes it.
 */
function project(body: string | null): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-cli-answers-'));
    if (body === null) return root;
    // This package's own `tailwindcss` is v3, for the v3 lane; the oracle
    // package carries the v4 the project needs.
    const oracle = fileURLToPath(new URL('../../tailwind-oracle/package.json', import.meta.url));
    const tailwind = dirname(createRequire(oracle).resolve('tailwindcss/package.json'));
    mkdirSync(join(root, 'node_modules'));
    symlinkSync(tailwind, join(root, 'node_modules', 'tailwindcss'), 'dir');
    writeFileSync(join(root, 'package.json'), '{ "name": "p", "private": true }');
    writeFileSync(join(root, 'app.css'), `@import "tailwindcss";\n${body}\n`);
    return root;
}

describe('classNameToSzObject with the project answers', () => {
    it('names the classes a table decided, with the table verdict', () => {
        expect(classNameToSzObject('p-4 -z-auto')).toEqual({
            szObject: { p: 4 },
            unrecognized: ['-z-auto'],
            keepInClassName: [],
            tableVerdicts: [{ class: '-z-auto', served: false }],
        });
    });

    it('takes the project answer over the table, and leaves nothing to ask', () => {
        expect(
            classNameToSzObject('p-4 -z-auto', { served: new Map([['-z-auto', true]]) }),
        ).toEqual({ szObject: { p: 4, z: '-auto' }, unrecognized: [], keepInClassName: [] });
    });

    it('keeps a class the table took when the project does not serve it', () => {
        expect(classNameToSzObject('w-1/2', { served: new Map([['w-1/2', false]]) })).toEqual({
            szObject: {},
            unrecognized: ['w-1/2'],
            keepInClassName: [],
        });
    });
});

describe('askProjectTailwind', () => {
    const asked = classNameToSzObject('p-4 -m-1/2').tableVerdicts;

    it("returns the answers when the project's Tailwind disagrees with a table", async () => {
        const root = project('@theme { --spacing-1\\/2: 0.5rem; }');
        try {
            const served = await askProjectTailwind(root, asked);
            expect(served).toEqual(new Map([['-m-1/2', true]]));
            expect(
                classNameToSzObject('p-4 -m-1/2', { served: served ?? undefined }).szObject,
            ).toEqual({
                p: 4,
                m: '-1/2',
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('returns null when the project agrees with every table', async () => {
        const root = project('');
        try {
            expect(await askProjectTailwind(root, asked)).toBeNull();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('returns null when there is no Tailwind v4 to ask, or nothing to ask about', async () => {
        const root = project(null);
        try {
            expect(await askProjectTailwind(root, asked)).toBeNull();
            expect(await askProjectTailwind(root, undefined)).toBeNull();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
