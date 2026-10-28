/**
 * `csszyx_reverse` answers "which sz object is this class string?", and an
 * assistant pastes the answer into code. The answer is only worth pasting if
 * compiling it gives the classes back — which is a check the tool can run
 * itself, since the compiler is already a dependency. An sz object that
 * compiles to something else is a wrong answer delivered with confidence,
 * which is how `min-[330px]:grid` reached a user as `min:330px:grid`.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { handleReverse, roundTrip } from '../src/tools/reverse';

async function reverse(classes: string, cwd?: string) {
    return JSON.parse((await handleReverse({ classes }, { cwd })).content[0].text);
}

/**
 * A project whose Tailwind serves `-m-1/2`, which migrate's table refuses:
 * its theme adds a `1/2` spacing step.
 *
 * @param body - Extra stylesheet text.
 * @returns The project root; the caller removes it.
 */
function project(body: string): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-mcp-reverse-'));
    const tailwind = dirname(createRequire(import.meta.url).resolve('tailwindcss/package.json'));
    mkdirSync(join(root, 'node_modules'));
    symlinkSync(tailwind, join(root, 'node_modules', 'tailwindcss'), 'dir');
    writeFileSync(join(root, 'package.json'), '{ "name": "p", "private": true }');
    writeFileSync(join(root, 'app.css'), `@import "tailwindcss";\n${body}\n`);
    return root;
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
        const root = project('@theme { --spacing-1\\/2: 0.5rem; }');
        try {
            const data = await reverse('p-4 -m-1/2', root);
            expect(data.szObject).toEqual({ p: 4, m: '-1/2' });
            expect(data.unrecognized).toBeUndefined();
            expect(data.roundTrip.ok).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('keeps the table verdict where no Tailwind v4 can be asked', async () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-mcp-reverse-'));
        try {
            const data = await reverse('p-4 -m-1/2', root);
            expect(data.szObject).toEqual({ p: 4 });
            expect(data.unrecognized).toEqual(['-m-1/2']);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
