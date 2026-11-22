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

/** Mutable state for one CSS value scan. */
interface CssValueScanState {
    quote: string | null;
    parenDepth: number;
}

/**
 * Consume one character outside a quoted CSS string.
 *
 * @param char Current character.
 * @param state Scanner state to update.
 * @returns Whether scanning may continue.
 */
function scanUnquotedCssCharacter(char: string, state: CssValueScanState): boolean {
    if (char === '"' || char === "'") {
        state.quote = char;
    } else if (char === '(') {
        state.parenDepth++;
    } else if (char === ')') {
        state.parenDepth = Math.max(0, state.parenDepth - 1);
    } else if (char === '{' || char === '}' || char === '<' || char === '>') {
        return false;
    } else if (char === ';' && state.parenDepth === 0) {
        return false;
    }
    return true;
}

/**
 * Consume one character inside a quoted CSS string.
 * @param value - Complete candidate CSS value.
 * @param index - Current character index.
 * @param state - Scanner state to update.
 * @returns The next character index to scan.
 */
function scanQuotedCssCharacter(value: string, index: number, state: CssValueScanState): number {
    const char = value[index];
    if (char === '\\') return index + 2;
    if (char === state.quote) state.quote = null;
    return index + 1;
}

/**
 * True when the `(` at `open` starts an unquoted url that CSS reads as a bad
 * url. `url(` not preceded by a name character is a url token unless a quote
 * comes first; that token ends at the first `)`, and a quote, a `(`, an
 * escape, DEL or inner whitespace makes it a bad url, which ends at a `)` this
 * scan cannot place (`url(a'b)c;position:fixed;d'e)`). A clean url body holds
 * none of the characters the scan reads as structure, so the scan goes on
 * through it as it reads any parenthesis. Linear in the url's length.
 *
 * @param value - The candidate CSS value.
 * @param open - The index of a `(`.
 * @returns Whether CSS reads a bad url from here.
 */
