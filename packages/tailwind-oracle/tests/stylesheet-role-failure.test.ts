/**
 * A stylesheet that fails to compile says whether it had reached Tailwind.
 *
 * Both a broken Tailwind entry and a plain stylesheet with a stale `@import`
 * fail the same way, as a stylesheet that did not compile. Only the first
 * carries a prefix the build needs: the second never reached Tailwind, so it
 * cannot set one. Tailwind requests every import of a stylesheet before any
 * failure surfaces, so the imports loaded by then tell the two apart.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readStylesheetRole, type TailwindLoader } from '../src/emitted-class-oracle.js';

const REPO = resolve(import.meta.dirname, '../../..');
const dir = mkdtempSync(join(tmpdir(), 'csszyx-role-failure-'));
writeFileSync(join(dir, 'partial.css'), '@import "tailwindcss";\n@import "./missing.css";\n');

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

/**
 * The role of a stylesheet written in the fixture directory.
 *
 * @param css - The stylesheet's contents.
 * @returns What the oracle made of it.
 */
function roleOf(css: string) {
    return readStylesheetRole({ resolveFrom: REPO, css, cssBase: dir });
}

describe('readStylesheetRole — a stylesheet that did not compile', () => {
    it('reports that a broken Tailwind entry had reached Tailwind', async () => {
        expect(await roleOf('@import "tailwindcss";\n@import "./missing.css";\n')).toMatchObject({
            ok: false,
            kind: 'stylesheet',
            reachedTailwind: true,
        });
    });

    it("reports it for an entry that imports one of Tailwind's own stylesheets", async () => {
        expect(
            await roleOf('@import "tailwindcss/theme.css";\n@import "./missing.css";\n'),
        ).toMatchObject({ ok: false, reachedTailwind: true });
    });

    it('reports it when Tailwind is reached through a partial', async () => {
        expect(await roleOf('@import "./partial.css";\n')).toMatchObject({
            ok: false,
            reachedTailwind: true,
        });
    });

    it('reports that a plain stylesheet with a stale import never reached Tailwind', async () => {
        expect(await roleOf('@import "./missing.css";\n.card { color: red; }\n')).toMatchObject({
            ok: false,
            kind: 'stylesheet',
            reachedTailwind: false,
        });
    });
});

describe('readStylesheetRole — a compile that throws something other than an Error', () => {
    it('keeps the thrown value as the reason', async () => {
        const loader: TailwindLoader = async () => ({
            version: '4.3.3',
            root: dir,
            compile: async () => {
                throw 'plain string failure';
            },
        });

        expect(
            await readStylesheetRole({ resolveFrom: REPO, css: '.a{}', cssBase: dir }, loader),
        ).toEqual({
            ok: false,
            kind: 'stylesheet',
            reason: 'the stylesheet did not compile: plain string failure',
            reachedTailwind: false,
        });
    });
});

describe('readStylesheetRole — a Tailwind that does not export its feature flags', () => {
    /**
     * A Tailwind whose compile reports the given features and exports no enum.
     *
     * @param features - The feature bits the compile reports.
     * @returns The loader.
     */
    const reporting =
        (features: number): TailwindLoader =>
        async () => ({ version: '4.3.3', root: dir, compile: async () => ({ features }) });

    // Every Tailwind 4 release sets the same utilities bit, so a build that does
    // not export `Features` is still read the way the ones that do are.
    it('reads the utilities bit every Tailwind 4 release sets', async () => {
        expect(
            await readStylesheetRole(
                { resolveFrom: REPO, css: '.a{}', cssBase: dir },
                reporting(16),
            ),
        ).toEqual({ ok: true, utilities: true, imports: [], scanSources: expect.any(Array) });
    });

    it('reads a stylesheet without that bit as generating no utilities', async () => {
        expect(
            await readStylesheetRole(
                { resolveFrom: REPO, css: '.a{}', cssBase: dir },
                reporting(1),
            ),
        ).toEqual({ ok: true, utilities: false, imports: [], scanSources: expect.any(Array) });
    });
});
