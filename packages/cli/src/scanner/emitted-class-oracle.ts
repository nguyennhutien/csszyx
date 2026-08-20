/**
 * Ask Tailwind whether the classes csszyx emitted actually produce CSS.
 *
 * csszyx owns the `sz` → class mapping but NOT the class vocabulary — Tailwind
 * does, and it moves between minors. Rather than re-implement Tailwind's
 * grammar, this loads the project's own design system and asks
 * `candidatesToCss`: a `null` answer means the class styles nothing.
 *
 * Two things make the answer trustworthy for a user's project, and both are
 * measured rather than assumed:
 *
 * - The stylesheet is the project's REAL entry, so `@theme` tokens, custom
 *   breakpoints and `@utility` definitions are all in scope. Reconstructing a
 *   synthetic theme from scanned token names would lose `@utility` — and the
 *   unknown-key warning tells authors to define classes exactly that way, so
 *   the oracle would report the very class it just recommended as dead.
 * - Tailwind is resolved from the PROJECT, never imported directly. This
 *   package pins Tailwind v3 permanently for `csszyx migrate`, and v3 has no
 *   design-system entry point at all.
 *
 * Anything that cannot be established — no Tailwind, a version without the
 * entry point, a stylesheet that will not compile — degrades to a skip
 * carrying its reason. Reporting a class dead because the environment was not
 * understood is worse than reporting nothing.
 *
 * @module
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fg from 'fast-glob';
import {
    type CollisionDesignSystem,
    collisionOracleFrom,
    PROBE_THEME,
} from './collision-oracle.js';
import { keywordOracleFrom } from './keyword-oracle.js';
import { brokenOpacityValue, collectCustomProperties } from './opacity-verdict.js';
import type { KeywordOracle } from './sibling-keyword.js';
import type { CollisionOracle } from './theme-collision.js';

/** A stylesheet handed back to Tailwind's loader. */
interface LoadedStylesheet {
    path: string;
    base: string;
    content: string;
}

/** The slice of Tailwind's design system this module uses. */
interface DesignSystem {
    candidatesToCss(candidates: readonly string[]): Array<string | null>;
    theme: { entries(): Iterable<readonly [string, unknown]> };
    // The value shape is what the collision oracle reads; the keyword oracle
    // only needs kind and root, so one declaration serves both.
    parseCandidate(
        candidate: string,
    ): Iterable<{ kind: string; root: string; value?: { kind: string; value: string } | null }>;
    getClassList(): Iterable<string | readonly [string, unknown]>;
}

/** A plugin or config module handed back to Tailwind's loader. */
interface LoadedModule {
    path: string;
    base: string;
    module: unknown;
}

/** Options Tailwind's design-system loader takes. */
interface LoadDesignSystemOptions {
    base: string;
    loadStylesheet(id: string, base: string): Promise<LoadedStylesheet>;
    loadModule(id: string, base: string, resourceHint: string): Promise<LoadedModule>;
}

/** The Tailwind installation a project resolves to. */
export interface TailwindModule {
    /** Declared version, used to reject majors without the entry point. */
    version: string;
    /** Package root, used to resolve `tailwindcss/*` stylesheet imports. */
    root: string;
    /** `__unstable__loadDesignSystem`, absent on versions that lack it. */
    loadDesignSystem?: unknown;
}

/** Resolves the Tailwind a project would use. Injected in tests. */
export type TailwindLoader = (resolveFrom: string) => Promise<TailwindModule | null>;

/** What to compile, and where to resolve it from. */
export interface OracleOptions {
    /** Directory whose `package.json` resolves `tailwindcss`. */
    resolveFrom: string;
    /** Stylesheet content to build the design system from. */
    css: string;
    /** Directory the stylesheet lives in, for its relative imports. */
    cssBase: string;
}

/**
 * A usable oracle, or the reason there is none.
 *
 * The skip is a value rather than an exception because every caller wants to
 * carry on and say why, not stop.
 */
