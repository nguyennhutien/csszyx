/**
 * Differential over a real Vite build (ADR 0034): the same app built with
 * mangling off and on must style every element alike and leave every string
 * that is not a class as written.
 *
 * No browser: the fixture's JSX builds plain `{ t, p, c }` objects, so the
 * built bundle runs in Node and hands back its element tree. An element's
 * classes are matched against the build's own CSS by their raw names, as a
 * browser matches them; only the text of each matched rule is decoded through
 * the map, so the two builds compare. A class whose element kept its name while
 * its rule was renamed matches nothing, and the comparison shows it.
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
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import postcss, { type ChildNode, type Container } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { build } from 'vite';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { inlineClassMarks } from '../src/class-mark-inline.js';
import { vitePlugin } from '../src/unplugin.js';
import { readMangleMapFromHtml, tailwindSourceNonePlugin } from './vite-app-build.js';

const requireFromHere = createRequire(import.meta.url);
const tempDirs: string[] = [];

afterAll(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FILES: Record<string, string> = {
    'index.html':
        '<!doctype html><html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>',
    'src/styles.css': '@import "tailwindcss" source(none);\n.card-shell { border: 1px solid; }\n',
    'src/main.ts': [
        "import './styles.css';",
        "import { App } from './App.tsx';",
        'globalThis.__fixtureTrees = [',
        "    App({ on: true, kind: 'flex', pad: 'lg' }),",
        "    App({ on: false, kind: 'grid', pad: 'sm' }),",
        '];',
    ].join('\n'),
    'src/App.tsx': [
        "import { szr, szv } from '@csszyx/runtime';",
        "const clsx = (...values) => values.filter(Boolean).join(' ');",
        "const card = szv({ base: { rounded: 'lg' }, variants: { pad: { sm: { p: 2 }, lg: { p: 8 } } } });",
        '// A local of the helper name: the bundler renames one of the two apart.',
        'const __szCss = value => `${value}!`;',
        'export const App = ({ on, kind, pad }) => (',
        '    <main sz={{ p: 4, mx: 2 }}>',
        '        <section className="card-shell" sz={{ m: 3 }} />',
        "        <b sz={on ? { bg: 'blue-500' } : { bg: 'red-500', ml: 2 }} />",
        "        <i sz={[{ text: 'sm' }, on && { py: 2 }, { m: 3 }]} />",
        '        <u sz={{ borderB: on }} />',
        "        <em className={clsx('relative inline-flex', on && 'p-4')} sz={{ display: 'flex' }} />",
        "        <s className={kind === 'flex' ? 'flex' : 'grid'} data-kind={kind} />",
        "        <q style={{ display: 'flex' }} data-label={__szCss('hidden')} data-list={['p-4', 'flex'].join()} />",
        "        <a className={szr(card({ pad: 'sm' }))} />",
        '        <p className={szr(card({ pad }))} />',
        '    </main>',
        ');',
    ].join('\n'),
};

/** One element of the fixture's tree, as its JSX factory builds it. */
interface FixtureNode {
    t: string;
    p: Record<string, unknown> | null;
    c: unknown[];
}

/** One built variant: its element trees, rules by raw class, and its map. */
interface BuiltVariant {
    /** Marked calls left in a chunk after csszyx's pass, before the minifier. */
    marksLeft: number;
    trees: FixtureNode[];
    rules: Map<string, string[]>;
    map: Record<string, string>;
}

/**
 * Build the fixture with mangling off or on and run its bundle.
 *
 * @param mangle - Whether the build mangles classes.
 * @returns The variant's element trees, rules and map.
 */
async function buildVariant(mangle: boolean): Promise<BuiltVariant> {
    const root = mkdtempSync(join(realpathSync(tmpdir()), `csszyx-mangle-diff-${mangle}-`));
    tempDirs.push(root);
    for (const [file, source] of Object.entries(FILES)) {
        mkdirSync(join(root, dirname(file)), { recursive: true });
        writeFileSync(join(root, file), source, 'utf8');
    }
    let marksLeft = 0;
    await build({
        root,
        logLevel: 'silent',
        resolve: {
            // Bundled, not external, so the registry installs as in an app.
            alias: [
                {
                    find: /^@csszyx\/runtime$/,
                    replacement: requireFromHere.resolve('@csszyx/runtime'),
                },
            ],
        },
        plugins: [
            vitePlugin({ build: { cache: false }, production: { mangle } }),
            tailwindSourceNonePlugin(root),
            {
                // After csszyx's `renderChunk`, before the minifier: every mark
                // the compiler wrote is gone, inlined or reported as missed.
                name: 'fixture-marks-left',
                enforce: 'post',
                renderChunk(code) {
                    const left = inlineClassMarks(code, {});
                    marksLeft += left.inlined + left.missed;
                    return null;
                },
            },
        ],
        esbuild: {
            jsx: 'transform',
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            jsxInject: 'const h = (t, p, ...c) => ({ t, p, c }); const Fragment = "f";',
        },
        build: { minify: true, modulePreload: false },
    });
    const assets = join(root, 'dist', 'assets');
    const files = readdirSync(assets);
    const css = files
        .filter(file => file.endsWith('.css'))
        .map(file => readFileSync(join(assets, file), 'utf8'))
        .join('\n');
    const entry = files.find(file => file.endsWith('.js'));
    if (entry === undefined || css === '') throw new Error(`empty build in ${assets}`);
    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
    const map = mangle ? (readMangleMapFromHtml(html) ?? {}) : {};
    const global = globalThis as {
        __fixtureTrees?: FixtureNode[];
        __csszyx_mangle_registry?: unknown;
    };
    delete global.__fixtureTrees;
    delete global.__csszyx_mangle_registry;
    await import(pathToFileURL(join(assets, entry)).href);
    const trees = global.__fixtureTrees ?? [];
    delete global.__csszyx_mangle_registry;
    return { marksLeft, trees, rules: rulesByClass(css, map), map };
}

