/**
 * A real build for the imported-static-sz-object path.
 *
 * The unit nets cover the registry's rules and the compiler suites cover the
 * three engines' lowering. What neither can show is the part that only exists
 * during a build: the prescan deciding WHICH modules to read. A plain exported
 * object carries no marker of its own — unlike `szv(`, there is nothing cheap
 * to grep for, and `export const` is far too common to gate on — so the pass is
 * driven by demand: only modules that a file authoring `sz` imports from get
 * read at all.
 *
 * That decision is invisible to a unit test and decides whether the feature
 * works, so it is exercised here through Vite, on every engine.
 */
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const FIXTURE_FILES: Record<string, string> = {
    'index.html': `<!doctype html>
<html><head></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>
`,
    'src/main.ts': `
import { App } from './App.tsx';
import { Other } from './Other.tsx';
document.body.textContent = JSON.stringify([App(), Other()]);
`,
    // A second sz-authoring file, which is what makes the prescan take its
    // BATCH path on the rust lane. One shared options object serves a whole
    // batch, so a file needing its own registry entries has to leave it — with
    // a single authoring file the fixture never reached that code at all.
    'src/Other.tsx': `
export const Other = () => <div sz={{ m: 3 }} />;
`,
    // The design-system module: a plain exported object, no marker of any kind
    // in its text. Nothing but the importer's `from './styles'` says it matters.
    'src/styles.ts': `
export const cardSz = { p: 7, rounded: 'lg' };
export const unusedSz = { m: 9 };
`,
    'src/App.tsx': `
import { cardSz } from './styles.ts';
export const App = () => <div sz={cardSz} />;
`,
};

/** The same importer, written the way a project with an `@` alias writes it. */
const ALIASED_APP = `
import { cardSz } from '@/styles.ts';
export const App = () => <div sz={cardSz} />;
`;

const tempDirs: string[] = [];

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/**
 * Build the fixture and return its JS bundle plus the generated safelist.
 *
 * @param parser - Engine under test.
 * @param importedStaticSz - Whether the feature is opted in.
 * @param aliased - Whether the importer names the provider through `@`.
 * @param overrides - Fixture files to replace, for the export-shape matrix.
 * @returns Emitted bundle text and the safelist file contents.
 */
async function buildFixture(
    parser: 'rust' | 'oxc' | 'babel',
    importedStaticSz: boolean,
    aliased = false,
    overrides: Record<string, string> = {},
): Promise<{ js: string; safelist: string }> {
    const root = mkdtempSync(join(realpathSync(tmpdir()), `csszyx-szobj-${parser}-`));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    for (const [file, source] of Object.entries({ ...FIXTURE_FILES, ...overrides })) {
        writeFileSync(join(root, file), source, 'utf8');
    }
    if (aliased) writeFileSync(join(root, 'src/App.tsx'), ALIASED_APP, 'utf8');

    await build({
        root,
        logLevel: 'silent',
        resolve: aliased ? { alias: { '@': join(root, 'src') } } : undefined,
        plugins: [vitePlugin({ build: { parser, cache: false, importedStaticSz } })],
        esbuild: {
            jsx: 'transform',
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            jsxInject: 'const h = (t, p, ...c) => ({ t, p, c }); const Fragment = "f";',
        },
        build: {
            minify: false,
            rollupOptions: { external: ['@csszyx/runtime', '@csszyx/runtime/core'] },
        },
    });

    const assetsDir = join(root, 'dist', 'assets');
    const js = readdirSync(assetsDir)
        .filter(file => file.endsWith('.js'))
        .map(file => readFileSync(join(assetsDir, file), 'utf8'))
        .join('\n');
    expect(js.length).toBeGreaterThan(0);
    let safelist = '';
    try {
        safelist = readFileSync(join(root, 'csszyx-classes.html'), 'utf8');
    } catch {
        // A build that safelisted nothing writes no file; the assertions read
        // that as "no classes", which is what it means.
    }
    return { js, safelist };
}

const PARSERS = ['rust', 'oxc', 'babel'] as const;

