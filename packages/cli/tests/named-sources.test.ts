/**
 * What a stylesheet's `@source` adds to a command's default read.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { namedSourcesToAdd } from '../src/scanner/named-sources.js';
import { withPosixSeparators } from '../src/utils/posix-path.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The repository's oxide, which carries the Scanner. */
const OXIDE = realpathSync(join(import.meta.dirname, '../../../node_modules/@tailwindcss/oxide'));

/**
 * A project with the repository's Scanner and a gitignored folder.
 *
 * @param folder - The gitignored folder, with one component in it.
 * @returns The project root, as its real path.
 */
function scannedProject(folder: string): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-named-sources-')));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), '{"name":"app","private":true}\n');
    writeFileSync(join(root, '.gitignore'), `${folder}/\n`);
    mkdirSync(join(root, folder));
    writeFileSync(join(root, folder, 'Badge.tsx'), 'export const B = () => null;\n');
    mkdirSync(join(root, 'node_modules/@tailwindcss'), { recursive: true });
    symlinkSync(OXIDE, join(root, 'node_modules/@tailwindcss/oxide'), 'dir');
    return root;
}

/**
 * What a command adds for one rule naming a folder.
 *
 * @param root - The project root, as the command was given it.
 * @param folder - The folder the rule names.
 * @returns The added files.
 */
const addedFor = (root: string, folder: string): string[] | null =>
    namedSourcesToAdd(root, [[{ base: root, pattern: folder, negated: false }]], {
        root,
        have: new Set(),
        ignore: [],
        extensions: new Set(['.tsx']),
    });

describe('namedSourcesToAdd', () => {
    it('adds what a rule names when the root is reached through a link', () => {
        const root = scannedProject('gen');
        const link = `${root}-link`;
        symlinkSync(root, link, 'dir');
        roots.push(link);
        expect(addedFor(link, 'gen')).toEqual([withPosixSeparators(join(link, 'gen/Badge.tsx'))]);
    });

    it('adds a file under a folder whose name starts with two dots', () => {
        const root = scannedProject('..gen');
        expect(addedFor(root, '..gen')).toEqual([
            withPosixSeparators(join(root, '..gen/Badge.tsx')),
        ]);
    });

    it('answers null when the project has no Scanner to list a rule', () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-named-sources-')));
        roots.push(root);
        writeFileSync(join(root, 'package.json'), '{"name":"app","private":true}\n');
        mkdirSync(join(root, 'gen'));
        writeFileSync(join(root, 'gen/Badge.tsx'), 'export const B = () => null;\n');
        const added = namedSourcesToAdd(root, [[{ base: root, pattern: 'gen', negated: false }]], {
            root,
            have: new Set(),
            ignore: [],
            extensions: new Set(['.tsx']),
        });
        expect(added).toBeNull();
    });
});
