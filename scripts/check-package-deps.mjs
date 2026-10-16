#!/usr/bin/env node
// Declared-dependency gate for the published packages.
//
// A package's `dependencies` decide what every install downloads, and its
// shipped files decide what actually loads. The two drift apart silently in
// both directions: `@csszyx/runtime` declared `@csszyx/core` from the first
// release while no runtime file ever imported it, and nothing fails when a
// shipped file imports a package the manifest does not declare until a
// strict installer (pnpm, Yarn PnP) refuses to resolve it for a user.
//
// The script reads the files each published package ships (its `files`
// entries; the whole package minus tests when there are none), collects the
// bare specifiers they import with TypeScript's own pre-processor (comments
// and string contents are not imports), and compares the package names with
// `dependencies`, `optionalDependencies` and `peerDependencies`:
//
// - an import of an undeclared package fails (a phantom dependency), unless
//   `EXPECTED_UNDECLARED` names it with the reason;
// - a declared package no shipped file imports fails (an unused dependency),
//   unless it supplies a required peer of another declared dependency, is a
//   platform binding of the package (`<name>-<platform>`, loaded by a computed
//   name), or `EXPECTED_UNIMPORTED` names it with the reason.
//
// It reads `dist`, so the packages must be built first (`pnpm build`); a
// package whose shipped files are missing fails rather than passing empty.
//
// Usage: node scripts/check-package-deps.mjs

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Declared packages no shipped file imports, kept on purpose. Keyed by package
 * name, then by dependency, with the reason.
 */
export const EXPECTED_UNIMPORTED = {
    '@csszyx/vue-adapter': {
        vue: 'optional peer stating the supported Vue major; the adapter reads SFC text and never loads vue',
    },
};

/**
 * Imported packages left undeclared on purpose. Keyed by package name, then by
 * dependency, with the reason.
 */
export const EXPECTED_UNDECLARED = {
    '@csszyx/types': {
        '@csszyx/compiler': 'type-only: the declarations re-export the sz types from the compiler',
    },
};

/** File extensions read as modules. Source maps and assets are skipped. */
const MODULE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx']);

/** Paths a package never ships, even when `files` is absent and npm would pack them. */
const NOT_SHIPPED =
    /(^|\/)(node_modules|tests?|__tests__)(\/|$)|\.(test|spec|type-test)\.[cm]?[jt]sx?$|(^|\/)(vitest|vite|tsdown)\.config\.[cm]?[jt]s$/;

const BUILTINS = new Set(builtinModules);

/**
 * The package a bare specifier names, or `null` for a relative path, an
 * absolute path, a URL or scheme (`node:`, `virtual:`), a subpath import or a
 * Node built-in.
 *
 * @param {string} specifier - An import specifier as written.
 * @returns {string | null} The package name.
 */
