/**
 * A module that binds the name of a helper its compiled `sz` calls would run
 * that binding instead of the helper: `_szMerge(c, "p-4")` became the author's
 * `v.join('|')`, and the element got the class `c|p-4` with nothing to say so.
 * The engine now calls the helper through a name the module does not spell,
 * and the plugin imports it under that name, so the build needs nothing from
 * the author.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const roots: string[] = [];

afterAll(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** An element as the fixture's JSX factory writes it. */
interface Element {
    t: string;
    p: { className?: string } | null;
}

/**
 * Build a one-module server bundle and load it.
 *
 * @param source - The module's text.
 * @param mangle - Whether the build mangles, so the compiler marks its class strings.
 * @returns The bundle's text and its exports.
 */
async function buildModule(
    source: string,
    mangle = false,
): Promise<{ code: string; exports: Record<string, (props: object) => Element> }> {
    const root = mkdtempSync(join(import.meta.dirname, '..', '.tmp-helper-name-'));
    roots.push(root);
    const file = 'src/A.tsx';
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), source, 'utf8');
    await build({
        root,
        logLevel: 'silent',
        plugins: [
            vitePlugin({
                build: { cache: false },
                // The fixture sits under `packages/`, which a build skips unless named.
                compileSources: ['src'],
                production: { mangle },
            }),
        ],
        esbuild: {
            jsx: 'transform',
            jsxFactory: 'h',
            jsxInject: 'const h = (t, p, ...c) => ({ t, p, c });',
        },
        ssr: { noExternal: true },
        build: { ssr: file, outDir: 'dist', minify: false },
    });
    const out = join(root, 'dist', 'A.js');
    return {
        code: readFileSync(out, 'utf8'),
        exports: (await import(pathToFileURL(out).href)) as Record<
            string,
            (props: object) => Element
        >,
    };
}

describe('a binding named like a helper the compiled sz calls', () => {
    it('leaves the helper call to the helper', async () => {
        const { exports } = await buildModule(
            [
                "const _szMerge = (...v) => v.join('|');",
                'export const A = ({ c }) => <div className={c} sz={{ p: 4 }} />;',
                'export const joined = _szMerge;',
            ].join('\n'),
        );
        expect(exports.A({ c: 'flex' }).p?.className).toBe('flex p-4');
    }, 120_000);

    it.each([
        // The author's import of the real helper takes the module's own name,
        // so the compiled call goes through an alias the plugin must import.
        ['imports the helper itself', "import { _szcn, _szPart } from '@csszyx/runtime/merge';"],
        // The module imports from `/merge` but not the helpers the compiled sz calls.
        ['imports another merge helper', "import { szcn } from '@csszyx/runtime/merge';"],
    ])(
        'imports what the compiled sz calls when the module %s',
        async (_case, line) => {
            const { exports } = await buildModule(
                [line, 'export const A = ({ x }) => <b sz={[{ m: 1 }, `p-${x}`]} />;'].join('\n'),
            );
            expect(exports.A({ x: 4 }).p?.className).toBe('m-1 p-4');
        },
        120_000,
    );

    it('leaves the mark of a mangle build to the bundle pass', async () => {
        const { code, exports } = await buildModule(
            [
                'const __szCss = v => `${v}!`;',
                'export const A = () => <div sz={{ p: 4 }} />;',
                "export const label = __szCss('hidden');",
            ].join('\n'),
            true,
        );
        const className = exports.A({}).p?.className ?? '';
        // The pass replaced the mark with the renamed class; the author's
        // function still runs where the author called it.
        expect(className).not.toBe('');
        expect(className).not.toContain('!');
        expect(code).not.toMatch(/__szCss\$\d+\(/);
        expect(exports.label).toBe('hidden!');
    }, 120_000);
});
