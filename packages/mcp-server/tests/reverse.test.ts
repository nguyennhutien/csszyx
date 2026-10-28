/**
 * `csszyx_reverse` answers "which sz object is this class string?", and an
 * assistant pastes the answer into code. The answer is only worth pasting if
 * compiling it gives the classes back — which is a check the tool can run
 * itself, since the compiler is already a dependency. An sz object that
 * compiles to something else is a wrong answer delivered with confidence,
 * which is how `min-[330px]:grid` reached a user as `min:330px:grid`.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { handleReverse, roundTrip } from '../src/tools/reverse';
import { project, removeProjects } from './helpers/project';

afterEach(() => {
    removeProjects();
});

async function reverse(classes: string, cwd?: string) {
    return JSON.parse((await handleReverse({ classes }, { cwd })).content[0].text);
}

describe('csszyx_reverse tool', () => {
    it('should convert Tailwind classes to sz object', async () => {
        const data = await reverse('p-4 bg-red-500');

        expect(data.szObject.p).toBe(4);
        expect(data.szObject.bg).toBe('red-500');
    });

    it('should report unrecognized classes', async () => {
        const data = await reverse('p-4 unknown-class');

        expect(data.szObject.p).toBe(4);
        expect(data.unrecognized).toContain('unknown-class');
    });
});

describe('the answer proves itself by compiling back to the input', () => {
    it('reports a clean round trip for a plain class list', async () => {
        const data = await reverse('p-4 bg-red-500 hover:text-white');

        expect(data.roundTrip).toEqual({ ok: true, emitted: 'p-4 bg-red-500 hover:text-white' });
    });

    it.each([
        'min-[330px]:grid',
        'max-[900px]:hidden',
        'supports-[display:grid]:grid',
        'data-[state=open]:bg-red-500',
        'font-stretch-condensed',
        '[&>span]:text-blue-500',
    ])('round-trips %s', async classes => {
        expect((await reverse(classes)).roundTrip.ok).toBe(true);
    });

    it('keeps the order-independent comparison: same classes, any order, is ok', async () => {
        const data = await reverse('hover:text-white p-4');

        expect(data.roundTrip.ok).toBe(true);
    });

    it('leaves unrecognized classes out of the comparison and still reports them', async () => {
        const data = await reverse('p-4 unknown-class');

        expect(data.roundTrip).toEqual({ ok: true, emitted: 'p-4' });
        expect(data.unrecognized).toEqual(['unknown-class']);
    });

    it('says so when the object compiles to something else', () => {
        // Exercised on the pure helper: after the parser fixes that motivated
        // this check, no real class string produces a bad answer any more,
        // which is the point — but the report must still be able to say no.
        const report = roundTrip({ p: 4 }, ['p-4', 'bg-red-500']);

        expect(report).toEqual({ ok: false, emitted: 'p-4' });
    });

    it('says so when the object compiles to more than was asked', () => {
        const report = roundTrip({ p: 4, bg: 'red-500' }, ['p-4']);

        expect(report.ok).toBe(false);
    });
});

describe("the project's Tailwind answers where migrate's table would", () => {
    it('migrates a class the project serves and the table refuses', async () => {
        // The theme adds a `1/2` spacing step, so `-m-1/2` is served.
        const root = project({
            'app.css': '@import "tailwindcss";\n@theme { --spacing-1\\/2: 0.5rem; }\n',
        });
        const data = await reverse('p-4 -m-1/2', root);
        expect(data.szObject).toEqual({ p: 4, m: '-1/2' });
        expect(data.unrecognized).toBeUndefined();
        expect(data.roundTrip.ok).toBe(true);
    });

    it('keeps the table verdict where no Tailwind v4 can be asked', async () => {
        const data = await reverse('p-4 -m-1/2', project({}, { tailwind: false }));
        expect(data.szObject).toEqual({ p: 4 });
        expect(data.unrecognized).toEqual(['-m-1/2']);
        expect(data.note).toContain("csszyx's own tables decided `-m-1/2`");
        expect(data.note).toContain('no stylesheet imports Tailwind');
    });

    it('notes nothing when the project answered', async () => {
        const root = project({ 'app.css': '@import "tailwindcss";\n' });
        expect((await reverse('p-4 -m-1/2', root)).note).toBeUndefined();
    });
});

describe('a server started outside a project', () => {
    it('reads no stylesheet, and says why once', async () => {
        const root = project({ 'app.css': '@import "tailwindcss" prefix(tw);\n' });
        rmSync(join(root, 'package.json'));
        const data = await reverse('p-4 -m-1/2', root);
        expect(data.szObject).toEqual({ p: 4 });
        expect(data.note).toBe(
            `The classes were read without a Tailwind prefix: ${root} has no package.json, so no stylesheet was read. csszyx's own tables decided \`-m-1/2\`, for the same reason.`,
        );
    });
});

describe("the project's Tailwind prefix", () => {
    it('reads it off each class, and compiles the answer back with it', async () => {
        const root = project({ 'app.css': '@import "tailwindcss" prefix(tw);\n' });
        const data = await reverse('tw:p-4 tw:hover:flex p-2', root);
        expect(data.szObject).toEqual({ p: 4, hover: { display: 'flex' } });
        expect(data.unrecognized).toEqual(['p-2']);
        expect(data.roundTrip).toEqual({ ok: true, emitted: 'tw:p-4 tw:hover:flex' });
        expect(data.note).toBeUndefined();
    });

    it('says why it read none when the stylesheets set different ones', async () => {
        const root = project({
            'app.css': '@import "tailwindcss" prefix(tw);\n',
            'admin/admin.css': '@import "tailwindcss";\n',
        });
        const data = await reverse('p-4', root);
        expect(data.szObject).toEqual({ p: 4 });
        expect(data.note).toMatch(
            /without a Tailwind prefix: the Tailwind stylesheets set different prefixes/,
        );
    });
});