export function packageOf(specifier) {
    if (/^[./#]|^[a-z][a-z0-9+.-]*:/i.test(specifier)) return null;
    const parts = specifier.split('/');
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    return BUILTINS.has(name) ? null : name;
}

/**
 * Every bare package one module's source imports: static and dynamic
 * `import`, `export … from`, `require()`, `require.resolve()`, `import()`
 * types and `/// <reference types>`.
 *
 * @param {string} source - Module text.
 * @returns {Set<string>} Package names.
 */
export function importedPackages(source) {
    const info = ts.preProcessFile(source, true, true);
    const specifiers = [...info.importedFiles, ...info.typeReferenceDirectives].map(
        ref => ref.fileName,
    );
    // `preProcessFile` reads `require('x')` but not `require.resolve('x')`.
    for (const match of source.matchAll(/\brequire\.resolve\(\s*(['"])([^'"\n]+)\1/g)) {
        specifiers.push(match[2]);
    }
    return new Set(specifiers.map(packageOf).filter(name => name !== null));
}

/**
 * Compares what a package declares with what its shipped files import.
 *
 * @param {object} pkg - The package.
 * @param {string} pkg.name - Package name.
 * @param {Record<string, string>} pkg.declared - Declared name → field it is declared in.
 * @param {ReadonlyMap<string, readonly string[]>} pkg.imports - Imported package → files importing it.
 * @param {ReadonlySet<string>} [pkg.peersOfDeps] - Required peers of its declared dependencies.
 * @param {Record<string, string>} [pkg.unimported] - Its `EXPECTED_UNIMPORTED` entry.
 * @param {Record<string, string>} [pkg.undeclared] - Its `EXPECTED_UNDECLARED` entry.
 * @returns {string[]} One message per problem; empty when the package is clean.
 */
export function compare({
    name,
    declared,
    imports,
    peersOfDeps = new Set(),
    unimported = {},
    undeclared = {},
}) {
    const problems = [];
    for (const [dep, files] of imports) {
        if (dep === name || dep in declared || dep in undeclared) continue;
        problems.push(`${name}: imports \`${dep}\` (${files[0]}) but does not declare it`);
    }
    for (const [dep, field] of Object.entries(declared)) {
        if (imports.has(dep) || peersOfDeps.has(dep) || dep in unimported) continue;
        if (field === 'optionalDependencies' && dep.startsWith(`${name}-`)) continue;
        problems.push(`${name}: declares \`${dep}\` in ${field} but no shipped file imports it`);
    }
    for (const dep of Object.keys(unimported)) {
        if (imports.has(dep) || !(dep in declared)) {
            problems.push(`${name}: EXPECTED_UNIMPORTED entry \`${dep}\` is stale`);
        }
    }
    for (const dep of Object.keys(undeclared)) {
        if (!imports.has(dep) || dep in declared) {
            problems.push(`${name}: EXPECTED_UNDECLARED entry \`${dep}\` is stale`);
        }
    }
    return problems;
}

/**
 * Module files under one `files` entry, skipping what a package does not ship.
 *
 * @param {string} dir - Package root.
 * @param {string} entry - A `files` entry, relative to the root.
 * @returns {string[]} Paths relative to the package root.
 */
function shippedModules(dir, entry) {
    const full = path.join(dir, entry);
    if (!existsSync(full) || NOT_SHIPPED.test(entry)) return [];
    if (statSync(full).isFile()) return MODULE_EXTENSIONS.has(path.extname(entry)) ? [entry] : [];
    return readdirSync(full, { withFileTypes: true }).flatMap(child =>
        child.isDirectory() || child.isFile()
            ? shippedModules(dir, path.posix.join(entry, child.name))
            : [],
    );
}

/**
 * Reads a manifest as JSON, or `null` when it is not there.
 *
 * @param {string} file - Path to a `package.json`.
 * @returns {Record<string, any> | null} The manifest.
 */
function readManifest(file) {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/**
 * The non-optional peers of a package's declared dependencies, read from the
 * installed manifests next to it.
 *
 * @param {string} dir - Package root.
 * @param {Iterable<string>} deps - Its declared dependencies.
 * @returns {Set<string>} Peer names.
 */
function requiredPeersOf(dir, deps) {
    const peers = new Set();
    for (const dep of deps) {
        const manifest = readManifest(path.join(dir, 'node_modules', dep, 'package.json'));
        for (const peer of Object.keys(manifest?.peerDependencies ?? {})) {
            if (manifest.peerDependenciesMeta?.[peer]?.optional !== true) peers.add(peer);
        }
    }
    return peers;
}

/**
 * Reads one package directory.
 *
 * @param {string} dir - Absolute package directory.
 * @returns {{ name: string, declared: Record<string, string>, imports: Map<string, string[]>, peersOfDeps: Set<string>, files: number } | null}
 *   The package, or `null` when it is private or ships only native binaries.
 */
export function readPackage(dir) {
    const manifest = readManifest(path.join(dir, 'package.json'));
    const entries = manifest.files ?? ['.'];
    if (manifest.private || entries.every(entry => entry.endsWith('.node'))) return null;
    const declared = {};
    for (const field of ['peerDependencies', 'optionalDependencies', 'dependencies']) {
        for (const dep of Object.keys(manifest[field] ?? {})) declared[dep] = field;
    }
    const imports = new Map();
    const files = entries.flatMap(entry => shippedModules(dir, entry));
    for (const file of files) {
        for (const dep of importedPackages(readFileSync(path.join(dir, file), 'utf8'))) {
            imports.set(dep, [...(imports.get(dep) ?? []), file]);
        }
    }
    const peersOfDeps = requiredPeersOf(dir, Object.keys(manifest.dependencies ?? {}));
    return { name: manifest.name, declared, imports, peersOfDeps, files: files.length };
}

/**
 * Checks every published package under `packages/`.
 *
 * @param {string} [root] - Repository root.
 * @returns {{ problems: string[], checked: number }} What failed, and how many packages were read.
 */
export function checkAll(root = ROOT) {
    const packagesDir = path.join(root, 'packages');
    const problems = [];
    const seen = new Set();
    for (const entry of readdirSync(packagesDir).sort()) {
        const dir = path.join(packagesDir, entry);
        if (!existsSync(path.join(dir, 'package.json'))) continue;
        const pkg = readPackage(dir);
        if (pkg === null) continue;
        seen.add(pkg.name);
        if (pkg.files === 0) {
            problems.push(`${pkg.name}: ships no module files; build it first`);
            continue;
        }
        problems.push(
            ...compare({
                ...pkg,
                unimported: EXPECTED_UNIMPORTED[pkg.name],
                undeclared: EXPECTED_UNDECLARED[pkg.name],
            }),
        );
    }
    for (const name of Object.keys({ ...EXPECTED_UNIMPORTED, ...EXPECTED_UNDECLARED })) {
        if (!seen.has(name))
            problems.push(`an allowlist names \`${name}\`, which is not a published package here`);
    }
    return { problems, checked: seen.size };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const { problems, checked } = checkAll();
    if (problems.length > 0) {
        console.error(`[package-deps] ${problems.length} problem(s):`);
        for (const problem of problems) console.error(`  - ${problem}`);
        process.exit(1);
    }
    console.log(
        `[package-deps] ${checked} published packages: declared dependencies match their imports.`,
    );
}
