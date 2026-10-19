/**
 * The value-import graph of the sources: which files a source file loads at
 * run time. `import type` and `export type` are erased, so they never reach a
 * bundle or a process; a bundler's chunk graph follows the rest.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

/** The repository's `packages` directory. */
export const packages = fileURLToPath(new URL('../../../', import.meta.url));
/** The compiler's sources. */
export const compilerSrc = path.join(packages, 'compiler/src');

/**
 * The modules a file imports, re-exports or loads with `import()` for values;
 * `import type` and `export type` are erased, so they never reach a bundle.
 *
 * @param text - The file's source.
 * @returns The module specifiers.
 */
export function valueImports(text: string): string[] {
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
export function compilerEntry(spec: string): string {
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
export function reachable(entries: string[]): Set<string> {
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
