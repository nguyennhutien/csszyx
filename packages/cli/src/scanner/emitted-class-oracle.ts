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

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import fg from 'fast-glob';

/** A stylesheet handed back to Tailwind's loader. */
interface LoadedStylesheet {
    path: string;
    base: string;
    content: string;
}

/** The slice of Tailwind's design system this module uses. */
interface DesignSystem {
    candidatesToCss(candidates: readonly string[]): Array<string | null>;
}

/** Options Tailwind's design-system loader takes. */
interface LoadDesignSystemOptions {
    base: string;
    loadStylesheet(id: string, base: string): Promise<LoadedStylesheet>;
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
      }
    | { ok: false; reason: string };

/**
 * A deliberately unservable class, sent along with every real query.
 *
 * If Tailwind ever reports an unservable class as something other than `null`,
 * every dead class would read as alive and callers would pass vacuously. The
 * probe turns that into a skip instead of silent agreement.
 */
const SELF_PROOF = 'zz-csszyx-not-a-class';

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
        //
        // `require.resolve` picks the package's `require` condition, so the
        // file is CommonJS and importing it puts the exports one level down
        // under `default`. Read both shapes rather than assume either, so a
        // package that later ships a real ESM main keeps working.
        const entry = (await import(pathToFileURL(require.resolve('tailwindcss')).href)) as {
            __unstable__loadDesignSystem?: unknown;
            default?: { __unstable__loadDesignSystem?: unknown };
        };
        return {
            version,
            root,
            loadDesignSystem:
                entry.__unstable__loadDesignSystem ?? entry.default?.__unstable__loadDesignSystem,
        };
    } catch {
        return null;
    }
};

/**
 * Read one stylesheet Tailwind asked for, from the package or from the project.
 *
 * @param id - Import specifier as written.
 * @param base - Directory the importing stylesheet lives in.
 * @param tailwindRoot - Root of the resolved Tailwind package.
 * @returns The stylesheet Tailwind expects back.
 */
async function loadStylesheet(
    id: string,
    base: string,
    tailwindRoot: string,
): Promise<LoadedStylesheet> {
    const file = id.startsWith('tailwindcss')
        ? tailwindPackageStylesheet(id, tailwindRoot)
        : path.resolve(base, id);
    return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
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
    const files = await fg('**/*.css', { cwd, ignore: IGNORED_CSS_DIRS, absolute: true });
    const byDepth = files.sort((a, b) => {
        const depth = a.split(path.sep).length - b.split(path.sep).length;
        return depth === 0 ? a.localeCompare(b) : depth;
    });
    for (const file of byDepth) {
        try {
            if (IMPORTS_TAILWIND.test(await readFile(file, 'utf8'))) return file;
        } catch {
            // A stylesheet that cannot be read cannot be the entry point.
        }
    }
    return null;
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
        return {
            ok: false,
            reason: `could not resolve tailwindcss from ${options.resolveFrom}`,
        };
    }
    if (!tailwind.version.startsWith('4.')) {
        return {
            ok: false,
            reason: `tailwindcss ${tailwind.version} has no design system to ask; the check needs 4.x`,
        };
    }
    if (typeof tailwind.loadDesignSystem !== 'function') {
        return {
            ok: false,
            reason: `tailwindcss ${tailwind.version} does not expose __unstable__loadDesignSystem`,
        };
    }

    const load = tailwind.loadDesignSystem as (
        css: string,
        options: LoadDesignSystemOptions,
    ) => Promise<DesignSystem>;

    let design: DesignSystem;
    try {
        design = await load(options.css, {
            base: options.cssBase,
            loadStylesheet: (id, base) => loadStylesheet(id, base, tailwind.root),
        });
    } catch (error) {
        return {
            ok: false,
            reason: `the stylesheet did not compile: ${error instanceof Error ? error.message : String(error)}`,
        };
    }

    try {
        if (design.candidatesToCss([SELF_PROOF])[0] !== null) {
            return {
                ok: false,
                reason: 'tailwindcss no longer reports an unservable class as null, so dead classes cannot be told apart',
            };
        }
    } catch (error) {
        return {
            ok: false,
            reason: `the design system could not be queried: ${error instanceof Error ? error.message : String(error)}`,
        };
    }

    return {
        ok: true,
        findDead(classes) {
            if (classes.length === 0) return [];
            const css = design.candidatesToCss(classes);
            return classes.filter((_, index) => css[index] === null);
        },
    };
}
