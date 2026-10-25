/**
 * A CSS-wide keyword on a class Tailwind serves, that no property takes.
 *
 * `{ ring: 'inherit' }` lowers to `ring-inherit`, which Tailwind serves as
 * `--tw-ring-color: inherit`: on a custom property the keyword names that
 * property's own inheritance, and `blur-[inherit]` wraps it in `blur()`. The
 * class produces CSS, so the dead pass passes it, and it styles nothing.
 * Whether a property takes the keyword is read from the CSS the project's
 * Tailwind emits (PROJECT-RULES §4), by the one declaration reader the merge
 * table uses: `cursor-[inherit]` sets `cursor: inherit`, and nothing is said.
 *
 * @module
 */
import { CSS_WIDE_KEYWORDS } from '@csszyx/compiler';
import { candidateDeclarationsFromCss } from './merge-signature.js';

/**
 * The CSS-wide keyword a class's value is: bracketed, type hint aside
 * (`ring-[inherit]`, `bg-[length:unset]`), or bare at the end of the utility
 * (`ring-inherit`, which Tailwind reads as a colour named `inherit`).
 *
 * @param className - The class, variants and important modifier included.
 * @returns The keyword, or null when the value is no CSS-wide keyword.
 */
export function cssWideKeywordOf(className: string): string | null {
    const body = className.endsWith('!') ? className.slice(0, -1) : className;
    if (body.endsWith(']')) {
        const inner = body.slice(body.lastIndexOf('[') + 1, -1);
        const keyword = inner.slice(inner.indexOf(':') + 1);
        return CSS_WIDE_KEYWORDS.has(keyword) ? keyword : null;
    }
    for (const keyword of CSS_WIDE_KEYWORDS) if (body.endsWith(`-${keyword}`)) return keyword;
    return null;
}

/**
 * The CSS-wide keyword a served class carries when no property it sets takes it.
 *
 * @param className - The class, as emitted.
 * @param css - The CSS Tailwind emits for it, or null when it emits none.
 * @returns The keyword, or null when a property takes it, the class carries
 *          none, or there is no CSS to read (the dead pass's finding).
 */
export function inertKeywordOf(className: string, css: string | null): string | null {
    const keyword = cssWideKeywordOf(className);
    if (keyword === null) return null;
    const declarations = candidateDeclarationsFromCss(className, css);
    if (declarations === null) return null;
    const named = namedCustomProperty(className);
    const taken = declarations.some(
        ({ property, value }) =>
            value === keyword && (!property.startsWith('--') || property === named),
    );
    return taken ? null : keyword;
}

/**
 * The custom property a class names itself, as an arbitrary property
 * (`[--x:initial]`, `hover:[--x:unset]!`). Setting that property to a
 * keyword is what the author asked for: `initial` makes it guaranteed-invalid,
 * so `var(--x, fallback)` falls back. A utility's own custom property, such
 * as `--tw-ring-color`, is not named by the class and stays inert.
 *
 * @param className - The class, variants and important modifier included.
 * @returns The property, or null when the class is no arbitrary custom property.
 */
function namedCustomProperty(className: string): string | null {
    const body = className.endsWith('!') ? className.slice(0, -1) : className;
    const open = body.lastIndexOf('[');
    if (!body.endsWith(']') || (open > 0 && body[open - 1] !== ':')) return null;
    // A keyword is read after the colon, so a class that reached here has one.
    return body.startsWith('--', open + 1) ? body.slice(open + 1, body.indexOf(':', open)) : null;
}

/**
 * The classes whose keyword no property takes under every root that serves
 * them: one stylesheet setting a property to it is enough for the class to
 * style something. A root serving nothing for a class has no say, and a class
 * no root serves is the dead pass's finding.
 *
 * @param classes - Class names, as emitted.
 * @param cssPerRoot - Each root's CSS for `classes`, index for index.
 * @returns The subset that styles nothing, in the given order.
 */
export function inertUnderEveryRoot(
    classes: readonly string[],
    cssPerRoot: ReadonlyArray<ReadonlyArray<string | null>>,
): string[] {
    return classes.filter(
        (className, index) =>
            cssPerRoot.some(css => css[index] != null) &&
            cssPerRoot.every(
                css => css[index] == null || inertKeywordOf(className, css[index]) !== null,
            ),
    );
}
