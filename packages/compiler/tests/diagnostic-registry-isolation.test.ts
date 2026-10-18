/**
 * `diagnostic-registry.generated.ts` holds every diagnostic in one object, which
 * no bundler tree-shakes per key, so it is Node-only. These walk the value
 * imports of each browser-facing entry and fail when one reaches it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const packages = fileURLToPath(new URL('../../', import.meta.url));
const compilerSrc = path.join(packages, 'compiler/src');
const REGISTRY = path.join(compilerSrc, 'diagnostic-registry.generated.ts');

/** The compiler subpaths a browser bundle may import. */
const BROWSER_ENTRIES = [
    'transform-core',
    'sz-limits',
    'bool-class',
    'color-var',
    'keyword-families',
    'spacing-var',
];

/**
 * The modules a file imports or re-exports for values; `import type` and
 * `export type` are erased, so they never reach a bundle.
 *
 * @param text - The file's source.
 * @returns The module specifiers.
 */
function valueImports(text: string): string[] {
    const source = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest);
    const specs: string[] = [];
    for (const node of source.statements) {
        const typeOnly = ts.isImportDeclaration(node)
            ? node.importClause?.isTypeOnly === true
            : ts.isExportDeclaration(node) && node.isTypeOnly;
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && !typeOnly) {
            const spec = node.moduleSpecifier;
            if (spec && ts.isStringLiteral(spec)) specs.push(spec.text);
        }
    }
    return specs;
}

/**
 * Every file a source file reaches through relative value imports.
 *
 * @param entry - The first file.
 * @returns The files, the entry included.
 */
function reachable(entry: string): Set<string> {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
        const file = queue.pop() as string;
        if (seen.has(file)) continue;
        seen.add(file);
        for (const spec of valueImports(readFileSync(file, 'utf8'))) {
            if (!spec.startsWith('.')) continue;
            const target = path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts'));
            queue.push(existsSync(target) ? target : path.join(target, 'index.ts'));
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

describe('the diagnostic registry stays out of browser bundles', () => {
    it('is reached by no browser entry of the compiler', () => {
        for (const entry of BROWSER_ENTRIES) {
            expect(reachable(path.join(compilerSrc, `${entry}.ts`)), entry).not.toContain(REGISTRY);
        }
    });

    it('finds a value import of the registry when there is one', () => {
        expect(reachable(path.join(compilerSrc, 'index.ts')).size).toBeGreaterThan(1);
        const line = "import { SZ_DIAGNOSTIC_REGISTRY } from './diagnostic-registry.generated.js';";
        expect(valueImports(line)).toEqual(['./diagnostic-registry.generated.js']);
        expect(valueImports("export * from './b.js';\nimport './c.js';")).toEqual([
            './b.js',
            './c.js',
        ]);
        expect(
            valueImports("import type { X } from './a.js';\nexport type { Y } from './a.js';"),
        ).toEqual([]);
    });

    it('is imported by the runtime packages for types only', () => {
        for (const pkg of ['runtime', 'dynamic', 'vars']) {
            for (const file of sources(path.join(packages, pkg, 'src'))) {
                const specs = valueImports(readFileSync(file, 'utf8'));
                expect(specs, path.relative(packages, file)).not.toContain('@csszyx/compiler');
            }
        }
    });
});
