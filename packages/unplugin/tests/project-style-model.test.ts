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
    it('follows a bundler alias to the stylesheet that sets the prefix', async () => {
        const [app, tokens] = writeStylesheets({
            'app.css': '@import "@ds/tailwind.css";\n',
            'tailwind.css': '@import "tailwindcss" prefix(tw);\n',
        });
        const alias = {
            find: '@ds/',
            replacement: `${path.dirname(tokens as string)}/`,
            exact: false,
        };

        const model = await openProjectStyleModel(REPO, [app as string], [alias]);

        expect(model.facts).toEqual({ prefix: 'tw', important: false });
    });

    it('answers both questions from one compile', async () => {
        const files = writeStylesheets({
            'app.css': '@import "tailwindcss";\n@theme { --color-brand: #123; }',
        });

        const model = await openProjectStyleModel(REPO, files);

        expect(model.facts).toEqual({ prefix: null, important: false });
        // The theme token is served, the invented name is not — so the model is
        // answering from this project's design system and not a fixed list.
        expect(model.unserved(['bg-brand', 'zz-not-a-class'])).toEqual(['zz-not-a-class']);
    });

    it('reports the prefix an imported stylesheet settled', async () => {
        const files = writeStylesheets({
            'lib.css': '@import "tailwindcss" prefix(tw);',
            'app.css': '@import "./lib.css";',
        });

        const model = await openProjectStyleModel(REPO, files);

        expect(model.facts.prefix).toBe('tw');
        // The prefixed name is the project's vocabulary; the bare one is not.
        expect(model.unserved(['tw:p-4', 'p-4'])).toEqual(['p-4']);
    });

    it('calls a class unserved only when every entry agrees', async () => {
        const files = writeStylesheets({
            'a.css': '@import "tailwindcss";\n@theme { --color-brand: #123; }',
            'b.css': '@import "tailwindcss";',
        });

        const model = await openProjectStyleModel(REPO, files);

        // `b.css` serves no `bg-brand`, but `a.css` does, so the project does.
        expect(model.unserved(['bg-brand', 'zz-not-a-class'])).toEqual(['zz-not-a-class']);
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
        expect(model.facts).toEqual({ prefix: null, important: false });
    });

    it('withholds a forced important the entries disagree about', async () => {
        // The same rule on the other fact, stated separately: one arm agreeing
        // proves nothing about the other, and `important` decides whether a
        // csszyx class can override the library class beside it.
        const files = writeStylesheets({
            'a.css': '@import "tailwindcss" important;',
            'b.css': '@import "tailwindcss";',
        });

        const model = await openProjectStyleModel(REPO, files);

        expect(model.facts).toEqual({ prefix: null, important: false });
    });

    it('reports a forced important every entry agrees on', async () => {
        const files = writeStylesheets({
            'a.css': '@import "tailwindcss" important;',
            'b.css': '@import "tailwindcss" important;',
        });

        const model = await openProjectStyleModel(REPO, files);

        expect(model.facts).toEqual({ prefix: null, important: true });
    });

    it('reports no facts, and says why, when no stylesheet is an entry point', async () => {
        const files = writeStylesheets({ 'plain.css': '.card { padding: 1rem }' });

        const model = await openProjectStyleModel(REPO, files);

        expect(model.facts).toBeNull();
        expect(model.entries).toEqual([{ file: files[0], role: 'not-root' }]);
        expect(model.unserved(['p-4'])).toEqual([]);
    });

    it('lists a stylesheet that cannot compile, with the reason, and reports no facts', async () => {
        const files = writeStylesheets({
            'broken.css': '@import "tailwindcss";\n@plugin "./not-a-module.js";',
        });

        const model = await openProjectStyleModel(REPO, files);

        expect(model.facts).toBeNull();
        expect(model.entries).toHaveLength(1);
        expect(model.entries[0]).toMatchObject({
            file: files[0],
            role: 'failed',
            failure: { kind: 'stylesheet' },
        });
        expect(model.entries[0]?.failure?.reason).toContain('not-a-module');
    });

    it('answers from the stylesheets it was handed, without globbing', async () => {
        const files = writeStylesheets({ 'index.css': '@import "tailwindcss";' });

        const model = await openProjectStyleModel(REPO, files);

        // The defect the unserved list exists for: a name that matches a
        // utility prefix and that Tailwind serves nothing for, beside one it
        // does serve.
        expect(model.unserved(['tab-items-wrapper', 'p-4'])).toEqual(['tab-items-wrapper']);
    });

    it('serves a name either stylesheet defines', async () => {
        const files = writeStylesheets({
            'a.css': '@import "tailwindcss";',
            'b.css': '@import "tailwindcss";\n@utility tab-items-wrapper { padding: 1rem }',
        });

        const model = await openProjectStyleModel(REPO, files);

        expect(model.unserved(['tab-items-wrapper'])).toEqual([]);
    });

    it('reads a prefix set in a stylesheet the entry imports from a package', async () => {
        // The shape of a monorepo whose design system owns the Tailwind line:
        // the app's stylesheet never spells `@import "tailwindcss"` itself.
        const [app] = writeStylesheets({ 'app.css': '@import "@fixture/ui/globals.css";\n' });
        const root = path.dirname(app as string);
        const pkg = path.join(root, 'node_modules/@fixture/ui');
        fs.mkdirSync(pkg, { recursive: true });
        fs.writeFileSync(
            path.join(pkg, 'package.json'),
            JSON.stringify({ name: '@fixture/ui', exports: { './globals.css': './globals.css' } }),
        );
        fs.writeFileSync(path.join(pkg, 'globals.css'), '@import "tailwindcss" prefix(tw);\n');

        const model = await openProjectStyleModel(REPO, [app as string]);

        expect(model.facts).toEqual({ prefix: 'tw', important: false });
        expect(model.entries).toEqual([
            { file: app, role: 'root', facts: { prefix: 'tw', important: false } },
        ]);
    });

    it('does not count an import that sits inside a comment', async () => {
        const files = writeStylesheets({
            'app.css': '@import "tailwindcss";\n',
            'old.css': '/* @import "tailwindcss" prefix(tw); */\n.card { padding: 1rem }\n',
        });

        const model = await openProjectStyleModel(REPO, files);

        expect(model.facts).toEqual({ prefix: null, important: false });
        expect(model.entries.find(entry => entry.file === files[1])?.role).toBe('not-root');
    });

    it('lets only the stylesheet no other entry imports decide the facts', async () => {
        // `legacy.css` pulls Tailwind in again without the prefix. Tailwind
        // serves the prefixed names only, because the importing line settles
        // them, so the imported stylesheet has no say.
        const files = writeStylesheets({
            'app.css': '@import "tailwindcss" prefix(tw);\n@import "./legacy.css";\n',
            'legacy.css': '@import "tailwindcss";\n',
        });

        const model = await openProjectStyleModel(REPO, files);

        expect(model.facts).toEqual({ prefix: 'tw', important: false });
        expect(model.entries.find(entry => entry.file === files[1])?.role).toBe('imported');
    });

    it('does not blame a partial for failing alone when an entry that imports it compiles', async () => {
        // The partial applies a token the entry declares, so it only compiles
        // as part of the entry, which is how the build reads it.
        const files = writeStylesheets({
            'app.css':
                '@import "tailwindcss";\n@theme { --color-brand: #123; }\n@import "./partial.css";\n',
            'partial.css': '@import "./tokens.css";\n.card { @apply bg-brand; }\n',
            'tokens.css': ':root { --x: 1; }\n',
        });

        const model = await openProjectStyleModel(REPO, files);

        expect(model.entries.find(entry => entry.file === files[1])).toEqual({
            file: files[1],
            role: 'imported',
        });
        expect(model.entries.some(entry => entry.role === 'failed')).toBe(false);
    });
});
