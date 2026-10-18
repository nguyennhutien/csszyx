/**
 * `diagnostic-registry.generated.ts` holds every diagnostic in one object, which
 * no bundler tree-shakes per key, so it is Node-only. These walk the value
 * imports of every browser-facing source, through the compiler subpaths it
 * imports, and fail when one reaches the registry.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const packages = fileURLToPath(new URL('../../', import.meta.url));
const compilerSrc = path.join(packages, 'compiler/src');
const REGISTRY = path.join(compilerSrc, 'diagnostic-registry.generated.ts');

/** Packages whose every source can land in a browser bundle. */
const BROWSER_PACKAGES = ['runtime', 'dynamic', 'vars'];
/** The browser entries of the umbrella package; its other entries are Node. */
const UMBRELLA_BROWSER_ENTRIES = ['index.browser.ts', 'browser.ts'];

/**
 * The modules a file imports, re-exports or loads with `import()` for values;
 * `import type` and `export type` are erased, so they never reach a bundle.
 *
 * @param text - The file's source.
 * @returns The module specifiers.
 */
function valueImports(text: string): string[] {
    const source = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest);
    const specs: string[] = [];
    const visit = (node: ts.Node): void => {
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
 * The compiler source a `@csszyx/compiler` specifier loads, read from the
 * package's `exports`: `./dist/<name>.mjs` is built from `src/<name>.ts`.
 *
 * @param spec - `@csszyx/compiler` or one of its subpaths.
 * @returns The source file.
 */
function compilerEntry(spec: string): string {
    const pkg = JSON.parse(readFileSync(path.join(packages, 'compiler/package.json'), 'utf8')) as {
        exports: Record<string, unknown>;
    };
    const target = JSON.stringify(pkg.exports[`.${spec.slice('@csszyx/compiler'.length)}`]);
    const name = /\.\/dist\/([\w-]+)\.mjs/.exec(target)?.[1];
    if (name === undefined) throw new Error(`no ESM entry for ${spec}`);
    return path.join(compilerSrc, `${name}.ts`);
}

/**
 * Every file a source file reaches through value imports: relative ones, and
 * `@csszyx/compiler` and its subpaths.
 *
 * @param entries - The first files.
 * @returns The files, the entries included.
 */
function reachable(entries: string[]): Set<string> {
    const seen = new Set<string>();
    const queue = [...entries];
    while (queue.length > 0) {
        const file = queue.pop() as string;
        if (seen.has(file)) continue;
        seen.add(file);
        for (const spec of valueImports(readFileSync(file, 'utf8'))) {
            if (spec === '@csszyx/compiler' || spec.startsWith('@csszyx/compiler/')) {
                queue.push(compilerEntry(spec));
            } else if (spec.startsWith('.')) {
                const target = path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts'));
                queue.push(existsSync(target) ? target : path.join(target, 'index.ts'));
            }
        }
    }
    return seen;
}

/**
 * The source files of a package, tests and type tests left out.
 *
 * @param dir - The package's `src`.
 * @returns The files.
 */
function sources(dir: string): string[] {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter(name => name.endsWith('.ts') && !/\.(?:type-)?test\.ts$/.test(name))
        .map(name => path.join(dir, name));
}

/**
 * Every source a browser bundle can start from.
 *
 * @returns The files.
 */
const browserRoots = (): string[] => [
    ...BROWSER_PACKAGES.flatMap(pkg => sources(path.join(packages, pkg, 'src'))),
    ...UMBRELLA_BROWSER_ENTRIES.map(name => path.join(packages, 'csszyx/src', name)),
];

describe('the diagnostic registry stays out of browser bundles', () => {
    it('is reached from no browser source, through any compiler subpath it imports', () => {
        const reached = reachable(browserRoots());
        expect(reached).toContain(path.join(compilerSrc, 'transform-core.ts'));
        expect(reached).not.toContain(REGISTRY);
    });

    it('is found through a dynamic import and a compiler subpath', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'csszyx-isolation-'));
        const entry = path.join(dir, 'entry.ts');
        writeFileSync(entry, "export const load = () => import('./lazy.js');\n");
        writeFileSync(
            path.join(dir, 'lazy.ts'),
            "import { transformSource } from '@csszyx/compiler/engine';\nexport { transformSource };\n",
        );
        try {
            const reached = reachable([entry]);
            expect(reached).toContain(path.join(dir, 'lazy.ts'));
            expect(reached).toContain(path.join(compilerSrc, 'engine.ts'));
        } finally {
            rmSync(dir, { recursive: true });
        }
        expect(
            valueImports("import type { X } from './a.js';\nexport type { Y } from './a.js';"),
        ).toEqual([]);
        expect(() => compilerEntry('@csszyx/compiler/no-such-subpath')).toThrow('no ESM entry');
    });

    it('would be reached if the compiler root re-exported it', () => {
        const line = "export { SZ_DIAGNOSTIC_REGISTRY } from './diagnostic-registry.generated.js';";
        expect(valueImports(line)).toEqual(['./diagnostic-registry.generated.js']);
        expect(reachable([path.join(compilerSrc, 'index.ts')])).toContain(
            path.join(compilerSrc, 'diagnostic-codes.generated.ts'),
        );
    });
});