export type EmittedClassOracle =
    | {
          ok: true;
          /**
           * Which of these classes produce no CSS.
           *
           * @param classes - Emitted class names.
           * @returns The subset that styles nothing, in the given order.
           */
          findDead(classes: readonly string[]): string[];
          /**
           * Which of these classes carry a slash modifier that provably does
           * not survive this stylesheet — a color-mix() argument resolving to
           * a bare comma triplet. Exact by construction: a chain the sheet
           * cannot prove stays out of the answer.
           *
           * @param classes - Emitted class names.
           * @returns Broken classes with the value that broke them.
           */
          findBrokenOpacity(classes: readonly string[]): Array<{ token: string; value: string }>;
          /**
           * The same design system, answering the questions the sibling-keyword
           * rule asks. Carried here so a project's stylesheet is compiled once
           * and every pass that needs it reads the same one.
           */
          keywords: KeywordOracle;
          /**
           * An oracle for theme-name collisions, or null when the probe
           * compile failed. Built on first call and cached — it costs a second
           * compile of the stylesheet, which a project with no theme tokens
           * should not pay.
           */
          loadCollisionOracle(): Promise<CollisionOracle | null>;
      }
    | { ok: false; kind: OracleSkipKind; reason: string };

/**
 * Why the oracle could not answer, at the granularity a caller must act on.
 *
 * `environment` — there was nothing to ask. No Tailwind, a version without a
 * design system, an entry point that moved. Not a defect in the project, and
 * failing on it would break every consumer that does not build with Tailwind.
 *
 * `stylesheet` — the question WAS asked and could not be answered, because the
 * project's own entry did not compile. That is a broken configuration, and it
 * is the case that must not pass quietly: a check that never runs looks exactly
 * like a check that found nothing.
 */
export type OracleSkipKind = 'environment' | 'stylesheet';

/**
 * A skip nobody needs to act on.
 *
 * @param reason - Human-readable cause.
 * @returns The skip.
 */
function environmentSkip(reason: string): EmittedClassOracle {
    return { ok: false, kind: 'environment', reason };
}

/**
 * A skip that means the project's own stylesheet stopped the check.
 *
 * @param reason - Human-readable cause.
 * @returns The skip.
 */
function stylesheetSkip(reason: string): EmittedClassOracle {
    return { ok: false, kind: 'stylesheet', reason };
}

/**
 * A deliberately unservable class, sent along with every real query.
 *
 * If Tailwind ever reports an unservable class as something other than `null`,
 * every dead class would read as alive and callers would pass vacuously. The
 * probe turns that into a skip instead of silent agreement.
 */
const SELF_PROOF = 'zz-csszyx-not-a-class';

/**
 * `group` and `peer`, bare or with a scope name — `group//sidebar` style.
 *
 * These carry no styles of their own: they mark an element so that `group-*`
 * and `peer-*` variants on its descendants have something to match. Tailwind
 * reports them as producing no CSS, which is true and is not a defect, so they
 * can never be dead. The scope name must be non-empty, which keeps `group/`
 * and every misspelling reportable.
 */
const MARKER = /^(?:group|peer)(?:\/[^/\s]+)?$/;

/** An imported Tailwind, in either of the shapes one can arrive in. */
export interface ImportedTailwind {
    __unstable__loadDesignSystem?: unknown;
    default?: { __unstable__loadDesignSystem?: unknown };
}

/**
 * Read the design-system entry point out of an imported Tailwind.
 *
 * `require.resolve` picks the package's `require` condition, so where the entry
 * point lands depends on how that build was written: at the top level for ESM,
 * and for CommonJS whose exports Node can read statically; one level down under
 * `default` for CommonJS whose exports it cannot. Reading only one shape would
 * report a project whose Tailwind ships the other as having no design system at
 * all — a silent skip for an installation that was perfectly fine.
 *
 * Separate from the loader because which shape a real install produces depends
 * on the build, on Node's version, and on any module interop in between. The
 * rule for reading them does not, and it is the part worth pinning.
 *
 * @param entry - The imported module namespace.
 * @returns The entry point, or undefined when the module carries none.
 */
