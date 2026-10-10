/**
 * The stylesheet a Vite build's Tailwind reads for an `@import` that is not a
 * path, asked of Vite's own resolver the way the integration asks it.
 *
 * `@tailwindcss/vite` 4.3.3 hands Tailwind a CSS resolver built from Vite's
 * (`config.createResolver` with the resolved `resolve` config, `.css`
 * extensions, the `style` main field and condition, `tryIndex` off,
 * `preferRelative` on), asked first for an alias alone and then in full. So
 * whatever Vite's resolver follows, Tailwind follows: a `resolve.alias` entry
 * of any shape (string, RegExp, a `customResolver`), an alias another plugin
 * added in its `config` hook, tsconfig `paths` under `resolve.tsconfigPaths`,
 * and a bare `gen/theme.css` against the importing folder first. A plugin that
 * resolves in its own `resolveId` hook is not followed: Vite's resolver runs
 * only its alias and resolve plugins. Asking the same resolver is what keeps
 * the walk and the style model on the stylesheets the build compiles; a
 * re-implementation of it drifts.
 *
 * A Vite build that runs Tailwind through `@tailwindcss/postcss` instead
 * inlines each `@import` before Tailwind sees it, through Vite's CSS
 * resolver: the same options without the project's `resolve` config, so it
 * follows `resolve.alias` and never tsconfig `paths`, whatever
 * `resolve.tsconfigPaths` says (measured on Vite 8.3.1).
 *
 * Vite's resolver answers asynchronously and the stylesheet walk is
 * synchronous, so the walk reads the answers through
 * {@link ViteStylesheetResolver.candidates} and {@link settledRead} runs it
 * again until every target it met is answered. The style model's compile
 * awaits each answer itself.
 *
 * @module
 */
import path from 'node:path';

import type { StylesheetImportCandidates } from '@csszyx/tailwind-oracle';

export type { StylesheetImportCandidates };

/** How a Vite build runs Tailwind: its own plugin, or the PostCSS one. */
export type ViteTailwindIntegration = 'vite' | 'postcss';

/**
 * Which Tailwind integration a Vite build runs, from its resolved plugins.
 *
 * `@tailwindcss/vite` registers plugins named `@tailwindcss/vite:…`. Without
 * one, a Tailwind build goes through `@tailwindcss/postcss`, the only other
 * integration Vite runs.
 *
 * @param plugins - The resolved config's `plugins`.
 * @returns The integration.
 */
export function viteTailwindIntegration(plugins: unknown): ViteTailwindIntegration {
    if (!Array.isArray(plugins)) return 'postcss';
    const named = (plugin: unknown): plugin is { name: string } =>
        typeof (plugin as { name?: unknown } | null)?.name === 'string';
    return plugins.some(plugin => named(plugin) && plugin.name.startsWith('@tailwindcss/vite:'))
        ? 'vite'
        : 'postcss';
}

/** Vite's resolver, as `ResolvedConfig.createResolver` returns it. */
type ViteResolveFn = (
    id: string,
    importer?: string,
    aliasOnly?: boolean,
    ssr?: boolean,
) => Promise<string | undefined>;

/** What the resolver reads of Vite's resolved config. */
export interface ViteResolverConfig {
    /** The resolved `resolve` options. */
    resolve?: object;
    /** The resolved `build`; `build.ssr` picks the SSR conditions. */
    build?: { ssr?: unknown };
    /** The resolved plugins, which say which Tailwind integration runs. */
    plugins?: unknown;
    /** Vite's own resolver factory. */
    createResolver(options: object): ViteResolveFn;
}

/**
 * Whether a resolved Vite config carries the resolver factory this reads.
 *
 * Vite 6+ marks `createResolver` deprecated in favour of `createIdResolver`,
 * but it is what `@tailwindcss/vite` 4.3.3 itself calls for the client and SSR
 * environments, and `createIdResolver` does not exist on Vite 5, which the
 * peer range accepts. A host config without it follows no alias.
 *
 * @param config - The resolved config.
 * @returns True when `createResolver` is a function.
 */
export function hasViteResolver(config: object): config is ViteResolverConfig {
    return typeof (config as { createResolver?: unknown }).createResolver === 'function';
}

/** The options both integrations give Vite's resolver for a stylesheet. */
const STYLESHEET_RESOLVE = {
    extensions: ['.css'],
    mainFields: ['style'],
    conditions: ['style', 'development|production'],
    tryIndex: false,
    preferRelative: true,
};

/**
 * One integration's question to Vite's resolver, for one target.
 *
 * @param config - The resolved config.
 * @param integration - How the build runs Tailwind.
 * @returns The stylesheet Tailwind reads, or null when the resolver names
 *          none and Tailwind falls back to its own.
 */