/**
 * Each rule's text, keyed by every raw class its selector names: the
 * enclosing at-rules and selectors, that class written `&`, every other class
 * decoded through the map, and the declarations.
 *
 * @param css - The build's stylesheet.
 * @param map - Original class to token; empty for a build that does not mangle.
 * @returns Rule texts by raw class.
 */
function rulesByClass(css: string, map: Record<string, string>): Map<string, string[]> {
    const original = new Map(Object.entries(map).map(([name, token]) => [token, name]));
    const rules = new Map<string, string[]>();
    const context = (node: ChildNode | Container): string[] => {
        const parts: string[] = [];
        for (
            let at: Container | undefined = node.parent;
            at && at.type !== 'root';
            at = at.parent
        ) {
            parts.unshift(
                at.type === 'atrule'
                    ? `@${at.name} ${at.params}`
                    : String((at as { selector?: string }).selector),
            );
        }
        return parts;
    };
    postcss.parse(css).walkRules(rule => {
        const declarations = rule.nodes
            .filter(node => node.type === 'decl')
            .map(node => node.toString())
            .join(';');
        const chain = [...context(rule), rule.selector];
        const named = new Set<string>();
        for (const selector of chain) {
            selectorParser(tree =>
                tree.walkClasses(node => void named.add(node.value)),
            ).processSync(selector);
        }
        for (const raw of named) {
            const text = chain
                .map(selector =>
                    selectorParser(tree =>
                        tree.walkClasses(node => {
                            node.value =
                                node.value === raw ? '&' : (original.get(node.value) ?? node.value);
                        }),
                    ).processSync(selector),
                )
                .join(' > ');
            const list = rules.get(raw) ?? [];
            list.push(`${text} { ${declarations} }`);
            rules.set(raw, list);
        }
    });
    return rules;
}

/**
 * What a browser makes of each element: its tag, every prop but the class as
 * written, and for each class the rules that select it.
 *
 * @param variant - A built variant.
 * @returns One line per element, in document order.
 */
function rendered(variant: BuiltVariant): string[] {
    const original = new Map(Object.entries(variant.map).map(([name, token]) => [token, name]));
    const lines: string[] = [];
    const walk = (node: unknown): void => {
        if (node === null || typeof node !== 'object') return;
        const { t, p, c } = node as FixtureNode;
        // `__source` and `__self` name the temp root the variant was built in.
        const { className, __source: _source, __self: _self, ...rest } = p ?? {};
        const classes =
            typeof className === 'string' ? className.split(/[\t\n\f\r ]+/).filter(Boolean) : [];
        const styled = classes
            .map(name => {
                const rules = variant.rules.get(name);
                // A class with no rule styles nothing; it is named so a
                // rename of one the build did not own still shows.
                return rules ? rules.sort().join(' | ') : `unstyled ${original.get(name) ?? name}`;
            })
            .sort();
        lines.push(`${t} ${JSON.stringify(rest)} :: ${styled.join(' || ')}`);
        for (const child of c ?? []) walk(child);
    };
    for (const tree of variant.trees) walk(tree);
    return lines;
}

describe('mangle on and off over the same app', () => {
    it('styles every element alike and keeps every string that is not a class', async () => {
        const warn = vi.spyOn(console, 'warn');
        const off = await buildVariant(false);
        const on = await buildVariant(true);
        // Every mark the compiler wrote reached the bundle pass readable. The
        // one call left is the fixture's own `__szCss('hidden')`: a call with
        // no annotation cannot be told from a mark a transformer stripped, so
        // it is reported, and runs as the author wrote it.
        const missed = warn.mock.calls
            .map(call => String(call[0]))
            .filter(line => line.includes('mangle-mark-missed'));
        warn.mockRestore();
        expect(missed).toHaveLength(1);
        expect(missed[0]).toContain('could not read 1 class string(s)');
        expect(on.marksLeft, 'only the author call reached the minifier').toBe(1);

        expect(off.trees).toHaveLength(2);
        expect(Object.keys(on.map).length, 'the build mangled something').toBeGreaterThan(0);
        expect(rendered(on)).toEqual(rendered(off));
    }, 120_000);
});