export function designSystemEntry(entry: ImportedTailwind): unknown {
    return entry.__unstable__loadDesignSystem ?? entry.default?.__unstable__loadDesignSystem;
}

/**
 * Resolve the Tailwind a project would load, without importing it here.
 *
 * @param resolveFrom - Directory whose `package.json` anchors resolution.
 * @returns The installation, or null when the project has none.
 */
const defaultLoader: TailwindLoader = async resolveFrom => {
    try {
        const require = createRequire(path.join(resolveFrom, 'package.json'));
        const manifestPath = require.resolve('tailwindcss/package.json');
        const root = path.dirname(manifestPath);
        const { version } = JSON.parse(await readFile(manifestPath, 'utf8')) as {
            version: string;
        };
        // Import the resolved file rather than the bare specifier: the bare
        // one would resolve against THIS package, which pins v3.
        const entry = (await import(
            pathToFileURL(require.resolve('tailwindcss')).href
        )) as ImportedTailwind;
        return { version, root, loadDesignSystem: designSystemEntry(entry) };
    } catch {
        return null;
    }
};

/**
 * Map one `@import` specifier onto a file on disk.
 *
 * Three kinds arrive here and only the first two used to be handled. A design
 * system that ships its tokens as a package subpath — `@import
 * "@acme/ui/sz-theme"` against an exports map — is the ordinary shape for a
 * monorepo, and both Vite and Tailwind resolve it through node. Reading it as a
 * path relative to the stylesheet produces a directory that cannot exist, the
 * compile throws, and the dead-class pass degrades to a skip. Since a skip is
 * reported rather than failed, such a project keeps "passing" a check that has
 * never once run.
 *
 * `loadModule` below already resolves `@plugin` specifiers this way; this is
 * the same rule applied to the stylesheet loader.
 *
 * @param id - Import specifier as written.
 * @param base - Directory the importing stylesheet lives in.
 * @param tailwindRoot - Root of the resolved Tailwind package.
 * @param resolveFrom - Project directory whose `package.json` anchors packages.
 * @returns Absolute path to the stylesheet.
 */
function resolveStylesheetPath(
    id: string,
    base: string,
    tailwindRoot: string,
    resolveFrom: string,
): string {
    // Anchored rather than a prefix test: `tailwindcss-animate` is a package of
    // its own, and routing it into the Tailwind package would look for a file
    // that is not there.
    if (id === 'tailwindcss' || id.startsWith('tailwindcss/')) {
        return tailwindPackageStylesheet(id, tailwindRoot);
    }
    if (id.startsWith('.') || path.isAbsolute(id)) return path.resolve(base, id);
    // A bare specifier is ambiguous: CSS reads `@import "theme.css"` as a
    // sibling file, node reads it as a package. Prefer the file when one is
    // actually there, so stylesheets that relied on the old behaviour keep
    // resolving, and fall through to node resolution otherwise.
    const sibling = path.resolve(base, id);
    if (existsSync(sibling)) return sibling;
    return createRequire(path.join(resolveFrom, 'package.json')).resolve(id);
}

/**
 * Read one stylesheet Tailwind asked for, from the package or from the project.
 *
 * @param id - Import specifier as written.
 * @param base - Directory the importing stylesheet lives in.
 * @param tailwindRoot - Root of the resolved Tailwind package.
 * @param resolveFrom - Project directory whose `package.json` anchors packages.
 * @returns The stylesheet Tailwind expects back.
 */
