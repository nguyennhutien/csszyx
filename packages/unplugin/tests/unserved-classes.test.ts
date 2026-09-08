/**
 * Which authored class names the project's Tailwind serves nothing for.
 *
 * This is the half of the answer that needs no bundler: given the names an
 * author wrote and a way to ask the design system, it returns the set the
 * runtime has to place by the fallback.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { openUnservedAsk, unservedAuthoredClasses } from '../src/unserved-classes.js';

/**
 * An ask that calls every listed name dead and serves everything else.
 *
 * @param dead - Names the design system produces no CSS for.
 * @returns A stand-in for the oracle's `findDead`.
 */
const deadOnly =
    (dead: readonly string[]) =>
    (classes: readonly string[]): string[] =>
        classes.filter(c => dead.includes(c));

describe('unservedAuthoredClasses', () => {
    it('keeps a name the toolkit recognises that the design system does not serve', () => {
        const found = unservedAuthoredClasses(
            ['tab-items-wrapper', 'p-4'],
            deadOnly(['tab-items-wrapper']),
        );
        expect(found).toEqual(['tab-items-wrapper']);
    });

    it('drops a name the toolkit does not recognise, which already falls back', () => {
        // `card` is placed by the fallback today, so listing it would be a
        // payload entry that changes nothing.
        expect(unservedAuthoredClasses(['card'], deadOnly(['card']))).toEqual([]);
    });

    it('drops a name the design system serves', () => {
        expect(unservedAuthoredClasses(['p-4'], deadOnly([]))).toEqual([]);
    });

    it('asks about each base once, however many times it was written', () => {
        const ask = vi.fn(deadOnly(['tab-items-wrapper']));
        unservedAuthoredClasses(
            ['tab-items-wrapper', 'hover:tab-items-wrapper', 'md:tab-items-wrapper!'],
            ask,
        );
        expect(ask).toHaveBeenCalledOnce();
        expect(ask.mock.calls[0][0]).toEqual(['tab-items-wrapper']);
    });

    it('reports the base, so a variant written in source resolves through it', () => {
        const found = unservedAuthoredClasses(
            ['hover:tab-items-wrapper'],
            deadOnly(['tab-items-wrapper']),
        );
        expect(found).toEqual(['tab-items-wrapper']);
    });

    it('sorts, so two builds of the same project emit the same module', () => {
        const found = unservedAuthoredClasses(
            ['row', 'end', 'tab-items-wrapper'],
            deadOnly(['row', 'end', 'tab-items-wrapper']),
        );
        expect(found).toEqual(['end', 'row', 'tab-items-wrapper']);
    });

    it('asks nothing when no authored name is recognised', () => {
        const ask = vi.fn(deadOnly([]));
        expect(unservedAuthoredClasses(['card', 'btn-primary'], ask)).toEqual([]);
        expect(ask).not.toHaveBeenCalled();
    });
});

describe('openUnservedAsk', () => {
    // Inside the package on purpose: the oracle resolves `tailwindcss` against
    // the directory it is given, so one under the workspace finds the installed
    // Tailwind by walking up, the way a user's project does.
    const roots: string[] = [];

    afterAll(async () => {
        for (const root of roots) await rm(root, { recursive: true, force: true });
    });

    /**
     * Write a throwaway project holding the given stylesheets.
     *
     * @param files - Relative path to contents.
     * @returns The project directory and the absolute stylesheet paths.
     */
    async function project(
        files: Record<string, string>,
    ): Promise<{ root: string; css: string[] }> {
        const root = await mkdtemp(path.join(import.meta.dirname, 'unserved-'));
        roots.push(root);
        const css: string[] = [];
        for (const [rel, body] of Object.entries(files)) {
            const target = path.join(root, rel);
            await writeFile(target, body);
            css.push(target);
        }
        return { root, css };
    }

    it('answers from the stylesheets it was handed, without globbing', async () => {
        const { root, css } = await project({ 'index.css': '@import "tailwindcss";\n' });
        const ask = await openUnservedAsk(root, css);
        if (ask === null) throw new Error('expected an ask');
        // The bug this exists for: a prefix match Tailwind serves nothing for,
        // beside one it does.
        expect(ask(['tab-items-wrapper', 'p-4'])).toEqual(['tab-items-wrapper']);
    });

    it('serves a name either stylesheet defines', async () => {
        // A project with two entries serves a class if EITHER one does, which is
        // the rule `csszyx check` follows.
        const { root, css } = await project({
            'a.css': '@import "tailwindcss";\n',
            'b.css': '@import "tailwindcss";\n@utility tab-items-wrapper { padding: 1rem }\n',
        });
        const ask = await openUnservedAsk(root, css);
        if (ask === null) throw new Error('expected an ask');
        expect(ask(['tab-items-wrapper'])).toEqual([]);
    });

    it('yields no ask when no stylesheet imports tailwind', async () => {
        const { root, css } = await project({ 'plain.css': '.a { color: red }\n' });
        expect(await openUnservedAsk(root, css)).toBeNull();
    });

    it('yields no ask when the only stylesheet will not compile', async () => {
        // A broken stylesheet is not evidence that a class is dead.
        const { root, css } = await project({
            'index.css': '@import "tailwindcss";\n@import "./does-not-exist.css";\n',
        });
        expect(await openUnservedAsk(root, css)).toBeNull();
    });
}, 90_000);
