/**
 * Exact opacity-modifier verdict over a compiled Tailwind rule.
 *
 * Tailwind v4 wraps every `/N` modifier in `color-mix()`, which dims ANY
 * valid color — so no token-text heuristic can say a modifier is broken, and
 * the one that tried flagged six working rules in a field user's otherwise
 * clean run. The single shape that genuinely breaks is a token whose var()
 * chain ends in a bare comma triplet (`17, 119, 224`): substituted into
 * `color-mix()`, the declaration is invalid CSS and the browser drops it
 * silently. Whether that is the case is a fact about the project's own
 * stylesheet, so the verdict here resolves the emitted rule's color argument
 * through the custom properties that stylesheet defines and reports ONLY a
 * proven bare triplet. A chain that leaves the visible sheet stays silent —
 * an exact pass does not guess.
 *
 * Everything here parses by index rather than by pattern: these functions run
 * over project-controlled CSS, and the repo's ReDoS gate (rightly) refuses
 * the `\s*,\s*` shapes the patterns would need.
 */

/** The one value shape whose opacity modifier cannot survive color-mix(). */
const BARE_RGB_TRIPLET = /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/;

/** A custom property name after its `--` prefix. */
const PROPERTY_NAME_CHAR = /[\w-]/;

/**
 * Harvest every custom property a stylesheet defines.
 *
 * Later definitions win, matching the cascade for the common single-selector
 * case this feeds (theme tokens defined once, overridden never). Nesting and
 * selector specificity are deliberately not modelled: this feeds a verdict
 * that must only ever claim what it can prove, and a property this misreads
 * resolves to a value that fails the triplet test and stays silent.
 *
 * @param css - Stylesheet text, as the check command read it.
 * @returns Property name to raw value text.
 */
export function collectCustomProperties(css: string): Map<string, string> {
    const out = new Map<string, string>();
    let index = 0;
    while (index < css.length) {
        const start = css.indexOf('--', index);
        if (start === -1) break;
        let nameEnd = start + 2;
        while (nameEnd < css.length && PROPERTY_NAME_CHAR.test(css[nameEnd])) {
            nameEnd += 1;
        }
        index = nameEnd;
        if (nameEnd === start + 2) continue;
        let cursor = nameEnd;
        while (cursor < css.length && (css[cursor] === ' ' || css[cursor] === '\t')) {
            cursor += 1;
        }
        // A `--name` not followed by a colon is a usage (`var(--name)`), not
        // a definition.
        if (css[cursor] !== ':') continue;
        cursor += 1;
        let valueEnd = cursor;
        while (valueEnd < css.length && !';{}'.includes(css[valueEnd])) {
            valueEnd += 1;
        }
        // A `{` means this was a selector-position token, not a declaration.
        if (css[valueEnd] === '{') {
            index = valueEnd + 1;
            continue;
        }
        out.set(css.slice(start, nameEnd), css.slice(cursor, valueEnd).trim());
        index = valueEnd;
    }
    return out;
}

/**
 * Read a value that is exactly one var() reference.
 *
 * @param value - Trimmed value text.
 * @returns The referenced name plus any fallback, or null for anything else.
 */
function parseVarReference(value: string): { name: string; fallback?: string } | null {
    if (!value.startsWith('var(') || !value.endsWith(')')) return null;
    const inner = value.slice(4, -1);
    // The property name cannot contain a comma, so the first one — if any —
    // separates the fallback, nested parens and all.
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    if (!name.startsWith('--') || name.length === 2) return null;
    for (let position = 2; position < name.length; position++) {
        if (!PROPERTY_NAME_CHAR.test(name[position])) return null;
    }
    if (comma === -1) return { name };
    return { name, fallback: inner.slice(comma + 1).trim() };
}

/**
 * Follow a var() chain to the value it ends in.
 *
 * @param value - Starting value text.
 * @param properties - Custom properties visible to the verdict.
 * @returns The final value, or null when the chain leaves the visible sheet
 * (or cycles past the hop budget) and nothing can be proven.
 */
export function resolveCustomPropertyValue(
    value: string,
    properties: ReadonlyMap<string, string>,
): string | null {
    let current = value.trim();
    for (let hop = 0; hop < 8; hop++) {
        const reference = parseVarReference(current);
        if (reference === null) {
            return current;
        }
        const next = properties.get(reference.name) ?? reference.fallback;
        if (next === undefined) {
            return null;
        }
        current = next.trim();
    }
    return null;
}

/**
 * Split one string on its top-level occurrences of a separator.
 *
 * @param text - Text to split.
 * @param separator - Single-character separator.
 * @returns Segments, parenthesised groups kept whole.
 */
function splitTopLevel(text: string, separator: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let segmentStart = 0;
    for (let position = 0; position < text.length; position++) {
        const character = text[position];
        if (character === '(') depth += 1;
        else if (character === ')') depth -= 1;
        else if (character === separator && depth === 0) {
            out.push(text.slice(segmentStart, position));
            segmentStart = position + 1;
        }
    }
    out.push(text.slice(segmentStart));
    return out;
}

/**
 * Every color argument inside the rule's `color-mix( in X, COLOR N%, transparent )` wraps.
 *
 * @param rule - The rule text Tailwind emitted for one candidate class.
 * @returns The color argument texts, percentages stripped.
 */
function colorMixArguments(rule: string): string[] {
    const out: string[] = [];
    let index = 0;
    while (index < rule.length) {
        const start = rule.indexOf('color-mix(', index);
        if (start === -1) break;
        const open = start + 'color-mix('.length;
        let depth = 1;
        let end = open;
        while (end < rule.length && depth > 0) {
            const character = rule[end];
            if (character === '(') depth += 1;
            else if (character === ')') depth -= 1;
            end += 1;
        }
        index = end;
        const parts = splitTopLevel(rule.slice(open, end - 1), ',');
        if (parts.length !== 3 || parts[2].trim() !== 'transparent') continue;
        const colorAndPercent = parts[1].trim();
        const lastSpace = colorAndPercent.lastIndexOf(' ');
        if (lastSpace === -1 || !colorAndPercent.endsWith('%')) continue;
        out.push(colorAndPercent.slice(0, lastSpace).trim());
    }
    return out;
}

/**
 * The proven-broken color value inside one compiled rule, if any.
 *
 * @param rule - The rule text Tailwind emitted for one candidate class.
 * @param properties - Custom properties visible to the verdict.
 * @returns The bare-triplet value the modifier cannot dim, or null when every
 * color-mix argument resolves to something valid (or to something unprovable).
 */
export function brokenOpacityValue(
    rule: string,
    properties: ReadonlyMap<string, string>,
): string | null {
    for (const argument of colorMixArguments(rule)) {
        const resolved = resolveCustomPropertyValue(argument, properties);
        if (resolved !== null && BARE_RGB_TRIPLET.test(resolved)) {
            return resolved;
        }
    }
    return null;
}