describe('a plain exported style object, through a real build', () => {
    for (const parser of PARSERS) {
        it(`${parser} compiles the importer and safelists its classes`, async () => {
            const { js, safelist } = await buildFixture(parser, true);
            // `p-7` is deliberately unusual: a class the rest of the fixture
            // could not have produced, so seeing it proves it came from the
            // imported object rather than from anywhere else.
            expect(js).toContain('p-7');
            expect(js).toContain('rounded-lg');
            expect(js).not.toContain('_sz(');
            // Emitting the right class is only half of it. Without the
            // safelist entry Tailwind is never told the class exists, and the
            // element renders naming a rule nothing generated.
            expect(safelist).toContain('p-7');
            expect(safelist).toContain('rounded-lg');
        }, 120_000);

        it(`${parser} leaves the runtime path alone when the option is off`, async () => {
            const { js } = await buildFixture(parser, false);
            expect(js).not.toContain('p-7');
        }, 120_000);
    }

    it('resolves the provider through the project alias, on every engine', async () => {
        // The alias table has to be in place BEFORE the prescan, because the
        // prescan is what decides to read `src/styles.ts` at all — an alias
        // learned later would leave the demand recorded under a path nothing
        // resolves, and the failure would look exactly like the feature being
        // off. Building it is the only way to see that ordering.
        for (const parser of PARSERS) {
            const { js, safelist } = await buildFixture(parser, true, true);
            expect(js).toContain('p-7');
            expect(js).not.toContain('_sz(');
            expect(safelist).toContain('p-7');
        }
    }, 240_000);

    // The docs state which export shapes fold and which do not, and the shape
    // that is wrong there is the expensive one: a reader trusts a table saying
    // "runtime fallback" and rewrites working code, or trusts "build time" and
    // ships an element naming a rule nothing generated. The table drifted once
    // already — it still called a named import a runtime fallback three
    // releases after the feature landed — because nothing here disagreed with
    // it. These builds are that disagreement.
    //
    // A re-export is read as a LINK and followed against the modules the build
    // has already read, so a barrel now folds and so does the two-statement
    // form that means the same thing. `export *` does not: it carries no export
    // name, so there is nothing to file a value under without reading the
    // provider's whole export list, which is a different question.
    const EXPORT_SHAPES: ReadonlyArray<readonly [string, Record<string, string>, boolean]> = [
        [
            'a named export of a literal',
            { 'src/styles.ts': "export const cardSz = { p: 7, rounded: 'lg' };" },
            true,
        ],
        [
            'a const exported in a separate clause',
            { 'src/styles.ts': "const cardSz = { p: 7, rounded: 'lg' };\nexport { cardSz };" },
            true,
        ],
        [
            'a namespace member',
            {
                'src/styles.ts': "export const cardSz = { p: 7, rounded: 'lg' };",
                'src/App.tsx':
                    "import * as S from './styles.ts';\nexport const App = () => <div sz={S.cardSz} />;",
            },
            true,
        ],
        [
            'a literal in the default slot',
            {
                'src/styles.ts': "export default { p: 7, rounded: 'lg' };",
                'src/App.tsx':
                    "import cardSz from './styles.ts';\nexport const App = () => <div sz={cardSz} />;",
            },
            true,
        ],
        [
            'an identifier in the default slot',
            {
                'src/styles.ts': "const cardSz = { p: 7, rounded: 'lg' };\nexport default cardSz;",
                'src/App.tsx':
                    "import cardSz from './styles.ts';\nexport const App = () => <div sz={cardSz} />;",
            },
            false,
        ],
        [
            'a barrel forwarding a name it does not declare',
            {
                'src/base.ts': "export const cardSz = { p: 7, rounded: 'lg' };",
                'src/styles.ts': "export { cardSz } from './base.ts';",
            },
            true,
        ],
        [
            'an import re-exported in a second statement',
            {
                'src/base.ts': "export const cardSz = { p: 7, rounded: 'lg' };",
                'src/styles.ts': "import { cardSz } from './base.ts';\nexport { cardSz };",
            },
            true,
        ],
        [
            'a barrel two modules deep',
            {
                'src/base.ts': "export const cardSz = { p: 7, rounded: 'lg' };",
                'src/inner.ts': "export { cardSz } from './base.ts';",
                'src/styles.ts': "export { cardSz } from './inner.ts';",
            },
            true,
        ],
        [
            'a star re-export, which names nothing to file the value under',
            {
                'src/base.ts': "export const cardSz = { p: 7, rounded: 'lg' };",
                'src/styles.ts': "export * from './base.ts';",
            },
            false,
        ],
        [
            'a computed value',
            {
                'src/styles.ts':
                    "export const cardSz = makeIt();\nfunction makeIt() { return { p: 7, rounded: 'lg' }; }",
            },
            false,
        ],
    ];

    it.each(EXPORT_SHAPES)(
        'folds %s: %o',
        async (_name, overrides, folds) => {
            const { js, safelist } = await buildFixture('rust', true, false, overrides);
            // Both halves matter and they fail apart: the emitted class without
            // the safelist entry is an element naming a rule Tailwind was never
            // asked to generate.
            expect(js.includes('p-7')).toBe(folds);
            expect(safelist.includes('p-7')).toBe(folds);
            expect(js.includes('_sz(')).toBe(!folds);
        },
        120_000,
    );

    it('reads a provider only because something imports it', async () => {
        // `unusedSz` lives in a module the prescan DID read, so it is recorded;
        // what must not happen is the whole project being read for exports.
        // The observable half of that is here: an export no importer names
        // contributes no class to the output.
        const { js, safelist } = await buildFixture('rust', true);
        expect(js).not.toContain('m-9');
        expect(safelist).not.toContain('m-9');
    }, 120_000);
});