async function loadStylesheet(
    id: string,
    base: string,
    tailwindRoot: string,
    resolveFrom: string,
): Promise<LoadedStylesheet> {
    const file = resolveStylesheetPath(id, base, tailwindRoot, resolveFrom);
    return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
}

/**
 * Load a plugin or config module a stylesheet asked for with `@plugin`.
 *
 * Tailwind v4 pulls typography, forms and friends in this way, so a design
 * system built without this cannot compile those stylesheets at all — the
 * check would skip for a large share of real projects. Resolution is anchored
 * to the PROJECT for the same reason Tailwind itself is: the plugin is the
 * project's dependency, not this package's.
 *
 * @param id - Specifier as written in `@plugin`.
 * @param base - Directory the importing stylesheet lives in.
 * @param resolveFrom - Project directory whose `package.json` anchors packages.
 * @returns The module Tailwind expects back.
 */
async function loadModule(id: string, base: string, resolveFrom: string): Promise<LoadedModule> {
    const file = id.startsWith('.')
        ? path.resolve(base, id)
        : createRequire(path.join(resolveFrom, 'package.json')).resolve(id);
    const loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };
    return { path: file, base: path.dirname(file), module: loaded.default ?? loaded };
}

/**
 * Map a `tailwindcss` / `tailwindcss/<name>` import onto a file in the package.
 *
 * @param id - Import specifier as written.
 * @param tailwindRoot - Root of the resolved Tailwind package.
 * @returns Absolute path to the stylesheet.
 */
