/**
 * Leaving out of the table what no merge can use.
 *
 * With a census as wide as Tailwind's own scan, most classes a large app uses
 * share nothing with any other: `flex` covers only itself and nothing covers
 * it. Such a class merges exactly as a class with no entry does, since an
 * absent class still drops an exact repeat, so shipping it only costs bytes.
 * Measured on the docs app: 855 classes, 6,467 gzip bytes; 739 and 4,977 once
 * the unusable ones are left out.
 */
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { szcn } from '../../runtime/src/merge-classes.js';
import {
    __resetMergeSignaturesForTests,
    registerMergeSignatures,
} from '../../runtime/src/merge-signatures.js';
import { createMergeSignatureTable, type MergeSignature } from '../src/merge-signature.js';
import { openProjectStyleModel } from '../src/project-style-model.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    __resetMergeSignaturesForTests();
});

/**
 * A signature that sets the given properties at the root context.
 *
 * @param properties - Property names.
 * @returns The signature.
 */
function sets(...properties: string[]): MergeSignature {
    return { rules: [{ context: '[[],false]', properties }], important: false };
}

describe('the table leaves out what no merge can use', () => {
    const SIGNATURES: Record<string, MergeSignature> = {
        flex: sets('display'),
        'text-brand': sets('color'),
        'text-accent': sets('color'),
        'pb-2': sets('padding-bottom'),
        // Longhands, as the CSS reader expands them.
        'p-4': sets('padding-bottom', 'padding-left', 'padding-right', 'padding-top'),
    };

    it('keeps a class that shares its signature, covers or is covered', () => {
        const [ids] = createMergeSignatureTable(
            Object.keys(SIGNATURES),
            c => SIGNATURES[c] ?? null,
        );

        expect(Object.keys(ids).sort()).toEqual(['p-4', 'pb-2', 'text-accent', 'text-brand']);
    });

    it('numbers what it keeps densely, so every id has its row', () => {
        const [ids, coverage] = createMergeSignatureTable(
            Object.keys(SIGNATURES),
            c => SIGNATURES[c] ?? null,
        );

        const used = [...new Set(Object.values(ids))].sort((a, b) => a - b);
        expect(used).toEqual([...coverage.keys()]);
        for (const row of coverage) for (const id of row) expect(id).toBeLessThan(coverage.length);
    });

    it('merges every pair exactly as the full table does', async () => {
        const root = tailwindProject('csszyx-prune-', { 'app.css': '@import "tailwindcss";' });
        const model = await openProjectStyleModel(root, [join(root, 'app.css')]);
        const classes = [
            'flex',
            'block',
            'grid',
            'p-4',
            'pb-2',
            'px-2',
            'ps-2',
            'text-sm',
            'text-base',
            'text-red-500',
            'text-blue-500',
            'font-bold',
            'underline',
            'space-x-4',
            'space-x-reverse',
            'shadow-lg',
            'shadow-red-500',
            'sr-only',
            'truncate',
            'w-4',
        ];
        const signatureOf = (c: string) => model.signature(c);
        const full = createMergeSignatureTable(classes, signatureOf, { prune: false });
        const pruned = createMergeSignatureTable(classes, signatureOf);
        expect(Object.keys(pruned[0]).length).toBeLessThan(Object.keys(full[0]).length);

        for (const earlier of classes) {
            for (const later of classes) {
                registerMergeSignatures(full);
                const expected = szcn(earlier, later);
                registerMergeSignatures(pruned);
                expect(szcn(earlier, later), `${earlier} ${later}`).toBe(expected);
            }
        }
    }, 60_000);
});
