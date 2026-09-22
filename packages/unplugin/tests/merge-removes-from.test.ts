/**
 * The object rule's pre-check against the merge it stands in for.
 *
 * Before paying for a second engine pass the plugin asks, per list, whether a
 * merge would remove a class: from the style model on the bundler lanes, from
 * the settled table under Turbopack. Both must answer exactly what `_szcn`
 * does with that list: a false "no" is a merge silently skipped, and a false
 * "yes" is a pass paid for nothing.
 *
 * Lists are drawn from a pool that mixes shorthands, their sides, shared and
 * split properties, importance, variants and classes with no CSS, over a stock
 * Tailwind; no list repeats a class, since `_szcn` drops an exact repeat
 * whatever the table says.
 */
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRng } from '../../core/tests/helpers/sz-fuzz.js';
import { _szcn } from '../../runtime/src/merge-classes.js';
import { registerMergeSignatures } from '../../runtime/src/merge-signatures.js';
import {
    createMergeSignatureTable,
    mergeGroupsOf,
    mergeRemovesFrom,
    tableRemovesFrom,
} from '../src/merge-signature.js';
import { openProjectStyleModel, type ProjectStyleModel } from '../src/project-style-model.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const POOL = [
    'p-4',
    'p-8',
    'p-4!',
    'pb-2',
    'px-2',
    'pt-2',
    'm-2',
    'mb-4',
    'w-4',
    'h-2',
    'size-8',
    'text-sm',
    'leading-4',
    'text-red-500',
    'border',
    'border-2',
    'border-red-500',
    'rounded',
    'rounded-t-md',
    'hover:p-4',
    'hover:pb-2',
    'md:p-4',
    'shadow',
    'ring-2',
    'space-x-2',
    'space-x-reverse',
    'card',
    'not-a-class',
];
const CASES = 2000;

let model: ProjectStyleModel;

beforeAll(async () => {
    const root = tailwindProject('csszyx-merge-removes-', {
        'app.css': '@import "tailwindcss";\n',
    });
    model = await openProjectStyleModel(root, [join(root, 'app.css')]);
}, 60_000);

afterAll(removeTailwindProjects);

describe('whether a merge would remove a class from a list', () => {
    it('agrees with _szcn, from the model and from the table', () => {
        const rng = createRng(0x0b1ec7);
        const signatureOf = (candidate: string) => model.signature(candidate);
        let removing = 0;
        for (let index = 0; index < CASES; index += 1) {
            const pool = [...POOL];
            const list: string[] = [];
            const length = 2 + Math.floor(rng() * 6);
            for (let at = 0; at < length; at += 1) {
                list.push(pool.splice(Math.floor(rng() * pool.length), 1)[0] as string);
            }
            const table = createMergeSignatureTable(list, signatureOf);
            registerMergeSignatures(table);
            const expected = _szcn(list.join(' ')).split(' ').length < list.length;
            if (expected) removing += 1;
            const context = `case ${index}: ${list.join(' ')}`;
            expect(mergeRemovesFrom(list, signatureOf), context).toBe(expected);
            expect(tableRemovesFrom(table[0], table[1], list), context).toBe(expected);
        }
        // Both answers must be exercised, or agreement proves nothing.
        expect(removing, `${removing} of ${CASES} remove a class`).toBeGreaterThan(CASES / 10);
        expect(removing).toBeLessThan(CASES - CASES / 10);
    }, 60_000);
});

describe('the lists a merge would read', () => {
    it('are the ones the engine reported', () => {
        expect(
            mergeGroupsOf({ mergeGroups: [['pb-2', 'p-4']], classes: new Set(['m-2']) }),
        ).toEqual([['pb-2', 'p-4']]);
    });

    // An older engine, or a cache entry written before the engine reported
    // them: reading every class as one list is what the plugin did then.
    it('fall back to every class of the file as one list', () => {
        expect(mergeGroupsOf({ classes: new Set(['pb-2', 'p-4']) })).toEqual([['pb-2', 'p-4']]);
    });
});
