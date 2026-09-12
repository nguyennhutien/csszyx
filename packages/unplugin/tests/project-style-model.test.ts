/**
 * One compile of the project's stylesheets, answering every question about
 * them.
 *
 * The build asks three things of the same CSS: which classes Tailwind serves,
 * what each one sets, and what the `@import "tailwindcss"` line settled for all
 * of them. Two independent paths grew for that — a regex scan and the compiled
 * design system — and a feature wired to one silently misses what only the
 * other can see (`@theme` inside `node_modules`, `@plugin`, `@config`). This
 * model is the single path; `.agent/flows/css-design-system-pipeline.md`
 * carries the map, and `css-reading-entry-points.test.ts` keeps a third from
 * opening.
 */
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { openProjectStyleModel } from '../src/project-style-model.js';

/** Repository root, whose `package.json` resolves `tailwindcss`. */
const REPO = path.resolve(import.meta.dirname, '../../..');

/** Temp directories to remove when the file is done. */
const made: string[] = [];

afterAll(() => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Write stylesheets into a fresh directory.
 *
 * @param files Filename → content.
 * @returns Absolute paths, in the order the names were given.
 */
function writeStylesheets(files: Record<string, string>): string[] {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-style-model-'));
    made.push(dir);
    return Object.entries(files).map(([name, content]) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, content, 'utf8');
        return file;
    });
}

describe('openProjectStyleModel', () => {
    it('answers both questions from one compile', async () => {
        const files = writeStylesheets({
            'app.css': '@import "tailwindcss";\n@theme { --color-brand: #123; }',
        });

        const model = await openProjectStyleModel(REPO, files);

        expect(model).not.toBeNull();
        expect(model?.facts).toEqual({ prefix: null, important: false });
        // The theme token is served, the invented name is not — so the model is
        // answering from this project's design system and not a fixed list.
        expect(model?.unserved(['bg-brand', 'zz-not-a-class'])).toEqual(['zz-not-a-class']);
    });

    it('reports the prefix an imported stylesheet settled', async () => {
        const files = writeStylesheets({
            'lib.css': '@import "tailwindcss" prefix(tw);',
            'app.css': '@import "./lib.css";',
        });

        const model = await openProjectStyleModel(REPO, files);

        expect(model?.facts.prefix).toBe('tw');
        // The prefixed name is the project's vocabulary; the bare one is not.
        expect(model?.unserved(['tw:p-4', 'p-4'])).toEqual(['p-4']);
    });

    it('calls a class unserved only when every entry agrees', async () => {
        const files = writeStylesheets({
            'a.css': '@import "tailwindcss";\n@theme { --color-brand: #123; }',
            'b.css': '@import "tailwindcss";',
        });

        const model = await openProjectStyleModel(REPO, files);

        // `b.css` serves no `bg-brand`, but `a.css` does, so the project does.
        expect(model?.unserved(['bg-brand', 'zz-not-a-class'])).toEqual(['zz-not-a-class']);
    });

    it('withholds a fact the entries disagree about', async () => {
        const files = writeStylesheets({
            'a.css': '@import "tailwindcss" prefix(tw);',
            'b.css': '@import "tailwindcss";',
        });

        const model = await openProjectStyleModel(REPO, files);

        // One stylesheet renames every utility and the other does not: there is
        // no answer that is true of the project, and guessing one would rename
        // classes for half of it.
        expect(model?.facts).toEqual({ prefix: null, important: false });
    });

    it('reports nothing when no stylesheet is an entry point', async () => {
        const files = writeStylesheets({ 'plain.css': '.card { padding: 1rem }' });

        expect(await openProjectStyleModel(REPO, files)).toBeNull();
    });

    it('reports nothing when a stylesheet cannot compile', async () => {
        const files = writeStylesheets({
            'broken.css': '@import "tailwindcss";\n@plugin "./not-a-module.js";',
        });

        expect(await openProjectStyleModel(REPO, files)).toBeNull();
    });

    it('answers from the stylesheets it was handed, without globbing', async () => {
        const files = writeStylesheets({ 'index.css': '@import "tailwindcss";' });

        const model = await openProjectStyleModel(REPO, files);

        // The defect the unserved list exists for: a name that matches a
        // utility prefix and that Tailwind serves nothing for, beside one it
        // does serve.
        expect(model?.unserved(['tab-items-wrapper', 'p-4'])).toEqual(['tab-items-wrapper']);
    });

    it('serves a name either stylesheet defines', async () => {
        const files = writeStylesheets({
            'a.css': '@import "tailwindcss";',
            'b.css': '@import "tailwindcss";\n@utility tab-items-wrapper { padding: 1rem }',
        });

        const model = await openProjectStyleModel(REPO, files);

        expect(model?.unserved(['tab-items-wrapper'])).toEqual([]);
    });
});
