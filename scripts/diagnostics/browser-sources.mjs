/**
 * The value-import graph of the sources, and the files a browser bundle can
 * hold: which files a source file loads at run time. `import type` and
 * `export type` are erased, so they never reach a bundle or a process; a
 * bundler's chunk graph follows the rest.
 *
 * The generator reads {@link browserSourceFiles} to check where a console
 * line or a throw runs (`host` in `registry.mjs`); the compiler's isolation
 * tests walk the same graph to keep the Node registry out of every bundle.
 *
 * @module browser-sources
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

/** The repository root. */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/** The compiler's subpaths that stay in Node: every other one can land in a browser bundle. */
export const COMPILER_NODE_SUBPATHS = [
    '.',
    './engine',
    './internal',
    './migrate',
    './package.json',
];

/** Packages whose every source can land in a browser bundle. */
const BROWSER_PACKAGES = ['runtime', 'dynamic', 'vars'];

/** The browser entries of the umbrella package; its other entries are Node. */
const UMBRELLA_BROWSER_ENTRIES = ['index.browser.ts', 'browser.ts'];

/**
 * The modules a file imports, re-exports or loads with `import()` for values.
 *
 * @param {string} text - The file's source.
 * @returns {string[]} The module specifiers.
 */
export function valueImports(text) {
    const source = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest);
    const specs = [];
    const visit = node => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            const typeOnly = ts.isImportDeclaration(node)
                ? node.importClause?.isTypeOnly === true
                : node.isTypeOnly;
            const spec = node.moduleSpecifier;
            if (!typeOnly && spec && ts.isStringLiteral(spec)) specs.push(spec.text);
            return;
        }
        if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])
        ) {
            specs.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return specs;
}

/**
 * The compiler's `exports`.
 *
 * @param {string} root - The repository root.
 * @returns {Record<string, unknown>} The map.
 */
function compilerExports(root) {
    return JSON.parse(readFileSync(path.join(root, 'packages/compiler/package.json'), 'utf8'))
        .exports;
}

/**
 * The compiler source a `@csszyx/compiler` specifier loads, read from the
 * package's `exports`: `./dist/<name>.mjs` is built from `src/<name>.ts`.
 *
 * @param {string} spec - `@csszyx/compiler` or one of its subpaths.
 * @param {string} [root] - The repository root.
 * @returns {string} The source file.
 */
export function compilerEntry(spec, root = REPO_ROOT) {
    const target = JSON.stringify(
        compilerExports(root)[`.${spec.slice('@csszyx/compiler'.length)}`],
    );
    const name = /\.\/dist\/([\w-]+)\.mjs/.exec(target)?.[1];
    if (name === undefined) throw new Error(`no ESM entry for ${spec}`);
    return path.join(root, 'packages/compiler/src', `${name}.ts`);
}

/**
 * Every file a source file reaches through value imports: relative ones, and
 * `@csszyx/compiler` and its subpaths.
 *
 * @param {string[]} entries - The first files.
 * @param {string} [root] - The repository root.
 * @returns {Set<string>} The files, the entries included.
 */
export function reachable(entries, root = REPO_ROOT) {
    const seen = new Set();
    const queue = [...entries];
    while (queue.length > 0) {
        const file = queue.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        for (const spec of valueImports(readFileSync(file, 'utf8'))) {
            if (spec === '@csszyx/compiler' || spec.startsWith('@csszyx/compiler/')) {
                queue.push(compilerEntry(spec, root));
            } else if (spec.startsWith('.')) {
                const target = path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts'));
                queue.push(existsSync(target) ? target : path.join(target, 'index.ts'));
            }
        }
    }
    return seen;
}

/**
 * The compiler's own browser subpaths, read from its `exports`.
 *
 * @param {string} [root] - The repository root.
 * @returns {string[]} The subpaths.
 */
export function compilerBrowserSubpaths(root = REPO_ROOT) {
    return Object.keys(compilerExports(root)).filter(
        subpath => !COMPILER_NODE_SUBPATHS.includes(subpath),
    );
}

/**
 * Every source a browser bundle can start from: each source of the browser
 * packages, the umbrella's browser entries and the compiler's browser
 * subpaths. Tests and type tests are left out.
 *
 * @param {string} [root] - The repository root.
 * @returns {string[]} The files.
 */
export function browserRoots(root = REPO_ROOT) {
    const sources = dir =>
        readdirSync(dir, { recursive: true, encoding: 'utf8' })
            .filter(name => name.endsWith('.ts') && !/\.(?:type-)?test\.ts$/.test(name))
            .map(name => path.join(dir, name));
    return [
        ...BROWSER_PACKAGES.flatMap(pkg => sources(path.join(root, 'packages', pkg, 'src'))),
        ...UMBRELLA_BROWSER_ENTRIES.map(name => path.join(root, 'packages/csszyx/src', name)),
        ...compilerBrowserSubpaths(root).map(subpath =>
            compilerEntry(`@csszyx/compiler${subpath.slice(1)}`, root),
        ),
    ];
}

/**
 * The files a browser bundle can hold, repository-relative: every file the
 * browser roots reach. A source anywhere else runs in Node only.
 *
 * @param {string} [root] - The repository root.
 * @returns {Set<string>} The files, as `packages/<path>`.
 */
export function browserSourceFiles(root = REPO_ROOT) {
    return new Set(
        [...reachable(browserRoots(root), root)].map(file =>
            path.relative(root, file).split(path.sep).join('/'),
        ),
    );
}
