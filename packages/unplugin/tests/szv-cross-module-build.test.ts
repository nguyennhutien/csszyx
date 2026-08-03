/**
 * Cross-module szv precompile over a REAL vite production build, per engine.
 *
 * The compiler-level suites inject the registry through options; this net
 * exercises the actual pipeline — prescan discovers the styles module, the
 * registry records its factories, the importing file's specifier resolves,
 * the engines rewrite, and the emitted bundle carries the table, the
 * build-time string, the pick call, and the szr import retargeted at the
 * core entry. A break anywhere in that chain (path normalization, prescan
 * ordering, options plumbing) is invisible to the unit nets and lands here.
 */
import {
    existsSync,
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
import { build, createServer } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { vitePlugin } from '../src/unplugin.js';

const FIXTURE_FILES: Record<string, string> = {
    'index.html': `<!doctype html>
<html><head></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>
`,
    'src/main.ts': `
import { App } from './App.tsx';
document.body.textContent = JSON.stringify(App({ sel: { pad: 'lg' } }));
`,
    // The design-system module: exported factory, fully literal config.
    'src/styles.ts': `
import { szv } from '@csszyx/runtime';
export const cardSz = szv({
    base: { rounded: 'lg' },
    variants: { pad: { sm: { p: 2 }, lg: { p: 8 } } },
});
`,
    // The consumer: single-clause szr import (the shape people write), one
    // static and one dynamic selection on the IMPORTED factory.
    'src/App.tsx': `
import { szr } from '@csszyx/runtime';
import { cardSz } from './styles.ts';
export const App = ({ sel }) => szr(cardSz({ pad: 'sm' }), cardSz(sel));
`,
};

const tempDirs: string[] = [];

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/**
 * Build the fixture app in production and return the joined JS output.
 *
 * @param parser - Engine under test.
 * @returns Emitted JS bundle text.
 */
async function buildFixture(parser: 'rust' | 'oxc' | 'babel'): Promise<string> {
    const root = mkdtempSync(join(realpathSync(tmpdir()), `csszyx-szv-xm-${parser}-`));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    for (const [file, source] of Object.entries(FIXTURE_FILES)) {
        writeFileSync(join(root, file), source, 'utf8');
    }

    await build({
        root,
        logLevel: 'silent',
        plugins: [vitePlugin({ build: { parser, cache: false } })],
        esbuild: {
            jsx: 'transform',
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            jsxInject: 'const h = (t, p, ...c) => ({ t, p, c }); const Fragment = "f";',
        },
        build: {
            minify: false,
            // Runtime stays external so the emitted import statements — the
            // artifact under test — survive verbatim into the bundle.
            rollupOptions: { external: ['@csszyx/runtime', '@csszyx/runtime/core'] },
        },
    });

    const assetsDir = join(root, 'dist', 'assets');
    const js = readdirSync(assetsDir)
        .filter(file => file.endsWith('.js'))
        .map(file => readFileSync(join(assetsDir, file), 'utf8'))
        .join('\n');
    expect(js.length).toBeGreaterThan(0);
    return js;
}

const SLIM_FIXTURE_FILES: Record<string, string> = {
    'index.html': FIXTURE_FILES['index.html'],
    'src/main.ts': `
import { App } from './App.tsx';
document.body.textContent = JSON.stringify(App({ n: 3 }));
`,
    // The provable-array shape: the dynamic element is a template literal, so
    // _szPart can never receive an object and the merge helpers come from the
    // compiler-free entry.
    'src/App.tsx': `
export const App = ({ n }) => <div sz={[{ p: 4 }, \`col-\${n}\`]} />;
`,
};

/**
 * Build the provable-array fixture and return the joined JS output.
 *
 * @param parser - Engine under test.
 * @returns Emitted JS bundle text.
 */
async function buildSlimFixture(parser: 'rust' | 'oxc' | 'babel'): Promise<string> {
    const root = mkdtempSync(join(realpathSync(tmpdir()), `csszyx-szpart-slim-${parser}-`));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    for (const [file, source] of Object.entries(SLIM_FIXTURE_FILES)) {
        writeFileSync(join(root, file), source, 'utf8');
    }
    await build({
        root,
        logLevel: 'silent',
        plugins: [vitePlugin({ build: { parser, cache: false } })],
        esbuild: {
            jsx: 'transform',
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            jsxInject: 'const h = (t, p, ...c) => ({ t, p, c }); const Fragment = "f";',
        },
        build: {
            minify: false,
            rollupOptions: {
                external: ['@csszyx/runtime', '@csszyx/runtime/merge'],
            },
        },
    });
    const assetsDir = join(root, 'dist', 'assets');
    const js = readdirSync(assetsDir)
        .filter(file => file.endsWith('.js'))
        .map(file => readFileSync(join(assetsDir, file), 'utf8'))
        .join('\n');
    expect(js.length).toBeGreaterThan(0);
    return js;
}

describe.each(['rust', 'oxc', 'babel'] as const)('%s slim injection build', parser => {
    it('routes provable merge helpers through the compiler-free entry', async () => {
        const js = await buildSlimFixture(parser);
        // The merge helpers import the /merge entry, not the self-registering
        // barrel. Other features may still import light symbols from the
        // barrel (theme-group registration does), so the assertion targets the
        // helper bindings themselves.
        expect(js).toMatch(/import \{[^}]*_szPart[^}]*\} from ['"]@csszyx\/runtime\/merge['"]/);
        expect(js).not.toMatch(/import \{[^}]*_szPart[^}]*\} from ['"]@csszyx\/runtime['"]/);
        expect(js).not.toMatch(/import \{[^}]*_sz[,}]/);
        expect(js).toContain('_szPart(');
    }, 120_000);
});

