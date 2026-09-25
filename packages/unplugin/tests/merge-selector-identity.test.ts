/**
 * The analyzer's reading of custom CSS, pinned with `@utility` fixtures.
 *
 * These tables are built from the raw `signature` on purpose: `@utility` is the
 * only way to give a class exactly the declarations a case needs, and the
 * analyzer still serves diagnostics that read what a class sets. A build never
 * merges these classes: it reads `mergeSignature`, which keeps every
 * `@utility`, plugin and plain-CSS class out of the table
 * (`merge-scope.test.ts`).
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRng } from '../../core/tests/helpers/sz-fuzz.js';
import { _szcn, szcn } from '../../runtime/src/merge-classes.js';
import {
    __resetMergeSignaturesForTests,
    registerMergeSignatures,
} from '../../runtime/src/merge-signatures.js';
import { createMergeSignatureTable, mergeSignatureFromCss } from '../src/merge-signature.js';
import { openProjectStyleModel } from '../src/project-style-model.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    __resetMergeSignaturesForTests();
    removeTailwindProjects();
});

/**
 * Read a candidate with repeated self-references inside one pseudo argument.
 * @param name - Candidate class.
 * @param options - Pseudo and selector-list width to generate.
 * @param options.context - Functional pseudo name.
 * @param options.width - Number of repeated class references.
 * @returns The signature, retaining the named selector conditions.
 */
function relationalSignature(name: string, options: { context: string; width: number }) {
    const references = Array.from({ length: options.width }, () => `.${name}`).join(',');
    return mergeSignatureFromCss(name, `.${name}${options.context}(${references}) { color: red; }`);
}

describe('candidate names used as selector conditions', () => {
    it.each([
        ['.a .a { color: red; }', '.b .a { color: blue; }'],
        ['.a { .a { color: red; } }', '.a { .b { color: blue; } }'],
        ['.a { .a { color: red; } }', '.b { .a { color: blue; } }'],
    ])('does not erase a named condition shared with another utility: %s', (a, b) => {
        const signatures = new Map([
            ['a', mergeSignatureFromCss('a', a)],
            ['b', mergeSignatureFromCss('b', b)],
        ]);
        registerMergeSignatures(
            createMergeSignatureTable(['a', 'b'], name => signatures.get(name) ?? null),
        );
        expect.soft(szcn('a', 'b')).toBe('a b');
        expect.soft(_szcn('a', 'b')).toBe('a b');
    });

    it.each([19, 324, 20260920])('preserves generated relational references (seed %i)', seed => {
        const random = createRng(seed);
        for (let sample = 0; sample < 100; sample++) {
            let width = 1 + Math.floor(random() * 32);
            const prefix = `c${Math.floor(random() * 1_000_000)}`;
            const context = random() < 0.5 ? ':has' : ':not';
            const signature = (name: string, count: number) =>
                relationalSignature(name, { context, width: count });
            const losesIdentity = (count: number) =>
                JSON.stringify(signature(`${prefix}a`, count)) ===
                JSON.stringify(signature(`${prefix}b`, count));
            // Shrink a failing selector list to the smallest width in this
            // grammar, retaining the seed and sample for exact reproduction.
            while (width > 1 && losesIdentity(width - 1)) width--;
            const left = signature(`${prefix}a`, width);
            expect(left).not.toBeNull();
            expect(left, JSON.stringify({ seed, sample, width })).not.toEqual(
                signature(`${prefix}b`, width),
            );
        }
    });

    it.each([
        '.NAME:has(.NAME)',
        '.NAME:not(.NAME)',
        '.NAME:is(.NAME)',
        '.NAME:where(.NAME)',
        '.NAME:nth-child(2n of .NAME)',
        '.NAME .NAME',
        '.NAME > .NAME',
        '.NAME + .NAME',
        '.NAME ~ .NAME',
        ':has(.NAME)',
        ':is(.NAME) .NAME',
        '.NAME:hover, .NAME:focus',
    ])('preserves the condition in %s', selector => {
        const signatures = ['a', 'b'].map(name =>
            mergeSignatureFromCss(name, `${selector.replaceAll('NAME', name)} { color: red; }`),
        );
        expect(signatures[0]).not.toBeNull();
        expect(signatures[1]).not.toBeNull();
        expect(signatures[0]).not.toEqual(signatures[1]);
    });

    it('does not normalize candidate references in two ancestor rules', () => {
        const signature = (name: string) =>
            mergeSignatureFromCss(name, `.${name} { .${name} { color: red; } }`);
        expect(signature('a')).not.toBeNull();
        expect(signature('a')).not.toEqual(signature('b'));
    });

    it.each([1, 32, 256])('retains repeated relational conditions at width %i', width => {
        const signature = (name: string) => relationalSignature(name, { context: ':has', width });
        expect(signature('a')).not.toBeNull();
        expect(signature('a')).not.toEqual(signature('b'));
        expect(signature('a')).toEqual(signature('a'));
    });

    it.each([szcn, _szcn])('keeps real Tailwind relational utilities (helper %#)', async merge => {
        const root = tailwindProject('csszyx-relational-merge-', {
            'app.css': `@import "tailwindcss";
                @utility rel-a { &:has(.rel-a) { color: red; } }
                @utility rel-b { &:has(.rel-b) { color: blue; } }
                @utility shared-a { &:has(.child) { color: red; } }
                @utility shared-b { &:has(.child) { color: blue; } }`,
        });
        const model = await openProjectStyleModel(root, [join(root, 'app.css')]);
        const candidates = ['rel-a', 'rel-b', 'shared-a', 'shared-b', 'hover:p-2', 'hover:p-4'];
        for (const prune of [false, true]) {
            const table = createMergeSignatureTable(
                candidates,
                candidate => model.signature(candidate),
                { prune },
            );
            const reversed = createMergeSignatureTable(
                [...candidates].reverse(),
                candidate => model.signature(candidate),
                { prune },
            );
            expect(table).toEqual(reversed);
            registerMergeSignatures(table);
            expect.soft(merge('rel-a', 'rel-b')).toBe('rel-a rel-b');
            expect.soft(merge('rel-b', 'rel-a')).toBe('rel-b rel-a');
            expect.soft(merge('rel-a rel-b', 'rel-a')).toBe('rel-b rel-a');
            expect.soft(merge('shared-a', 'shared-b')).toBe('shared-b');
            expect.soft(merge('hover:p-2', 'hover:p-4')).toBe('hover:p-4');
        }
    });
});
