/**
 * Alias tables for cross-module specifier resolution.
 *
 * The registry resolves what a file imports against paths the prescan walked.
 * A relative specifier needs nothing but `path.resolve`; `@/styles` needs to
 * know what `@` stands for, and only the project can say. Two sources answer
 * that, and a project may use either or both:
 *
 * - the bundler's own `resolve.alias`, which is what actually resolves the
 *   import at build time on the vite and webpack lanes;
 * - `compilerOptions.paths` in `tsconfig.json`, which is the only source on a
 *   lane whose alias handling is a resolver plugin rather than an alias table —
 *   Next.js maps `@/*` that way, so a webpack alias table there is empty.
 *
 * Nothing here touches the module graph or the filesystem to VERIFY a mapping.
 * An alias that expands to a path the prescan never saw simply matches no
 * registry key, and the importer keeps the runtime path it would have had. So
 * a wrong or over-broad alias costs an optimization, never a wrong compile —
 * which is what makes prefix matching safe enough to keep this cheap.
 *
 * @module specifier-aliases
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { normalizePathSeparators } from './path-normalization.js';

/** One specifier prefix and the absolute location it stands for. */
export interface SpecifierAlias {
    /** Literal prefix, or the whole specifier when {@link exact}. */
    find: string;
    /** Absolute path (forward slashes) the prefix expands to. */
    replacement: string;
    /** Whether the specifier must equal `find` rather than begin with it. */
    exact: boolean;
}

/** Config filenames read for `paths`, in the order they are tried. */
const TSCONFIG_CANDIDATES = ['tsconfig.json', 'jsconfig.json', 'tsconfig.app.json'] as const;

/** How many `extends` hops are followed before giving up. */
const MAX_EXTENDS_DEPTH = 8;

/**
 * Build the alias table for one project.
 *
 * @param rootDir - Project root the bundler reported.
 * @param resolveAlias - The bundler's `resolve.alias`, in any of its shapes.
 * @returns Aliases in match order: the bundler's first, then tsconfig's.
 */
export function collectSpecifierAliases(rootDir: string, resolveAlias?: unknown): SpecifierAlias[] {
    return [...aliasesFromResolveConfig(rootDir, resolveAlias), ...aliasesFromTsconfig(rootDir)];
}

/**
 * Read a bundler `resolve.alias` value into the table.
 *
 * Both shapes appear in the wild: vite normalizes to an array of
 * `{ find, replacement }`, webpack keeps the object form and marks an exact
 * match with a trailing `$`. A `find` given as a RegExp is skipped — honouring
 * it would mean running the pattern and splicing its captures, and the payoff
 * is an optimization that already degrades safely.
 *
 * @param rootDir - Project root, for resolving relative replacements.
 * @param raw - The bundler's `resolve.alias`.
 * @returns Aliases in declared order.
 */
export function aliasesFromResolveConfig(rootDir: string, raw: unknown): SpecifierAlias[] {
    const aliases: SpecifierAlias[] = [];
    if (Array.isArray(raw)) {
        for (const entry of raw) {
            const find = (entry as { find?: unknown }).find;
            const replacement = (entry as { replacement?: unknown }).replacement;
            if (typeof find !== 'string' || typeof replacement !== 'string') continue;
            aliases.push(makeAlias(rootDir, find, replacement));
        }
        return aliases;
    }
    if (raw === null || typeof raw !== 'object') return aliases;
    for (const [find, target] of Object.entries(raw as Record<string, unknown>)) {
        // webpack accepts an array of fallbacks and `false` to mark a specifier
        // unresolvable; the first is worth probing in order, the second maps to
        // nothing by definition.
        for (const value of Array.isArray(target) ? target : [target]) {
            if (typeof value !== 'string') continue;
            aliases.push(makeAlias(rootDir, find, value));
        }
    }
    return aliases;
}

/**
 * Turn one declared mapping into a table entry.
 *
 * @param rootDir - Project root, for resolving a relative replacement.
 * @param find - Specifier prefix as declared, `$` suffix included.
 * @param replacement - Path the prefix expands to.
 * @returns The normalized entry.
 */
function makeAlias(rootDir: string, find: string, replacement: string): SpecifierAlias {
    const exact = find.endsWith('$');
    return {
        find: exact ? find.slice(0, -1) : find,
        replacement: absolute(rootDir, replacement),
        exact,
    };
}

/**
 * Read `compilerOptions.paths` from the project's TypeScript config.
 *
 * @param rootDir - Project root.
 * @returns Aliases from the first config file that declares `paths`.
 */
export function aliasesFromTsconfig(rootDir: string): SpecifierAlias[] {
    for (const candidate of TSCONFIG_CANDIDATES) {
        const loaded = loadPathsConfig(path.join(rootDir, candidate), 0);
        if (loaded === undefined) continue;
        const aliases = pathsToAliases(loaded.base, loaded.paths);
        if (aliases.length > 0) return aliases;
    }
    return [];
}

/** A config file's `paths` together with the directory they resolve against. */
interface PathsConfig {
    base: string;
    paths: Record<string, unknown>;
}

/**
 * Load `paths` from one config file, following relative `extends`.
 *
 * The nearest file that declares `paths` wins, and its own `baseUrl` — or its
 * directory when it declares none, which is what TypeScript does since 5.0 —
 * is what those paths resolve against. An `extends` naming a package is not
 * followed: locating it means running node resolution from the config's
 * directory, and a missed alias degrades to today's behaviour.
 *
 * @param configPath - Absolute path of the config file.
 * @param depth - Current `extends` depth.
 * @returns The paths and their base, or undefined when there are none.
 */