describe.each(['rust', 'oxc', 'babel'] as const)('%s build', parser => {
    it('rewrites the imported factory end to end', { timeout: 120_000 }, async () => {
        const js = await buildFixture(parser);
        // The static selection collapsed at build time.
        expect(js).toContain('"rounded-lg p-2"');
        // The dynamic selection picks from the emitted table.
        expect(js).toContain('__szvT_cardSz');
        expect(js).toContain('__szvPick(');
        // Composition: every szr argument became a string, so the szr
        // import moved to the compiler-free core entry.
        expect(js).toContain('@csszyx/runtime/core');
        // And the factory call itself is gone from the consumer.
        expect(js).not.toContain('cardSz({');
    });
});

/**
 * The field-report layout: a vendored component package beside the app root,
 * with BOTH the factory module and its consumer inside the package.
 *
 * Reported as "the prescan registry never indexes the compileSources tree".
 * It does — the walk covers opted-in directories outside the vite root, and
 * the first case below proves it end to end. What is silent is the layout the
 * report was actually built with: a package NOT opted in. The transform still
 * runs on those files, so `sz` output looks correct, while the prescan skips
 * them — their classes miss the safelist and their exported factories miss the
 * registry, costing every importer its precompile.
 */
const PACKAGE_FILES: Record<string, string> = {
    'app/index.html': FIXTURE_FILES['index.html'],
    'app/src/main.ts': `
import { Flex } from '../../packages/vui/src/Flex.tsx';
import { Card } from '../../packages/vui/src/Card.tsx';
document.body.textContent = JSON.stringify([Flex({ dir: 'row' }), Card()]);
`,
    'packages/vui/src/flexSzv.ts': `
import { szv } from '@csszyx/runtime';
export const flexContainerSz = szv({
    base: { rounded: 'lg' },
    variants: { flexDir: { row: { flexDir: 'row' }, col: { flexDir: 'col' } } },
});
`,
    'packages/vui/src/Flex.tsx': `
import { szr } from '@csszyx/runtime';
import { flexContainerSz } from './flexSzv';
export const Flex = ({ dir }) => szr(flexContainerSz({ flexDir: dir }));
`,
    // A component whose classes come from an `sz` prop, so the safelist is the
    // only way Tailwind can see them under `source(none)`.
    'packages/vui/src/Card.tsx': `
export const Card = () => <div sz={{ p: 7, rounded: 'xl' }} className="vui-card-raw" />;
`,
};

/**
 * Build the vendored-package fixture and capture the plugin's warnings.
 *
 * @param optIn - Whether to pass the package directory in `compileSources`.
 * @returns The emitted JS plus every warning the plugin logged.
 */
async function buildPackageFixture(optIn: boolean): Promise<{ js: string; warnings: string[] }> {
    const repo = mkdtempSync(join(realpathSync(tmpdir()), `csszyx-vendored-${optIn}-`));
    tempDirs.push(repo);
    mkdirSync(join(repo, 'app/src'), { recursive: true });
    mkdirSync(join(repo, 'packages/vui/src'), { recursive: true });
    for (const [file, source] of Object.entries(PACKAGE_FILES)) {
        writeFileSync(join(repo, file), source, 'utf8');
    }

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
    };
    // A real `vite build` runs in production, where dev-only warnings are
    // suppressed. Vitest defaults NODE_ENV to `test`, which would let a
    // dev-only regression pass this net unnoticed.
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
        await build({
            root: join(repo, 'app'),
            logLevel: 'silent',
            plugins: [
                vitePlugin({
                    build: { parser: 'rust', cache: false },
                    ...(optIn ? { compileSources: ['../packages/vui'] } : {}),
                }),
            ],
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
    } finally {
        console.warn = originalWarn;
        process.env.NODE_ENV = originalNodeEnv;
    }

    const assetsDir = join(repo, 'app', 'dist', 'assets');
    const emitted = (extension: string): string =>
        readdirSync(assetsDir)
            .filter(file => file.endsWith(extension))
            .map(file => readFileSync(join(assetsDir, file), 'utf8'))
            .join('\n');
    const js = emitted('.js');
    expect(js.length).toBeGreaterThan(0);
    return {
        js,
        warnings,
        // Absent when nothing was discovered, which is itself the answer for
        // the not-opted-in case.
        safelist: existsSync(join(repo, 'app', 'csszyx-classes.html'))
            ? readFileSync(join(repo, 'app', 'csszyx-classes.html'), 'utf8')
            : '',
    };
}