function tailwindPackageStylesheet(id: string, tailwindRoot: string): string {
    const relative = id === 'tailwindcss' ? 'index.css' : id.replace(/^tailwindcss\//, '');
    return path.join(tailwindRoot, relative.endsWith('.css') ? relative : `${relative}.css`);
}

/** Directories a project's own stylesheets never live in. */
const IGNORED_CSS_DIRS = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/.astro/**',
];

/**
 * Find the stylesheet that pulls Tailwind into the project.
 *
 * That file is the one worth compiling: everything the project adds — `@theme`
 * tokens, `@utility` definitions, further `@import`s — hangs off it. The
 * shallowest match wins so the answer does not depend on directory order.
 *
 * @param cwd - Project root to search.
 * @returns Absolute path to the entry, or null when the project has none.
 */
export async function findTailwindCssEntry(cwd: string): Promise<string | null> {
    return (await findTailwindCssEntries(cwd))[0] ?? null;
}

/**
 * Find every stylesheet that pulls Tailwind into the project.
 *
 * A project may have more than one — a design system plus a page theme is an
 * ordinary shape, not an exotic one — and each compiles to its OWN design
 * system with its own `@theme` tokens and `@utility` definitions. Asking only
 * the first would report every token of the others as producing no CSS, which
 * is the one thing this check may never do.
 *
 * Shallowest first, then alphabetical, so the order does not depend on how the
 * filesystem happens to enumerate directories.
 *
 * @param cwd - Project root to search.
 * @returns Absolute paths to the entries, nearest the root first.
 */
export async function findTailwindCssEntries(cwd: string): Promise<string[]> {
    const files = await fg('**/*.css', { cwd, ignore: IGNORED_CSS_DIRS, absolute: true });
    // Sorted as its own statement over a copy: the ordering is what the rest of
    // this function reads, and reordering the glob result in place would leave
    // that dependency invisible at the call site.
    const byDepth = [...files];
    byDepth.sort((a, b) => {
        const depth = a.split(path.sep).length - b.split(path.sep).length;
        return depth === 0 ? a.localeCompare(b) : depth;
    });
    const entries: string[] = [];
    for (const file of byDepth) {
        try {
            if (IMPORTS_TAILWIND.test(await readFile(file, 'utf8'))) entries.push(file);
        } catch {
            // A stylesheet that cannot be read cannot be the entry point.
        }
    }
    return entries;
}

/** `@import "tailwindcss"` in either quoting style, with optional layer parts. */
const IMPORTS_TAILWIND = /@import\s+["']tailwindcss["' /]/;

/**
 * Build an oracle over the project's own Tailwind and stylesheet.
 *
 * @param options - What to compile and where to resolve it from.
 * @param loadTailwind - Resolver override, for tests.
 * @returns A ready oracle, or a skip carrying the reason there is none.
 */
export async function createEmittedClassOracle(
    options: OracleOptions,
    loadTailwind: TailwindLoader = defaultLoader,
): Promise<EmittedClassOracle> {
    const tailwind = await loadTailwind(options.resolveFrom);
    if (tailwind === null) {
        return environmentSkip(`could not resolve tailwindcss from ${options.resolveFrom}`);
    }
    if (!tailwind.version.startsWith('4.')) {
        return environmentSkip(
            `tailwindcss ${tailwind.version} has no design system to ask; the check needs 4.x`,
        );
    }
    if (typeof tailwind.loadDesignSystem !== 'function') {
        return environmentSkip(
            `tailwindcss ${tailwind.version} does not expose __unstable__loadDesignSystem`,
        );
    }

    const load = tailwind.loadDesignSystem as (
        css: string,
        options: LoadDesignSystemOptions,
    ) => Promise<DesignSystem>;

    const loadOptions: LoadDesignSystemOptions = {
        base: options.cssBase,
        loadStylesheet: (id, base) => loadStylesheet(id, base, tailwind.root, options.resolveFrom),
        loadModule: (id, base) => loadModule(id, base, options.resolveFrom),
    };

    let design: DesignSystem;
    try {
        design = await load(options.css, loadOptions);
    } catch (error) {
        return stylesheetSkip(
            `the stylesheet did not compile: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    try {
        if (design.candidatesToCss([SELF_PROOF])[0] !== null) {
            return environmentSkip(
                'tailwindcss no longer reports an unservable class as null, so dead classes cannot be told apart',
            );
        }
    } catch (error) {
        return environmentSkip(
            `the design system could not be queried: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    const customProperties = collectCustomProperties(options.css);

    // Built on first use, from a SECOND compile of the same stylesheet with
    // probe tokens appended. Kept out of the main design system because that
    // one answers the dead-class question, and injecting tokens into it to save
    // a compile would put a diagnostic's instrumentation inside another
    // diagnostic's evidence.
    let collisions: CollisionOracle | null | undefined;

    return {
        ok: true,
        keywords: keywordOracleFrom(design),
        async loadCollisionOracle() {
            if (collisions !== undefined) return collisions;
            try {
                collisions = collisionOracleFrom(
                    (await load(
                        `${options.css}\n${PROBE_THEME}`,
                        loadOptions,
                    )) as CollisionDesignSystem,
                );
            } catch {
                // The stylesheet already compiled once, so a failure here is
                // the probe theme meeting something unusual — report nothing
                // rather than blaming the project for our own instrumentation.
                collisions = null;
            }
            return collisions;
        },
        findDead(classes) {
            // Markers are excluded before the question is asked, not filtered
            // out of the answer: Tailwind's verdict on them is "no CSS", which
            // is correct and means something different from dead.
            const asked = classes.filter(token => !MARKER.test(token));
            if (asked.length === 0) return [];
            const css = design.candidatesToCss(asked);
            return asked.filter((_, index) => css[index] === null);
        },
        findBrokenOpacity(classes) {
            const asked = classes.filter(token => token.includes('/') && !MARKER.test(token));
            if (asked.length === 0) return [];
            const css = design.candidatesToCss(asked);
            const broken: Array<{ token: string; value: string }> = [];
            asked.forEach((token, index) => {
                const rule = css[index];
                // A class with no rule is the dead pass's finding, not this one's.
                if (rule == null) return;
                const value = brokenOpacityValue(rule, customProperties);
                if (value !== null) broken.push({ token, value });
            });
            return broken;
        },
    };
}
