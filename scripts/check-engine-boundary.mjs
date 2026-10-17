#!/usr/bin/env node
// The engine stays where it is declared.
//
// `@csszyx/core` (the engine: a native binary per platform plus the wasm
// builds) is an optional peer of `@csszyx/compiler`. Only
// `@csszyx/compiler/engine` and the build-only subpaths reach it; the root and
// the browser subpaths never do, so `@csszyx/runtime`, `@csszyx/dynamic` and
// `@csszyx/types` install no engine. That only holds while every file keeps
// to it, so this script reads the built files rather than trusting a list:
//
// 1. From each subpath of the compiler's `exports`, it follows the relative
//    imports of `dist` and records which subpaths reach `@csszyx/core`. The
//    root and every browser subpath must not.
// 2. A browser subpath's module graph loads no Node built-in and nothing by a
//    name that is not a literal.
// 3. A published package whose shipped JavaScript imports a compiler subpath
//    that reaches the engine declares `@csszyx/core` (types are not read: a
//    `.d.ts` loads nothing).
// 4. The install closure of the browser packages — `dependencies`,
//    `optionalDependencies`, `bundleDependencies` and required peers, followed
//    through the workspace — holds no `@csszyx/core*`.
//
// It reads `dist`, so the packages must be built first.
//
// Usage: node scripts/check-engine-boundary.mjs

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadsOf, packageOf } from './check-package-deps.mjs';
import { SIZE_BUDGETS } from './check-package-size.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENGINE = '@csszyx/core';

/**
 * Compiler subpaths that run at build time only; every other one ships to the
 * browser. The size gate keeps the list: it leaves exactly these out of the
 * browser budget.
 */
export const BUILD_SUBPATHS = SIZE_BUDGETS.find(
    budget => budget.target === 'packages/compiler',
).excludeSubpaths;
/** The packages an app installs for the browser; none of them may install the engine. */
export const BROWSER_PACKAGES = ['@csszyx/runtime', '@csszyx/dynamic', '@csszyx/types'];

const BUILTINS = new Set(builtinModules);
/**
 * The files an `exports` subpath resolves to, every condition included.
 *
 * @param {unknown} target - One `exports` value.
 * @returns {string[]} Package-relative files.
 */
function exportTargets(target) {
    if (typeof target === 'string') return /\.[cm]?js$/.test(target) ? [target] : [];
    if (target && typeof target === 'object') return Object.values(target).flatMap(exportTargets);
    return [];
}

/**
 * Follow a module's relative imports through its package.
 *
 * @param {string} dir - Package root.
 * @param {string} entry - Package-relative entry file.
 * @returns {Map<string, ReturnType<typeof loadsOf>>} Every module of the graph, by relative path.
 */
export function moduleGraph(dir, entry) {
    const graph = new Map();
    const pending = [path.posix.normalize(entry)];
    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
        if (graph.has(file)) continue;
        const loads = loadsOf(readFileSync(path.join(dir, file), 'utf8'));
        graph.set(file, loads);
        for (const specifier of loads.specifiers) {
            if (specifier.startsWith('.')) {
                pending.push(
                    path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)),
                );
            }
        }
    }
    return graph;
}

/**
 * The first module of a graph that loads a package, and the chain to it.
 *
 * @param {Map<string, ReturnType<typeof loadsOf>>} graph - A module graph.
 * @param {(specifier: string) => boolean} matches - Which loads count.
 * @returns {string | null} `file → specifier`, or null.
 */
function firstLoad(graph, matches) {
    for (const [file, loads] of [...graph].sort(([a], [b]) => a.localeCompare(b))) {
        const hit = loads.specifiers.find(matches);
        if (hit !== undefined) return `${file} loads \`${hit}\``;
    }
    return null;
}

/**
 * Check the compiler's subpaths (rules 1 and 2).
 *
 * @param {string} root - Repository root.
 * @returns {{ problems: string[], engineSubpaths: Set<string> }} What failed, and the subpaths that reach the engine.
 */
export function checkCompilerSubpaths(root) {
    const dir = path.join(root, 'packages/compiler');
    const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const problems = [];
    const engineSubpaths = new Set();
    for (const [subpath, target] of Object.entries(manifest.exports)) {
        for (const file of exportTargets(target)) {
            if (!existsSync(path.join(dir, file))) {
                problems.push(
                    `@csszyx/compiler: ${subpath} resolves to missing ${file}; build it first`,
                );
                continue;
            }
            const graph = moduleGraph(dir, file);
            const engine = firstLoad(graph, spec => packageOf(spec) === ENGINE);
            if (engine) engineSubpaths.add(subpath);
            if (engine && !BUILD_SUBPATHS.slice(1).includes(subpath)) {
                problems.push(`@csszyx/compiler ${subpath} reaches the engine: ${engine}`);
            }
            if (BUILD_SUBPATHS.includes(subpath)) continue;
            const builtin = firstLoad(
                graph,
                spec => spec.startsWith('node:') || BUILTINS.has(spec),
            );
            if (builtin)
                problems.push(`@csszyx/compiler ${subpath} is not browser-pure: ${builtin}`);
            const computed = [...graph].find(([, loads]) => loads.computed);
            if (computed) {
                problems.push(
                    `@csszyx/compiler ${subpath} loads a module by a computed name in ${computed[0]}`,
                );
            }
        }
    }
    return { problems, engineSubpaths };
}