describe('a vendored package beside the app root', () => {
    it('precompiles across its own modules once opted in', { timeout: 120_000 }, async () => {
        const { js, warnings } = await buildPackageFixture(true);
        expect(js).toContain('__szvT_flexContainerSz');
        expect(js).toContain('__szvPick1(');
        expect(js).toContain('@csszyx/runtime/core');
        expect(js).not.toContain('flexContainerSz({');
        expect(warnings.join('\n')).not.toContain('skipped by ignore rules');
    });

    it('safelists the package classes, so source(none) scoping is safe', async () => {
        // Answers the question the field report asked before adopting
        // `@import "tailwindcss" source(none)`: the auto-injected `@source`
        // points at this file, and an opted-in package's classes are in it —
        // both the sz-compiled ones and the raw className literals beside them.
        const { safelist } = await buildPackageFixture(true);
        expect(safelist).toContain('p-7');
        expect(safelist).toContain('rounded-xl');
        expect(safelist).toContain('vui-card-raw');
        expect(safelist).toContain('flex-row');
    }, 120_000);

    it('reports the skipped factory module when not opted in', { timeout: 120_000 }, async () => {
        const { js, warnings, safelist } = await buildPackageFixture(false);
        // And the same classes are missing from the safelist, which is what
        // makes `source(none)` unsafe until the package is opted in.
        expect(safelist).not.toContain('p-7');
        // The precompile is lost — the shape the field report hit.
        expect(js).not.toContain('__szvT_flexContainerSz');
        expect(js).toContain('flexContainerSz({');
        // And that loss is now stated, in a production build, naming the module
        // whose skip caused it. A module of pure szv factories carries no `sz=`
        // or `sz:`, so the old marker set never saw it.
        const logged = warnings.join('\n');
        expect(logged).toContain('flexSzv.ts');
        expect(logged).toContain('cross-module registry');
        expect(logged).toContain('compileSources');
    });
});

/**
 * A dev server switches the cross-module registry off, so an imported factory
 * cannot be resolved and every call site reports "result is unknown at build
 * time" — advice the author has already followed, for code that compiles
 * perfectly in a production build. The field report triaged fourteen of those
 * before finding the seven that were real.
 */
const DEV_FIXTURE_FILES: Record<string, string> = {
    'index.html': FIXTURE_FILES['index.html'],
    'src/main.ts': FIXTURE_FILES['src/main.ts'],
    'src/styles.ts': FIXTURE_FILES['src/styles.ts'],
    // One imported factory, in the documented qualifying shape, plus one call
    // that is genuinely unresolvable whatever the mode.
    'src/App.tsx': `
import { szr } from '@csszyx/runtime';
import { cardSz } from './styles.ts';
export const App = ({ sel }) => [szr(cardSz(sel)), szr(makeItUp(sel))];
`,
    // No relative import at all: nothing resolves against the registry, so the
    // fallback is reported whatever the mode.
    'src/Solo.tsx': `
import { szr } from '@csszyx/runtime';
export const Solo = ({ sel }) => szr(onItsOwn(sel));
`,
};

/**
 * Run one dev-server transform and collect the warnings it routed.
 *
 * @param modulePath Module to transform, root-relative.
 * @returns Warnings the plugin routed for that module.
 */
async function devServerWarnings(modulePath: string): Promise<string[]> {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'csszyx-szv-dev-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    for (const [file, source] of Object.entries(DEV_FIXTURE_FILES)) {
        writeFileSync(join(root, file), source, 'utf8');
    }

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
    };
    const server = await createServer({
        root,
        logLevel: 'silent',
        plugins: [vitePlugin({ build: { parser: 'rust', cache: false } })],
        server: { middlewareMode: true },
    });
    try {
        // The transform is what emits the diagnostics; the fixture's runtime
        // import does not resolve inside a temp dir and that failure comes
        // after, so it is not what this asserts.
        await server.transformRequest(modulePath).catch(() => null);
    } finally {
        await server.close();
        console.warn = originalWarn;
    }
    return warnings;
}

describe('dev server diagnostics', () => {
    it('drops the fallback that only exists because the registry is off', async () => {
        const warnings = (await devServerWarnings('/src/App.tsx')).join('\n');
        // The imported factory is in qualifying shape; production precompiles
        // it, so saying otherwise sends the author to rewrite working code.
        expect(warnings).not.toContain('cardSz()');
        // A genuinely unresolvable call still reports.
        expect(warnings).toContain('makeItUp()');
    }, 120_000);

    it('keeps reporting a file with nothing to resolve against the registry', async () => {
        const warnings = (await devServerWarnings('/src/Solo.tsx')).join('\n');
        expect(warnings).toContain('onItsOwn()');
    }, 120_000);
});