function loadPathsConfig(configPath: string, depth: number): PathsConfig | undefined {
    if (depth > MAX_EXTENDS_DEPTH) return undefined;
    let parsed: Record<string, unknown>;
    try {
        parsed = parseJsonc(fs.readFileSync(configPath, 'utf-8'));
    } catch {
        return undefined;
    }
    const directory = path.dirname(configPath);
    const compilerOptions = asRecord(parsed.compilerOptions);
    const paths = asRecord(compilerOptions?.paths);
    if (paths !== undefined) {
        const baseUrl = compilerOptions?.baseUrl;
        return {
            base:
                typeof baseUrl === 'string'
                    ? absolute(directory, baseUrl)
                    : absolute(directory, '.'),
            paths,
        };
    }
    const extended = parsed.extends;
    if (typeof extended !== 'string' || !extended.startsWith('.')) return undefined;
    const resolved = path.resolve(directory, extended);
    return loadPathsConfig(resolved, depth + 1) ?? loadPathsConfig(`${resolved}.json`, depth + 1);
}

/**
 * Convert TypeScript path patterns into table entries.
 *
 * Only a pattern whose wildcard is its last character is translated. TypeScript
 * allows `*` anywhere, but a prefix table cannot express a mapping with text
 * after the wildcard, and inventing one would resolve specifiers to paths the
 * project never meant.
 *
 * @param base - Directory the targets resolve against.
 * @param paths - The declared `paths` object.
 * @returns Aliases, each target kept as its own probe in declared order.
 */
function pathsToAliases(base: string, paths: Record<string, unknown>): SpecifierAlias[] {
    const aliases: SpecifierAlias[] = [];
    for (const [pattern, targets] of Object.entries(paths)) {
        const wildcard = pattern.indexOf('*');
        if (wildcard !== -1 && wildcard !== pattern.length - 1) continue;
        const exact = wildcard === -1;
        const find = exact ? pattern : pattern.slice(0, -1);
        for (const target of Array.isArray(targets) ? targets : [targets]) {
            if (typeof target !== 'string') continue;
            const body = target.endsWith('*') ? target.slice(0, -1) : target;
            aliases.push({ find, replacement: absolute(base, body), exact });
        }
    }
    return aliases;
}

/**
 * Every absolute path a non-relative specifier may denote.
 *
 * Order is the table's own: a specifier matching two aliases is probed against
 * both, and the caller stops at whichever answers first.
 *
 * @param specifier - Specifier as written in the import.
 * @param aliases - The project's alias table.
 * @returns Candidate paths, empty when no alias matches.
 */
export function aliasedSpecifierBases(
    specifier: string,
    aliases: readonly SpecifierAlias[],
): string[] {
    const bases: string[] = [];
    for (const alias of aliases) {
        if (alias.exact) {
            if (specifier === alias.find) bases.push(alias.replacement);
            continue;
        }
        if (!specifier.startsWith(alias.find)) continue;
        bases.push(normalizePathSeparators(alias.replacement + specifier.slice(alias.find.length)));
    }
    return bases;
}

/**
 * Resolve a path against a directory and normalize its separators.
 *
 * The declared trailing separator is put back. `path.resolve` drops it, and a
 * prefix alias is completed by CONCATENATION — `@/` mapped to `./src/` would
 * expand `@/styles` to `src` + `styles` and quietly resolve nothing. Whether
 * the separator belongs is the project's statement, not this function's guess:
 * webpack's `{'@': './src'}` is completed by the specifier's own `/`.
 *
 * @param directory - Directory a relative path resolves against.
 * @param target - Path as declared.
 * @returns Absolute path using forward slashes.
 */
function absolute(directory: string, target: string): string {
    const resolved = normalizePathSeparators(path.resolve(directory, target));
    const declaredTrailingSlash = target.endsWith('/') || target.endsWith('\\');
    return declaredTrailingSlash && !resolved.endsWith('/') ? `${resolved}/` : resolved;
}

/**
 * Read one value as a plain object, or report that it is not one.
 *
 * @param value - Parsed JSON value.
 * @returns The object, or undefined.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

/**
 * Parse a config file that may carry comments and trailing commas.
 *
 * `tsconfig.json` is JSON with comments, and every scaffold ships one with
 * them. A character scan rather than a regex sweep because the two constructs
 * that must NOT be treated as comments — a `//` inside a string, an escaped
 * quote — are exactly what a pattern gets wrong.
 *
 * @param text - File contents.
 * @returns The parsed object.
 */
function parseJsonc(text: string): Record<string, unknown> {
    let out = '';
    let inString = false;
    let index = 0;
    while (index < text.length) {
        const char = text[index];
        if (inString) {
            if (char === '\\') {
                out += char + (text[index + 1] ?? '');
                index += 2;
                continue;
            }
            if (char === '"') inString = false;
            out += char;
            index++;
            continue;
        }
        if (char === '"') {
            inString = true;
            out += char;
            index++;
            continue;
        }
        if (char === '/' && text[index + 1] === '/') {
            while (index < text.length && text[index] !== '\n') index++;
            continue;
        }
        if (char === '/' && text[index + 1] === '*') {
            index += 2;
            while (index < text.length && !(text[index] === '*' && text[index + 1] === '/'))
                index++;
            index += 2;
            continue;
        }
        out += char;
        index++;
    }
    const parsed: unknown = JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
    return asRecord(parsed) ?? {};
}
