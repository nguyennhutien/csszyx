/**
 * Resolve what a stylesheet asks for the way the project's own Tailwind does.
 *
 * Tailwind's bundler integrations (`@tailwindcss/vite`, `postcss`, `webpack`,
 * `cli`) all resolve through `@tailwindcss/node`: an `@import` with the `style`
 * export condition, and a `@plugin` or `@config` module through jiti. A narrower
 * resolver fails on stylesheets the build compiles — a package exporting its
 * CSS only under `style`, a TypeScript plugin with extensionless imports — and
 * the check then skips a project whose CSS is fine.
 *
 * Only the resolver and the module loader are borrowed. `@tailwindcss/node`
 * pins its own Tailwind, so the design system itself is still compiled by the
 * Tailwind the project resolves.
 *
 * @module
 */
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** One bundler or tsconfig alias: a literal prefix, or an exact specifier. */
export interface StylesheetAlias {
    /** Literal prefix, or the whole specifier when {@link exact}. */
    find: string;
    /** Absolute path the prefix expands to. */
    replacement: string;
    /** Whether the specifier must equal `find` rather than begin with it. */
    exact: boolean;
}

/** A plugin or config module handed back to Tailwind's loader. */
export interface ProjectModule {
    path: string;
    base: string;
    module: unknown;
}

/** What the project's Tailwind integration offers for resolution. */
export interface ProjectResolver {
    /** Resolve a stylesheet specifier from a directory, or throw naming it. */
    resolveStylesheet(id: string, base: string): string;
    /** Load a module the way Tailwind loads `@plugin` and `@config`. */
    loadModule(id: string, base: string): Promise<ProjectModule>;
}

/** Packages that carry `@tailwindcss/node`, in the order a project most often has them. */
const INTEGRATIONS = [
    '@tailwindcss/vite',
    '@tailwindcss/postcss',
    '@tailwindcss/webpack',
    '@tailwindcss/cli',
];

/** Resolvers by project directory: resolving `@tailwindcss/node` walks the tree. */
const cache = new Map<string, Promise<ProjectResolver | null>>();

/**
 * Apply the first alias whose `find` matches the specifier.
 *
 * @param id - Import specifier as written.
 * @param aliases - The bundler's aliases, tsconfig paths included.
 * @returns The expanded path, or null when no alias matches.
 */
export function expandAlias(id: string, aliases: readonly StylesheetAlias[]): string | null {
    for (const alias of aliases) {
        if (alias.exact ? id === alias.find : id.startsWith(alias.find)) {
            return alias.exact
                ? alias.replacement
                : alias.replacement + id.slice(alias.find.length);
        }
    }
    return null;
}

/**
 * The path `@tailwindcss/node` resolves to from the project, directly or
 * through the integration that depends on it.
 *
 * @param resolveFrom - Project directory whose `package.json` anchors resolution.
 * @returns The module path, or null when the project carries none.
 */
function findTailwindNode(resolveFrom: string): string | null {
    const project = createRequire(path.join(resolveFrom, 'package.json'));
    for (const via of [null, ...INTEGRATIONS]) {
        try {
            const from = via === null ? project : createRequire(project.resolve(via));
            return from.resolve('@tailwindcss/node');
        } catch {
            // Not this route; a strict layout reaches it only through an integration.
        }
    }
    return null;
}

/** The slice of `enhanced-resolve` this module uses. */
interface EnhancedResolve {
    ResolverFactory: {
        createResolver(options: Record<string, unknown>): {
            resolveSync(context: object, base: string, id: string): string | false;
        };
    };
    CachedInputFileSystem: new (fileSystem: typeof fs, duration: number) => unknown;
}

/** The slice of `@tailwindcss/node` this module uses. */
interface TailwindNode {
    loadModule(
        id: string,
        base: string,
        onDependency: (file: string) => void,
    ): Promise<ProjectModule>;
}

/**
 * Build the resolver the project's Tailwind integration would use.
 *
 * @param resolveFrom - Project directory whose `package.json` anchors resolution.
 * @returns The resolver, or null when the project has no Tailwind integration.
 */
async function createProjectResolver(resolveFrom: string): Promise<ProjectResolver | null> {
    const nodePath = findTailwindNode(resolveFrom);
    if (nodePath === null) return null;
    try {
        const node = (await import(pathToFileURL(nodePath).href)) as TailwindNode & {
            default?: TailwindNode;
        };
        const loadModule = node.loadModule ?? node.default?.loadModule;
        const enhanced = createRequire(nodePath)('enhanced-resolve') as EnhancedResolve;
        if (typeof loadModule !== 'function') return null;
        const css = enhanced.ResolverFactory.createResolver({
            fileSystem: new enhanced.CachedInputFileSystem(fs, 4000),
            useSyncFileSystemCalls: true,
            extensions: ['.css'],
            mainFields: ['style'],
            conditionNames: ['style'],
            // CSS reads `@import "theme.css"` as the file next door before a package.
            preferRelative: true,
        });
        return {
            resolveStylesheet(id, base) {
                const resolved = css.resolveSync({}, base, id);
                /* v8 ignore next -- narrowing only: false comes from a browser-field alias, which a style resolver never reads. */
                if (resolved === false) throw new Error(`Cannot resolve '${id}' from ${base}`);
                return resolved;
            },
            loadModule: (id, base) => loadModule(id, base, () => {}),
        };
    } catch {
        return null;
    }
}

/**
 * The project's resolver, built once per project directory.
 *
 * @param resolveFrom - Project directory whose `package.json` anchors resolution.
 * @returns The resolver, or null when the project has no Tailwind integration.
 */
export function projectResolver(resolveFrom: string): Promise<ProjectResolver | null> {
    let resolver = cache.get(resolveFrom);
    if (resolver === undefined) {
        resolver = createProjectResolver(resolveFrom);
        cache.set(resolveFrom, resolver);
    }
    return resolver;
}
