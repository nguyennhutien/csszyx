/**
 * `classNameToSzObject` reads a class string the way `csszyx migrate` reads a
 * file: with the project's Tailwind answering where a table would decide, and
 * with the project's prefix read off each class.
 *
 * A few of migrate's refusals read csszyx's own tables (a sign on a keyword,
 * a fraction on a key); the project's Tailwind is the authority on whether a
 * class is served, so the programmatic call and the MCP `reverse` tool need
 * the same two-pass shape the command has: convert, ask about the classes the
 * tables decided, convert again with the answers.
 */
import { rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { openOracles } from '../src/commands/check.js';
import { classNameToSzObject } from '../src/migrate.js';
import { openCheckOracles } from '../src/scanner/migrate-verdicts.js';
import { projectAnswers, projectPrefix } from '../src/scanner/project-answers.js';
import { removeTailwindProjects, tailwindProject } from './helpers/tailwind-project.js';

vi.mock('../src/scanner/migrate-verdicts.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../src/scanner/migrate-verdicts.js')>();
    return { ...actual, openCheckOracles: vi.fn(actual.openCheckOracles) };
});

afterEach(() => {
    removeTailwindProjects();
});

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

describe('classNameToSzObject under a Tailwind prefix', () => {
    it('reads the prefix off the front of each class', () => {
        expect(
            classNameToSzObject('tw:p-4 tw:hover:flex tw:-m-1 tw:mt-2!', { prefix: 'tw' }),
        ).toEqual({
            szObject: { p: 4, hover: { display: 'flex' }, m: -1, mt: '2!' },
            unrecognized: [],
            keepInClassName: [],
        });
    });

    it('keeps a class without the prefix as written', () => {
        expect(classNameToSzObject('tw:p-4 p-2', { prefix: 'tw' })).toEqual({
            szObject: { p: 4 },
            unrecognized: ['p-2'],
            keepInClassName: [],
        });
    });

    it('takes a null prefix as no prefix', () => {
        expect(classNameToSzObject('p-4', { prefix: null }).szObject).toEqual({ p: 4 });
    });
});

describe('projectAnswers', () => {
    const asked = classNameToSzObject('p-4 -m-1/2').tableVerdicts;

    it("returns the answers when the project's Tailwind disagrees with a table", async () => {
        const root = tailwindProject({
            'app.css': '@import "tailwindcss";\n@theme { --spacing-1\\/2: 0.5rem; }\n',
        });
        const { served, skipped } = await projectAnswers(root).ask(asked);
        expect(served).toEqual(new Map([['-m-1/2', true]]));
        expect(skipped).toBeNull();
        expect(classNameToSzObject('p-4 -m-1/2', { served: served ?? undefined }).szObject).toEqual(
            { p: 4, m: '-1/2' },
        );
    });

    it('returns no answers when the project agrees with every table', async () => {
        const root = tailwindProject({ 'app.css': '@import "tailwindcss";\n' });
        expect(await projectAnswers(root).ask(asked)).toEqual({ served: null, skipped: null });
    });

    it('says why there was no Tailwind v4 to ask, and asks nothing for nothing', async () => {
        const root = tailwindProject(
            { 'app.css': '@import "tailwindcss";\n' },
            { tailwind: false },
        );
        expect(await projectAnswers(root).ask(asked)).toEqual({
            served: null,
            skipped: expect.stringContaining('tailwindcss'),
        });
        expect(await projectAnswers(root).ask(undefined)).toEqual({ served: null, skipped: null });
    });

    it('compiles the stylesheets once for the prefix and the answers', async () => {
        const root = tailwindProject({
            'app.css': '@import "tailwindcss" prefix(px);\n@theme { --spacing-1\\/2: 0.5rem; }\n',
        });
        vi.mocked(openCheckOracles).mockClear();
        const project = projectAnswers(root);
        expect(await project.prefix()).toEqual({ prefix: 'px', unread: null });
        expect((await project.ask(asked)).served).toEqual(new Map([['-m-1/2', true]]));
        expect(openCheckOracles).toHaveBeenCalledTimes(1);
    });

    // A server started from the home directory would otherwise walk all of
    // it on the first call, on the thread that answers every other call.
    it('reads nothing from a directory without a package.json', async () => {
        const root = tailwindProject({ 'app.css': '@import "tailwindcss" prefix(tw);\n' });
        rmSync(path.join(root, 'package.json'));
        vi.mocked(openCheckOracles).mockClear();
        const project = projectAnswers(root);
        const unread = expect.stringContaining('has no package.json');
        expect(await project.prefix()).toEqual({ prefix: null, unread });
        expect(await project.ask(asked)).toEqual({ served: null, skipped: unread });
        expect(await project.ask(undefined)).toEqual({ served: null, skipped: null });
        expect(openCheckOracles).not.toHaveBeenCalled();
    });
});