/**
 * Every published workspace manifest, by package name.
 *
 * @param {string} root - Repository root.
 * @returns {Map<string, { dir: string, manifest: Record<string, any> }>} The packages.
 */
function workspacePackages(root) {
    const found = new Map();
    for (const entry of readdirSync(path.join(root, 'packages')).sort()) {
        const file = path.join(root, 'packages', entry, 'package.json');
        if (!existsSync(file)) continue;
        const manifest = JSON.parse(readFileSync(file, 'utf8'));
        if (!manifest.private) found.set(manifest.name, { dir: path.dirname(file), manifest });
    }
    return found;
}

/**
 * The JavaScript files a package ships.
 *
 * @param {string} dir - Package root.
 * @param {string[]} entries - Its `files` entries.
 * @returns {string[]} Package-relative paths.
 */
function shippedJavaScript(dir, entries) {
    const walk = relative => {
        const full = path.join(dir, relative);
        if (!existsSync(full)) return [];
        if (statSync(full).isFile()) return /\.[cm]?js$/.test(relative) ? [relative] : [];
        return readdirSync(full).flatMap(name => walk(path.posix.join(relative, name)));
    };
    return entries.flatMap(walk).filter(file => !/(^|\/)(tests?|node_modules)\//.test(file));
}

/**
 * Packages that import an engine subpath declare the engine (rule 3).
 *
 * @param {string} root - Repository root.
 * @param {Set<string>} engineSubpaths - Compiler subpaths that reach the engine.
 * @returns {string[]} What failed.
 */
export function checkEngineDeclarations(root, engineSubpaths) {
    const problems = [];
    for (const [name, { dir, manifest }] of workspacePackages(root)) {
        if (name === '@csszyx/compiler' || name === ENGINE) continue;
        const declared = {
            ...manifest.dependencies,
            ...manifest.optionalDependencies,
            ...manifest.peerDependencies,
        };
        if (ENGINE in declared) continue;
        for (const file of shippedJavaScript(dir, manifest.files ?? ['.'])) {
            const hit = loadsOf(readFileSync(path.join(dir, file), 'utf8')).specifiers.find(
                spec => {
                    if (packageOf(spec) !== '@csszyx/compiler') return false;
                    const subpath =
                        spec === '@csszyx/compiler'
                            ? '.'
                            : `.${spec.slice('@csszyx/compiler'.length)}`;
                    return engineSubpaths.has(subpath);
                },
            );
            if (hit) {
                problems.push(
                    `${name}: ${file} imports \`${hit}\`, which runs the engine, but ${name} does not declare ${ENGINE}`,
                );
                break;
            }
        }
    }
    return problems;
}

/**
 * The browser packages install no engine (rule 4).
 *
 * @param {string} root - Repository root.
 * @returns {string[]} What failed, one install path each.
 */
export function checkInstallClosure(root) {
    const packages = workspacePackages(root);
    const problems = [];
    for (const start of BROWSER_PACKAGES) {
        const via = new Map([[start, null]]);
        const queue = [start];
        for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
            if (name === ENGINE || name.startsWith(`${ENGINE}-`)) {
                const chain = [];
                for (let at = name; at !== null; at = via.get(at)) chain.unshift(at);
                problems.push(`${start} installs the engine: ${chain.join(' → ')}`);
                break;
            }
            const manifest = packages.get(name)?.manifest;
            if (!manifest) continue;
            const peers = Object.keys(manifest.peerDependencies ?? {}).filter(
                peer => manifest.peerDependenciesMeta?.[peer]?.optional !== true,
            );
            const next = [
                ...Object.keys(manifest.dependencies ?? {}),
                ...Object.keys(manifest.optionalDependencies ?? {}),
                ...(manifest.bundleDependencies ?? manifest.bundledDependencies ?? []),
                ...peers,
            ].sort();
            for (const dep of next) {
                if (via.has(dep)) continue;
                via.set(dep, name);
                queue.push(dep);
            }
        }
    }
    return problems;
}

/**
 * Every rule, over the repository.
 *
 * @param {string} [root] - Repository root.
 * @returns {{ problems: string[], engineSubpaths: string[] }} What failed, and the subpaths that reach the engine.
 */
export function checkEngineBoundary(root = ROOT) {
    const compiler = checkCompilerSubpaths(root);
    return {
        problems: [
            ...compiler.problems,
            ...checkEngineDeclarations(root, compiler.engineSubpaths),
            ...checkInstallClosure(root),
        ],
        engineSubpaths: [...compiler.engineSubpaths].sort(),
    };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const { problems, engineSubpaths } = checkEngineBoundary();
    if (problems.length > 0) {
        console.error(`[engine-boundary] ${problems.length} problem(s):`);
        for (const problem of problems) console.error(`  - ${problem}`);
        process.exit(1);
    }
    console.log(
        `[engine-boundary] only ${engineSubpaths.join(', ')} reach the engine; the browser packages install none.`,
    );
}
