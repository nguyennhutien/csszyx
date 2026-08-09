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
 * @returns Emitted bundle text and the safelist file contents.
 */
async function buildFixture(
    parser: 'rust' | 'oxc' | 'babel',
    importedStaticSz: boolean,
    aliased = false,
): Promise<{ js: string; safelist: string }> {
    const root = mkdtempSync(join(realpathSync(tmpdir()), `csszyx-szobj-${parser}-`));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    for (const [file, source] of Object.entries(FIXTURE_FILES)) {
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
