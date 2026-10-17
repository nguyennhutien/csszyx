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
//   unless it supplies a peer of another declared dependency, is a
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
export const EXPECTED_UNIMPORTED = {};

/**
 * Imported packages left undeclared on purpose. Keyed by package name, then by
 * dependency, with the reason.
 */
export const EXPECTED_UNDECLARED = {};

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
 * What one module loads: specifiers by literal, plus whether it loads anything
 * by a computed name.
 *
 * `ts.preProcessFile` reads `import`, `export … from`, `require()` and
 * `import()`. A module can also load through `require.resolve('…')`, a
 * `createRequire` result under any name containing `require`
 * (`requireFromHere('…')`) or a peer request object (`request: '…'`), so those
 * literals count too. A name in a message string is not a load.
 *
 * @param {string} source - Module text.
 * @returns {{ specifiers: string[], computed: boolean }} What it loads.
 */
export function loadsOf(source) {
    const info = ts.preProcessFile(source, true, true);
    const specifiers = [...info.importedFiles, ...info.typeReferenceDirectives].map(
        ref => ref.fileName,
    );
    // `preProcessFile` reads `require('x')` but not `require.resolve('x')`.
    for (const match of source.matchAll(/\brequire\.resolve\(\s*(['"])([^'"\n]+)\1/g)) {
        specifiers.push(match[2]);
    }
    for (const match of source.matchAll(/\b\w*[rR]equire\w*\(\s*(['"])([^'"\n]+)\1/g)) {
        specifiers.push(match[2]);
    }
    for (const match of source.matchAll(/\brequest:\s*(['"])([^'"\n]+)\1/g)) {
        specifiers.push(match[2]);
    }
    const computed =
        /\bcreateRequire\b/.test(source) ||
        /\bimport\(\s*[^'"`\s)]/.test(source) ||
        /\brequire\(\s*[^'"`\s)]/.test(source);
    return { specifiers: [...new Set(specifiers)], computed };
}

/**
 * Every bare package one module's source loads: what {@link loadsOf} reads,
 * `/// <reference types>` included.
 *
 * @param {string} source - Module text.
 * @returns {Set<string>} Package names.
 */
export function importedPackages(source) {
    return new Set(
        loadsOf(source)
            .specifiers.map(packageOf)
            .filter(name => name !== null),
    );
}

/**
 * Compares what a package declares with what its shipped files import.
 *
 * @param {object} pkg - The package.
 * @param {string} pkg.name - Package name.
 * @param {Record<string, string>} pkg.declared - Declared name → field it is declared in.
 * @param {ReadonlyMap<string, readonly string[]>} pkg.imports - Imported package → files importing it.
 * @param {ReadonlySet<string>} [pkg.peersOfDeps] - Peers of its declared dependencies.
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
 * The peers of a package's declared dependencies, read from the installed
 * manifests next to it. An optional peer counts: declaring it is how a package
 * supplies it, as a package calling `@csszyx/compiler/engine` supplies the
 * compiler's optional `@csszyx/core`.
 *
 * @param {string} dir - Package root.
 * @param {Iterable<string>} deps - Its declared dependencies.
 * @returns {Set<string>} Peer names.
 */
function peersOf(dir, deps) {
    const peers = new Set();
    for (const dep of deps) {
        const manifest = readManifest(path.join(dir, 'node_modules', dep, 'package.json'));
        for (const peer of Object.keys(manifest?.peerDependencies ?? {})) peers.add(peer);
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
    const peersOfDeps = peersOf(dir, Object.keys(manifest.dependencies ?? {}));
    return { name: manifest.name, declared, imports, peersOfDeps, files: files.length };
}

/**
 * Checks every published package under `packages/`.
 *
 * @param {string} [root] - Repository root.
 * @param {object} [allowlists] - The allowlists to apply; the repository's by default.
 * @param {Record<string, Record<string, string>>} [allowlists.unimported] - In place of `EXPECTED_UNIMPORTED`.
 * @param {Record<string, Record<string, string>>} [allowlists.undeclared] - In place of `EXPECTED_UNDECLARED`.
 * @returns {{ problems: string[], checked: number }} What failed, and how many packages were read.
 */
export function checkAll(
    root = ROOT,
    { unimported = EXPECTED_UNIMPORTED, undeclared = EXPECTED_UNDECLARED } = {},
) {
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
                unimported: unimported[pkg.name],
                undeclared: undeclared[pkg.name],
            }),
        );
    }
    for (const name of Object.keys({ ...unimported, ...undeclared })) {
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