function stylesheetResolve(
    config: ViteResolverConfig,
    integration: ViteTailwindIntegration,
): (specifier: string, fromDir: string) => Promise<string | null> {
    const ssr = config.build?.ssr !== undefined && config.build.ssr !== false;
    if (integration === 'postcss') {
        // Vite's CSS plugin: one full resolve, from the importing file.
        const resolve = config.createResolver(STYLESHEET_RESOLVE);
        return async (specifier, fromDir) => {
            const resolved = await resolve(
                specifier,
                path.join(fromDir, '__placeholder__.css'),
                false,
                ssr,
            );
            return resolved ? path.resolve(resolved) : null;
        };
    }
    // `@tailwindcss/vite` 4.3.3: the alias alone, then in full, from a
    // placeholder importer; an answer is kept when it moved, is absolute once
    // a relative one is taken against the folder, and names a `.css` file.
    const resolve = config.createResolver({ ...config.resolve, ...STYLESHEET_RESOLVE });
    return async (specifier, fromDir) => {
        const importer = path.resolve(fromDir, '__placeholder__.ts');
        const kept = (resolved: string | undefined): string | null => {
            if (!resolved || resolved === specifier) return null;
            const absolute = resolved.startsWith('.') ? path.resolve(fromDir, resolved) : resolved;
            return absolute.endsWith('.css') && path.isAbsolute(absolute) ? absolute : null;
        };
        // In order: the full resolve only when the alias alone kept nothing.
        return (
            kept(await resolve(specifier, importer, true, ssr)) ??
            kept(await resolve(specifier, importer, false, ssr))
        );
    };
}

/**
 * Whether a target is one of Tailwind's own stylesheets. Those are a
 * package's, which the walk never reads and the compile loads itself: asking
 * Vite about them would cost every project a second walk for an answer
 * nobody reads.
 *
 * @param specifier - The target as written.
 * @returns True for `tailwindcss` and a path inside it.
 */
function isTailwindStylesheet(specifier: string): boolean {
    return specifier === 'tailwindcss' || specifier.startsWith('tailwindcss/');
}

/** Vite's resolver for stylesheet imports, readable by a synchronous walk. */
export interface ViteStylesheetResolver {
    /**
     * The answers known so far, for the walk and the compile. A target not
     * asked yet reads as none and is noted for {@link settle}; the compile's
     * `load` asks Vite for it and waits.
     */
    readonly candidates: StylesheetImportCandidates;
    /**
     * Ask Vite about every target read since the last settle that it has not
     * been asked about.
     *
     * @returns Whether one of them names a file, so a read made before it is
     *          stale.
     */
    settle(): Promise<boolean>;
    /**
     * Forget every target Vite named no file for, and the Vite resolver that
     * keeps those misses, so the next read asks a new one. For a dev server
     * whose watcher reports a stylesheet created: it may be the file a miss
     * was about.
     */
    forgetMisses(): void;
}

/**
 * Vite's resolver for a build's stylesheet imports, the way its Tailwind
 * integration asks it.
 *
 * @param config - The resolved config.
 * @param integration - How the build runs Tailwind; read from the config's
 *        plugins when omitted.
 * @returns The resolver.
 */
export function viteStylesheetResolver(
    config: ViteResolverConfig,
    integration: ViteTailwindIntegration = viteTailwindIntegration(config.plugins),
): ViteStylesheetResolver {
    let resolve = stylesheetResolve(config, integration);
    const answers = new Map<string, string | null>();
    const unanswered = new Map<string, readonly [string, string]>();
    const keyOf = (specifier: string, fromDir: string): string => `${fromDir}\0${specifier}`;
    // One answer per target until a stylesheet is created. Vite's resolver
    // caches a miss itself (measured on 8.3.1: a file written after a failed
    // lookup stays unresolved until a new resolver is made), so asking it
    // again would not change the answer; `forgetMisses` makes a new one.
    const read = (specifier: string, fromDir: string): readonly string[] => {
        if (isTailwindStylesheet(specifier)) return [];
        const key = keyOf(specifier, fromDir);
        const answer = answers.get(key);
        if (answer === undefined) unanswered.set(key, [specifier, fromDir]);
        return answer ? [answer] : [];
    };
    const load = async (specifier: string, fromDir: string): Promise<readonly string[]> => {
        if (isTailwindStylesheet(specifier)) return [];
        const key = keyOf(specifier, fromDir);
        let answer = answers.get(key);
        if (answer === undefined) {
            answer = await resolve(specifier, fromDir);
            answers.set(key, answer);
        }
        return answer === null ? [] : [answer];
    };
    return {
        candidates: Object.assign(read, { load }),
        async settle() {
            const asked = [...unanswered];
            unanswered.clear();
            const resolved = await Promise.all(
                asked.map(([, [specifier, fromDir]]) => resolve(specifier, fromDir)),
            );
            let changed = false;
            for (const [index, [key]] of asked.entries()) {
                const answer = resolved[index] as string | null;
                if (answer !== null) changed = true;
                answers.set(key, answer);
            }
            return changed;
        },
        forgetMisses() {
            for (const [key, answer] of answers) if (answer === null) answers.delete(key);
            resolve = stylesheetResolve(config, integration);
        },
    };
}

/**
 * Run a synchronous read of the project's stylesheets until every import
 * target it met has Vite's answer.
 *
 * A read meets a target, Vite answers it, and the read runs again with the
 * answer; it ends once a settle names no file. Each target is asked once, so
 * the reads are bounded by the targets: one read for a project with no
 * aliased import, two for one that has some, one more per level an aliased
 * stylesheet imports through another alias.
 *
 * @param resolver - The lane's resolver; a lane with none reads once.
 * @param readStylesheets - The read, repeatable.
 * @returns What the last read returned.
 */
export async function settledRead<T>(
    resolver: ViteStylesheetResolver | undefined,
    readStylesheets: () => T,
): Promise<T> {
    const result = readStylesheets();
    if (resolver === undefined || !(await resolver.settle())) return result;
    return settledRead(resolver, readStylesheets);
}