describe('projectPrefix', () => {
    it('reads the prefix the stylesheets set, and none when they set none', async () => {
        const prefixed = tailwindProject({ 'app.css': '@import "tailwindcss" prefix(tw);\n' });
        const plain = tailwindProject({ 'app.css': '@import "tailwindcss";\n' });
        expect(await projectPrefix(prefixed)).toEqual({ prefix: 'tw', unread: null });
        expect(await projectPrefix(plain)).toEqual({ prefix: null, unread: null });
    });

    it('says why when the stylesheets disagree, or nothing compiles', async () => {
        const split = tailwindProject({
            'app.css': '@import "tailwindcss" prefix(tw);\n',
            'admin/admin.css': '@import "tailwindcss";\n',
        });
        const none = tailwindProject(
            { 'app.css': '@import "tailwindcss";\n' },
            { tailwind: false },
        );
        expect(await projectPrefix(split)).toEqual({
            prefix: null,
            unread: expect.stringMatching(/different prefixes: .*`app\.css` with `prefix\(tw\)`/),
        });
        expect(await projectPrefix(none)).toEqual({
            prefix: null,
            unread: expect.stringContaining('tailwindcss'),
        });
    });

    it("reads the first entry's prefix when the config turns the disagreement off", async () => {
        const root = tailwindProject({
            'app.css': '@import "tailwindcss" prefix(tw);\n',
            'admin/admin.css': '@import "tailwindcss" prefix(ad);\n',
        });
        expect((await projectPrefix(root)).prefix).toBeNull();
        writeFileSync(
            path.join(root, 'csszyx.config.mjs'),
            "export default { diagnostics: { rules: { 'prefix-disagreement': 'off' } } };",
        );
        expect(await projectPrefix(root)).toEqual({ prefix: 'tw', unread: null });
    });

    it('compiles again only when a stylesheet changes', async () => {
        const root = tailwindProject({ 'app.css': '@import "tailwindcss" prefix(tw);\n' });
        const open = vi.fn(openOracles);
        expect((await projectPrefix(root, open)).prefix).toBe('tw');
        expect((await projectPrefix(root, open)).prefix).toBe('tw');
        expect(open).toHaveBeenCalledTimes(1);

        const css = path.join(root, 'app.css');
        writeFileSync(css, '@import "tailwindcss" prefix(ui);\n');
        const later = new Date(Date.now() + 5_000);
        utimesSync(css, later, later);
        expect((await projectPrefix(root, open)).prefix).toBe('ui');
        expect(open).toHaveBeenCalledTimes(2);
    });

    // The prefix can live in a stylesheet the entry imports; editing that one
    // changes no entry, yet the compile reads it.
    it('compiles again when a stylesheet the entry imports changes', async () => {
        const root = tailwindProject({
            'app.css': '@import "tailwindcss";\n@import "./theme.css";\n',
            'theme.css': '@theme prefix(tw) { --color-brand: red; }\n',
        });
        expect((await projectPrefix(root)).prefix).toBe('tw');
        const theme = path.join(root, 'theme.css');
        writeFileSync(theme, '@theme prefix(ui) { --color-brand: red; }\n');
        const later = new Date(Date.now() + 5_000);
        utimesSync(theme, later, later);
        expect(await projectPrefix(root)).toEqual({ prefix: 'ui', unread: null });
    });

    // A save that lands while the stylesheets compile: the answer came from
    // the text before it, so the next call must not take it as current.
    it('keeps no answer read from a stylesheet edited during the compile', async () => {
        const root = tailwindProject({
            'app.css': '@import "tailwindcss";\n@import "./theme.css";\n',
            'theme.css': '@theme prefix(tw) { --color-brand: red; }\n',
        });
        const theme = path.join(root, 'theme.css');
        const editedMidway = async (cwd: string) => {
            const opened = await openOracles(cwd);
            writeFileSync(theme, '@theme prefix(ui) { --color-brand: red; }\n');
            return opened;
        };
        expect((await projectPrefix(root, editedMidway)).prefix).toBe('tw');
        expect(await projectPrefix(root)).toEqual({ prefix: 'ui', unread: null });
    });

    it('compiles again when a stylesheet the entry imports is deleted', async () => {
        const root = tailwindProject({
            'app.css': '@import "tailwindcss";\n@import "./theme.css";\n',
            'theme.css': '@theme prefix(tw) { --color-brand: red; }\n',
        });
        const open = vi.fn(openOracles);
        expect((await projectPrefix(root, open)).prefix).toBe('tw');
        rmSync(path.join(root, 'theme.css'));
        await projectPrefix(root, open);
        expect(open).toHaveBeenCalledTimes(2);
    });

    // Node keeps a module it imported for the life of the process, so the
    // rule a config module sets is read again where the edit can be seen.
    it('reads the disagreement rule again when a module the config imports changes', async () => {
        const root = tailwindProject({
            'app.css': '@import "tailwindcss" prefix(tw);\n',
            'admin/admin.css': '@import "tailwindcss" prefix(ad);\n',
            'csszyx.config.mjs':
                'import rules from "./rules.mjs";\nexport default { diagnostics: { rules } };\n',
            'rules.mjs': "export default { 'prefix-disagreement': 'off' };\n",
        });
        expect((await projectPrefix(root)).prefix).toBe('tw');
        const rules = path.join(root, 'rules.mjs');
        writeFileSync(rules, "export default { 'prefix-disagreement': 'error' };\n");
        const later = new Date(Date.now() + 5_000);
        utimesSync(rules, later, later);
        expect(await projectPrefix(root)).toEqual({
            prefix: null,
            unread: expect.stringContaining('different prefixes'),
        });
    });

    // Fixing an imported partial, or installing Tailwind, changes no entry.
    it('keeps nothing from a stylesheet that did not compile', async () => {
        const root = tailwindProject({
            'app.css': '@import "tailwindcss" prefix(tw);\n@import "./partial.css";\n',
            'partial.css': '.card { @apply p-4; }\n',
        });
        expect((await projectPrefix(root)).prefix).toBeNull();
        writeFileSync(path.join(root, 'partial.css'), '.card { @apply tw:p-4; }\n');
        expect(await projectPrefix(root)).toEqual({ prefix: 'tw', unread: null });
    });
});
