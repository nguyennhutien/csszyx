/**
 * Guards for attacker-controllable arbitrary CSS that reaches the runtime
 * declaration text. `@csszyx/dynamic` builds CSS declarations by string
 * concatenation and feeds them to `CSSStyleSheet.insertRule`. `insertRule` is
 * atomic (it parses exactly one rule, so a `}`/`</style>` rule-breakout throws
 * and is ignored), but the declaration *body* is otherwise unvalidated — so an
 * arbitrary value like `red;position:fixed;inset:0` injects a SECOND, valid
 * declaration into the same rule (UI redress / overlay), and an arbitrary
 * property name could carry the same. These predicates reject that class of
 * input while leaving every legitimate value (`url(/img.png)`, `calc(...)`,
 * gradients, `var(--x)`, quoted `content` strings, `;`-bearing data URIs) intact.
 *
 * Only the arbitrary `[...]` syntax can carry attacker characters here; numeric /
 * keyword / looked-up values are csszyx-generated and always safe.
 */

/**
 * True when a single CSS *property value* cannot break out of its declaration.
 * Tracks quote and parenthesis state with a linear scan (no backtracking regex):
 * `{`/`}`/`<`/`>` are rejected outside quotes (never valid in a value), a `;` is
 * rejected only at paren depth 0 (so it stays legal inside `url(data:…;base64,…)`),
 * and raw control characters (incl. CR/LF) are rejected anywhere.
 *
 * @param value - the candidate value (bracket contents, `_` not yet expanded).
 * @returns true if safe to interpolate into a declaration.
 */
export function isSafeCssValue(value: string): boolean {
    let quote: string | null = null;
    let parenDepth = 0;
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (value.charCodeAt(i) < 0x20) {
            return false; // raw control char / CR / LF / tab
        }
        if (quote !== null) {
            if (ch === '\\') {
                i++; // skip the escaped character
                continue;
            }
            if (ch === quote) {
                quote = null;
            }
            continue;
        }
        switch (ch) {
            case '"':
            case "'":
                quote = ch;
                break;
            case '(':
                parenDepth++;
                break;
            case ')':
                if (parenDepth > 0) {
                    parenDepth--;
                }
                break;
            case '{':
            case '}':
            case '<':
            case '>':
                return false;
            case ';':
                if (parenDepth === 0) {
                    return false;
                }
                break;
        }
    }
    return quote === null && parenDepth === 0;
}

/**
 * True when a string is a valid CSS property name (custom property `--x`, or a
 * standard/vendor ident like `color` / `-webkit-mask`). Anchored and linear.
 *
 * @param name - the candidate property name.
 * @returns true if it is a well-formed property name (no `:`/`;`/whitespace).
 */
export function isSafeCssPropertyName(name: string): boolean {
    return /^(?:--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z0-9-]*)$/.test(name);
}

/**
 * True when a Tailwind utility's arbitrary `[...]` segment (if any) is safe to
 * emit. Utilities with no `[...]` are always safe (csszyx-generated). For the
 * whole-utility arbitrary-property form `[property:value]`, both the name and the
 * value are validated; otherwise the bracket content is validated as a value.
 *
 * @param utility - the utility class (variant prefix already stripped).
 * @returns true if no arbitrary segment, or the arbitrary segment is safe.
 */
export function isUtilityArbitrarySafe(utility: string): boolean {
    const open = utility.indexOf('[');
    if (open === -1) {
        return true;
    }
    const close = utility.lastIndexOf(']');
    if (close <= open) {
        return true; // malformed bracket — downstream emits nothing anyway
    }
    const inner = utility.slice(open + 1, close);

    // Whole-utility arbitrary property: [property:value]
    if (
        utility.charCodeAt(0) === 0x5b /* [ */ &&
        utility.charCodeAt(utility.length - 1) === 0x5d /* ] */ &&
        inner.includes(':')
    ) {
        const colon = inner.indexOf(':');
        return (
            isSafeCssPropertyName(inner.slice(0, colon)) &&
            isSafeCssValue(inner.slice(colon + 1))
        );
    }

    // Otherwise the bracket content is a value: bg-[…], opacity-[…], grid-cols-[…].
    return isSafeCssValue(inner);
}
