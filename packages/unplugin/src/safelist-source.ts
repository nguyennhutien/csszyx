/**
 * How a stylesheet is told to read csszyx's safelist: the `@source` directive
 * Tailwind v4 needs, and the checks around adding one.
 *
 * Kept apart from the bundler plugin so the PostCSS entry, which runs inside
 * Next's PostCSS worker, loads only this and not the whole plugin.
 */

import * as path from 'node:path';
import { normalizePathSeparators } from './path-normalization.js';

/**
 * Safelist files csszyx writes, relative to the project root: the file every
 * bundler lane and `csszyx next prebuild` write, and the one the Next
 * Turbopack loader writes on its own.
 */
export const DEFAULT_SAFELIST_FILES: readonly string[] = [
    'csszyx-classes.html',
    '.csszyx/next-loader-classes.html',
];

/**
 * The `tailwindcss` package specifier as it appears in an `@import`: exact or
 * a subpath, ending at the closing quote so a package whose name merely starts
 * with `tailwindcss` (such as `tailwindcss-animate`) does not match. Import
 * options after the quote (`layer(…)`, `source(…)`) are outside the match.
 */
const TAILWIND_SPECIFIER = `["']tailwindcss(?:\\/[^"']*)?["']`;
const TAILWIND_IMPORT = new RegExp(`@import\\s+${TAILWIND_SPECIFIER}`);
const TAILWIND_IMPORT_PARAMS = new RegExp(`^${TAILWIND_SPECIFIER}`);

/**
 * Computes the `@source` target path for a CSS module: the location of the
 * generated safelist file relative to the CSS file, in posix form and always
 * `./`- or `../`-prefixed so Tailwind treats it as a relative path.
 *
 * This is the real-world failure surface — a wrong relative path makes Tailwind
 * silently scan nothing (no error, no CSS), the same symptom as a missing
 * directive — so it is extracted and unit-tested rather than left inline.
 *
 * @param rootDir - project root where the safelist file is written.
 * @param safelistFilename - the safelist file name (e.g. `csszyx-classes.html`).
 * @param cssId - absolute path of the CSS module receiving the directive.
 * @returns the posix relative path from the CSS file to the safelist file.
 */
export function computeSafelistRelPath(
    rootDir: string,
    safelistFilename: string,
    cssId: string,
): string {
    const safelistPath = normalizePathSeparators(path.join(rootDir, safelistFilename));
    const cssDir = normalizePathSeparators(path.dirname(cssId));
    let relPath = path.posix.relative(cssDir, safelistPath);
    if (!relPath.startsWith('.')) {
        relPath = `./${relPath}`;
    }
    return relPath;
}

/**
 * Appends an `@source "<relPath>";` directive to a CSS module so Tailwind v4
 * scans the csszyx-generated safelist file.
 *
 * `@source` is position-independent in Tailwind v4 — it can appear anywhere in
 * the compiled CSS — so the directive is **appended as its own statement**
 * rather than spliced next to the `@import "tailwindcss…"` line. Matching the
 * import syntax is the source of a real defect: the split / manual Tailwind v4
 * setup (`@import "tailwindcss/utilities.css" layer(…)` or `… source(…)`, or an
 * import without a trailing `;`) does not match an import-anchored regex, so the
 * injection silently no-ops and every csszyx-only class (e.g. the static
 * `bg-primary/50` produced by `sz={{ bg: { color, op } }}`) gets no CSS while a
 * raw `className` still works. Appending is correct for every import form.
 *
 * @param code - CSS module source already known to import tailwindcss.
 * @param relPath - safelist path relative to this CSS file (posix, `./`-prefixed).
 * @returns the code with the directive appended, or `null` if it is already
 *   present (idempotent — re-running the transform must not stack directives).
 */
export function appendTailwindSourceDirective(code: string, relPath: string): string | null {
    const directive = `@source "${relPath}";`;
    if (code.includes(directive)) {
        return null;
    }
    const separator = code.length === 0 || code.endsWith('\n') ? '' : '\n';
    return `${code}${separator}${directive}\n`;
}

/**
 * Strip CSS block comments in a single linear pass. The regex form
 * (`/\/\*[\s\S]*?\*\//`) is polynomial-ReDoS on adversarial input such as an
 * unterminated `/*` followed by many `a/*` repetitions (CodeQL
 * js/polynomial-redos), so scan by hand: O(n), no backtracking, copying only
 * the whole non-comment spans.
 *
 * @param code - CSS source that may contain block comments.
 * @returns the source with every block comment removed.
 */
export function stripCssBlockComments(code: string): string {
    const SLASH = 47;
    const STAR = 42;
    let out = '';
    let last = 0;
    let i = 0;
    const n = code.length;
    while (i < n) {
        if (code.codePointAt(i) === SLASH && code.codePointAt(i + 1) === STAR) {
            out += code.slice(last, i);
            i += 2;
            while (i < n && !(code.codePointAt(i) === STAR && code.codePointAt(i + 1) === SLASH)) {
                i++;
            }
            i += 2; // skip past the closing */ (or past EOF if unterminated)
            last = i;
        } else {
            i++;
        }
    }
    return out + code.slice(last);
}

/**
 * Whether a CSS module actually imports the `tailwindcss` package, so the
 * `@source` directive should be appended.
 *
 * Tighter than a substring check on purpose: block comments are stripped first
 * (a commented-out `@import` must not trigger injection), and the package name
 * must end at a quote or a `/` subpath so a different package whose name merely
 * starts with `tailwindcss` (e.g. `tailwindcss-animate`) does not match. Import
 * options after the closing quote (`layer(…)`, `source(…)`) are irrelevant — the
 * match ends at the quote — so every real Tailwind v4 import form is covered.
 *
 * @param code - CSS module source.
 * @returns true if the module imports tailwindcss (exact or a subpath).
 */
export function cssImportsTailwind(code: string): boolean {
    return TAILWIND_IMPORT.test(stripCssBlockComments(code));
}

/**
 * Whether the params of one parsed `@import` at-rule name the `tailwindcss`
 * package. The same match as {@link cssImportsTailwind}, for callers that hold
 * an AST instead of source text.
 *
 * @param params - the at-rule's params, e.g. `"tailwindcss" source(none)`.
 * @returns true if the import is of tailwindcss (exact or a subpath).
 */
export function importParamsNameTailwind(params: string): boolean {
    return TAILWIND_IMPORT_PARAMS.test(params.trim());
}