function isBadUrl(value: string, open: number): boolean {
    if (
        value.slice(open - 3, open).toLowerCase() !== 'url' ||
        /[\w\u0080-\uffff-]/.test(value[open - 4] ?? '')
    ) {
        return false;
    }
    const rest = value.slice(open + 1);
    const close = rest.indexOf(')');
    return !/^(?:["']|[^\s"'(\\\x7f]*$)/.test((close === -1 ? rest : rest.slice(0, close)).trim());
}

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
    const state: CssValueScanState = { quote: null, parenDepth: 0 };
    let i = 0;
    while (i < value.length) {
        const codePoint = value.codePointAt(i);
        if (codePoint !== undefined && codePoint < 0x20) {
            return false; // raw control char / CR / LF / tab
        }
        const char = value[i] as string;
        if (state.quote !== null) {
            i = scanQuotedCssCharacter(value, i, state);
            continue;
        }
        // Outside a string, an escape and a comment are refused rather than
        // read. `\\(` is no parenthesis to CSS and a bracket inside a comment
        // opens nothing, so `x\\(;position:fixed;--z:\\)` and
        // `/*(*/;position:fixed;/*)*/` hid a top-level `;` from this scan; an
        // escape can also spell a function name, `u\\72l(` being `url(`. No
        // arbitrary value needs either outside a quoted string.
        if (char === '\\' || (char === '/' && value[i + 1] === '*')) return false;
        if (char === '(' && isBadUrl(value, i)) return false;
        if (!scanUnquotedCssCharacter(char, state)) {
            return false;
        }
        i++;
    }
    return state.quote === null && state.parenDepth === 0;
}

/**
 * True when a string is a valid CSS property name (custom property `--x`, or a
 * standard/vendor ident like `color` / `-webkit-mask`). Anchored and linear.
 *
 * @param name - the candidate property name.
 * @returns true if it is a well-formed property name (no `:`/`;`/whitespace).
 */
export function isSafeCssPropertyName(name: string): boolean {
    return /^(?:--[\w-]+|-?[a-z][a-z0-9-]*)$/i.test(name);
}

/**
 * True when every `[` in a bracket segment's inner text closes before the
 * segment does, outside quoted strings: `[a]_1fr_[b]` (grid line names) is
 * one value, while `1px]_p-[2px` is the text between the first `[` and the last
 * `]` of two utilities, `w-[1px]_p-[2px]`, which would declare `width: 1px]
 * p-[2px`. One linear pass over `n` characters.
 *
 * @param inner - The text between a segment's first `[` and its last `]`.
 * @returns Whether its brackets balance.
 */
function innerBracketsBalance(inner: string): boolean {
    let depth = 0;
    let quote: string | null = null;
    for (let i = 0; i < inner.length; i++) {
        const char = inner[i];
        if (char === '\\') {
            i++;
        } else if (quote !== null) {
            if (char === quote) quote = null;
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '[') {
            depth++;
        } else if (char === ']' && --depth < 0) {
            return false;
        }
    }
    return depth === 0;
}

/** A utility with no bracket or parenthesis: letters, digits and `-_.%/!#`. */
const BARE_UTILITY = /^[\w.%/!#-]+$/;

/** A modifier: a plain one or a custom property, `/50`, `/(--alpha)`. */
const MODIFIER = /^\/(?:[\w.%]+|\(--[\w-]+\))$/;

/**
 * The parenthesis form, modifier removed: a custom property with an optional
 * type hint, `bg-(--brand)`, `text-(length:--fs)`.
 */
const PAREN_UTILITY = /^[\w-]+-\((?:[a-z-]+:)?--[\w-]+\)$/;

/**
 * Removes a trailing `!` and a well-formed modifier.
 *
 * @param text - A utility, or the part of one after its bracket segment.
 * @returns The text before them; a malformed modifier stays in it.
 */
function withoutModifier(text: string): string {
    const body = text.endsWith('!') ? text.slice(0, -1) : text;
    const slash = body.lastIndexOf('/');
    return slash !== -1 && MODIFIER.test(body.slice(slash)) ? body.slice(0, slash) : body;
}

/**
 * True when every part of a utility can only state its own value: the bare
 * part is plain token characters, a parenthesis holds only a custom property
 * name, a bracket segment passes {@link isUtilityArbitrarySafe}, and after its
 * `]` comes only a modifier. A runtime
 * value lands in the utility text, so text the resolvers copy into a
 * declaration (a bare value, `var(…)` around a parenthesis) is checked here,
 * not only the `[…]` segment. Anchored, linear expressions.
 *
 * @param utility - The utility class, variant prefix already stripped.
 * @returns Whether it is safe to generate a rule for.
 */
export function isUtilityStructureSafe(utility: string): boolean {
    const open = utility.indexOf('[');
    if (open !== -1) {
        return (
            BARE_UTILITY.test(utility.slice(0, open) || '-') &&
            withoutModifier(utility.slice(utility.lastIndexOf(']') + 1)) === '' &&
            isUtilityArbitrarySafe(utility)
        );
    }
    const head = withoutModifier(utility);
    return head.includes('(') ? PAREN_UTILITY.test(head) : BARE_UTILITY.test(head);
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
    if (!innerBracketsBalance(inner)) {
        return false;
    }

    // Whole-utility arbitrary property: [property:value]
    if (
        utility.codePointAt(0) === 0x5b /* [ */ &&
        utility.codePointAt(utility.length - 1) === 0x5d /* ] */ &&
        inner.includes(':')
    ) {
        const colon = inner.indexOf(':');
        return (
            isSafeCssPropertyName(inner.slice(0, colon)) && isSafeCssValue(inner.slice(colon + 1))
        );
    }

    // Otherwise the bracket content is a value: bg-[…], opacity-[…], grid-cols-[…].
    return isSafeCssValue(inner);
}
