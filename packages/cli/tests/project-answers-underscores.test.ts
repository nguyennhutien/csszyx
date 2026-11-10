/**
 * What `projectAnswers` says about the `_` of arbitrary values: an answer
 * where a stylesheet serves the class, and which values went unanswered,
 * with why, so a tool can say so beside what it wrote.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { projectAnswers } from '../src/scanner/project-answers.js';
import { removeTailwindProjects, tailwindProject } from './helpers/tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
});

const SERVED = { class: 'bg-[url(/a_b.png)]', value: 'url(/a_b.png)', reading: 'url(/a b.png)' };
// No such utility: Tailwind serves nothing for it, so no stylesheet answers.
const UNSERVED = { class: 'not-a-utility-[a_b]', value: 'a_b', reading: 'a b' };

describe('projectAnswers().askUnderscores', () => {
    it('names the values no stylesheet answered, and why', async () => {
        const cwd = tailwindProject({ 'src/app.css': '@import "tailwindcss";' });
        const asked = await projectAnswers(cwd).askUnderscores([SERVED, UNSERVED]);
        expect(asked.underscores?.get('url(/a_b.png)')).toBe('url(/a_b.png)');
        expect(asked.unanswered).toEqual([UNSERVED]);
        expect(asked.skipped).toContain('serves');
    });

    it('names every value when no stylesheet compiled', async () => {
        const cwd = tailwindProject({});
        const asked = await projectAnswers(cwd).askUnderscores([SERVED]);
        expect(asked.underscores).toBeNull();
        expect(asked.unanswered).toEqual([SERVED]);
        expect(asked.skipped).not.toBeNull();
    });

    it('says nothing when every value was answered', async () => {
        const cwd = tailwindProject({ 'src/app.css': '@import "tailwindcss";' });
        const asked = await projectAnswers(cwd).askUnderscores([SERVED]);
        expect(asked.unanswered).toEqual([]);
        expect(asked.skipped).toBeNull();
    });
});

describe('projectAnswers() with nothing to ask', () => {
    it('answers from a directory with no package.json without reading it', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'csszyx-no-package-'));
        try {
            const answers = projectAnswers(dir);
            const asked = await answers.askUnderscores([SERVED]);
            expect(asked).toEqual({
                underscores: null,
                unanswered: [SERVED],
                skipped: expect.stringContaining('no package.json'),
            });
            expect(await answers.askUnderscores(undefined)).toEqual({
                underscores: null,
                unanswered: [],
                skipped: null,
            });
            expect(await answers.stylesheets()).toEqual({
                roots: [],
                skipped: expect.stringContaining('no package.json'),
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('asks nothing for no questions', async () => {
        const cwd = tailwindProject({ 'src/app.css': '@import "tailwindcss";' });
        expect(await projectAnswers(cwd).askUnderscores(undefined)).toEqual({
            underscores: null,
            unanswered: [],
            skipped: null,
        });
    });
});

describe('projectAnswers().stylesheets', () => {
    it("gives each stylesheet's prefix and CSS for the classes", async () => {
        const cwd = tailwindProject({ 'src/app.css': '@import "tailwindcss" prefix(tw);' });
        const { roots, skipped } = await projectAnswers(cwd).stylesheets();
        expect(skipped).toBeNull();
        expect(roots).toHaveLength(1);
        expect(roots[0]?.prefix).toBe('tw');
        const css = roots[0]?.cssFor(['tw:p-4', 'p-4']);
        expect(css?.[0]).toContain('padding');
        expect(css?.[1]).toBeNull();
    });

    it('says why when the project has no Tailwind stylesheet', async () => {
        const cwd = tailwindProject({ 'src/app.css': 'body { margin: 0; }' });
        expect(await projectAnswers(cwd).stylesheets()).toEqual({
            roots: [],
            skipped: 'this project has no Tailwind stylesheet',
        });
    });

    it('names the stylesheet that did not compile', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";\n.a { @apply not-a-real-utility; }\n',
        });
        const { roots, skipped } = await projectAnswers(cwd).stylesheets();
        expect(roots).toEqual([]);
        expect(skipped).not.toBeNull();
    });
});
