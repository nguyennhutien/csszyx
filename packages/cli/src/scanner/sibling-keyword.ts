/**
 * An sz key that takes theme tokens, handed a keyword that belongs to a sibling.
 *
 * Several sz keys lower under one Tailwind prefix. `color` and `textWrap` both
 * feed `text-`, so `color: 'balance'` emits `text-balance`: a real class, with
 * real CSS, that sets `text-wrap` and no colour at all. Every existing check
 * passes it. The type accepts any string because a colour may be any theme
 * token; the dead-class pass sees a class that is very much alive; the page
 * renders, just without the colour that was asked for.
 *
 * The discriminator is the CSS PROPERTY the emitted class sets. `fill-none`
 * sets `fill`, the same property `fill: 'red-500'` sets, so `fill: 'none'` is a
 * legitimate spelling. `text-balance` sets `text-wrap`, which `color` never
 * sets. Measured over a five-library corpus and this repo's own apps, that test
 * is the whole difference between a usable rule and an unusable one: without
 * it, every correct `color: 'white'` and `fill: 'none'` in the tree is
 * reported.
 *
 * Only keys with ONE domain are covered. A shorthand like `outline` or `bg`
 * takes a colour AND keywords of its own — `outline: 'none'` is the documented
 * spelling — so a foreign value cannot be told from an owned one there, and
 * they are left out rather than reported wrongly.
 *
 * The project's own design system answers, never Tailwind's defaults alone: a
 * project that declares `--color-balance` has given `color: 'balance'` a
 * meaning, and this stays quiet for it.
 *
 * @module
 */

/** A theme namespace an open-domain key draws its values from. */
export type ThemeNamespace = 'colors' | 'textSizes' | 'fontFamilies' | 'fontWeights';

/** What the project's design system is asked about a candidate. */
export interface KeywordOracle {
    /**
     * Token names the project resolves in one namespace, defaults included.
     *
     * @param namespace - The namespace to list.
     * @returns The names, empty when the namespace has none.
     */
    themeNames(namespace: ThemeNamespace): ReadonlySet<string>;
    /**
     * Whether Tailwind reads the whole class name as a static utility.
     *
     * @param className - The emitted class.
     * @returns True when the name is a built-in keyword utility.
     */
    isStaticUtility(className: string): boolean;
    /**
     * The CSS properties a class sets.
     *
     * @param className - The class to compile.
     * @returns The property names, or null when the class produces no rule.
     */
    propertiesOf(className: string): ReadonlySet<string> | null;
}

/** One literal `key: 'value'` read out of an sz prop. */
export interface SzValuePair {
    key: string;
    value: string;
    /** 1-based line the pair was written on. */
    line: number;
}

/** One value that belongs to a different key than the one it was written on. */
export interface SiblingKeywordFinding extends SzValuePair {
    /** The class the pair emits. */
    className: string;
    /** The CSS properties that class actually sets. */
    sets: string[];
}

/** How one single-domain key reaches Tailwind. */
interface OpenDomainKey {
    /** The class prefix the key lowers under. */
    prefix: string;
    /** The namespace its values come from. */
    namespace: ThemeNamespace;
    /**
     * A token certain to be in that namespace.
     *
     * Used to learn the key's OWN CSS property from the project's design
     * system rather than restating a property map here — a second copy would
     * drift the moment Tailwind changed what a utility sets.
     */
    probe: string;
}

/**
 * The keys this rule covers: exactly those with a single value domain.
 *
 * Every entry is a key whose documented values are theme tokens and nothing
 * else, which is what makes a non-token value evidence of a mistake. Shorthands
 * that also carry their own keywords are deliberately absent — see the module
 * comment.
 */
const OPEN_DOMAIN_KEYS: Readonly<Record<string, OpenDomainKey>> = {
    color: { prefix: 'text', namespace: 'colors', probe: 'red-500' },
    borderColor: { prefix: 'border', namespace: 'colors', probe: 'red-500' },
    ringColor: { prefix: 'ring', namespace: 'colors', probe: 'red-500' },
    outlineColor: { prefix: 'outline', namespace: 'colors', probe: 'red-500' },
    accentColor: { prefix: 'accent', namespace: 'colors', probe: 'red-500' },
    caretColor: { prefix: 'caret', namespace: 'colors', probe: 'red-500' },
    divideColor: { prefix: 'divide', namespace: 'colors', probe: 'red-500' },
    decorationColor: { prefix: 'decoration', namespace: 'colors', probe: 'red-500' },
    shadowColor: { prefix: 'shadow', namespace: 'colors', probe: 'red-500' },
    placeholderColor: { prefix: 'placeholder', namespace: 'colors', probe: 'red-500' },
    fill: { prefix: 'fill', namespace: 'colors', probe: 'red-500' },
    stroke: { prefix: 'stroke', namespace: 'colors', probe: 'red-500' },
    fontSize: { prefix: 'text', namespace: 'textSizes', probe: 'lg' },
    fontFamily: { prefix: 'font', namespace: 'fontFamilies', probe: 'sans' },
    fontWeight: { prefix: 'font', namespace: 'fontWeights', probe: 'bold' },
};

/**
 * Find values written on a key that owns neither the value nor its property.
 *
 * @param pairs - Literal pairs read from sz props.
 * @param oracle - The project's design system.
 * @returns One finding per foreign value, in the order the pairs were given.
 */
export function findSiblingKeywordValues(
    pairs: readonly SzValuePair[],
    oracle: KeywordOracle,
): SiblingKeywordFinding[] {
    const findings: SiblingKeywordFinding[] = [];
    for (const pair of pairs) {
        const { key, value } = pair;
        const open = OPEN_DOMAIN_KEYS[key];
        if (!open) continue;
        // A token the project resolves is the open domain working as intended.
        if (oracle.themeNames(open.namespace).has(value)) continue;

        const className = `${open.prefix}-${value}`;
        // Only a whole-name built-in can be a sibling's keyword. Anything else
        // is an arbitrary value or a dead class, both other checks' findings.
        if (!oracle.isStaticUtility(className)) continue;

        const sets = oracle.propertiesOf(className);
        const own = oracle.propertiesOf(`${open.prefix}-${open.probe}`);
        if (!sets || !own) continue;
        // Sharing a property means the keyword belongs to this key after all.
        if ([...sets].some(property => own.has(property))) continue;

        findings.push({ ...pair, className, sets: [...sets] });
    }
    return findings;
}

/** `sz` or `szs` as a whole JSX attribute name, at its opening brace. */
const SZ_ATTRIBUTE = /(?<![\w$])szs?\s*=\s*\{/g;

/** A literal `key: 'value'` or `key: "value"` pair. */
const LITERAL_PAIR = /(?<![\w$])([A-Z_$][\w$]*)\s*:\s*(['"])([^'"\\\n]*)\2/gi;

/**
 * Read literal `key: 'value'` pairs out of every sz prop in one source file.
 *
 * Scoped to the attribute on purpose. The same key names appear in chart
 * configs, style objects and design tokens, and a file-wide scan reports those
 * too — which is the difference between a check a project can run and one it
 * turns off.
 *
 * @param source - Source module text.
 * @returns The pairs, in source order.
 */
export function szValuePairs(source: string): SzValuePair[] {
    const pairs: SzValuePair[] = [];
    SZ_ATTRIBUTE.lastIndex = 0;
    let attribute = SZ_ATTRIBUTE.exec(source);
    while (attribute !== null) {
        // Resume just after the attribute name, so a nested element inside the
        // expression is still reached rather than skipped along with its
        // parent. Set before the body runs, so every exit path advances.
        const resumeFrom = attribute.index + attribute[0].length;
        const end = expressionEnd(source, resumeFrom - 1);
        if (end !== -1) {
            const region = source.slice(attribute.index, end);
            for (const pair of region.matchAll(LITERAL_PAIR)) {
                const [, key, , value] = pair;
                pairs.push({
                    key,
                    value,
                    line: lineAt(source, attribute.index + (pair.index ?? 0)),
                });
            }
        }
        SZ_ATTRIBUTE.lastIndex = resumeFrom;
        attribute = SZ_ATTRIBUTE.exec(source);
    }
    return pairs;
}

/**
 * The 1-based line an offset falls on.
 *
 * Counted from the start each time rather than from a prebuilt index: a file
 * yields a handful of pairs at most, so an index would cost more to build than
 * the scans it saves.
 *
 * @param source - Source module text.
 * @param offset - Offset into it.
 * @returns The 1-based line number.
 */
function lineAt(source: string, offset: number): number {
    let line = 1;
    for (let index = 0; index < offset && index < source.length; index += 1) {
        if (source[index] === '\n') line += 1;
    }
    return line;
}

/**
 * Index just past the expression container opened at `start`.
 *
 * @param source - Source module text.
 * @param start - Index of the opening brace.
 * @returns The index after the matching brace, or -1 when it is unbalanced.
 */
function expressionEnd(source: string, start: number): number {
    let depth = 0;
    let quote = '';
    for (let index = start; index < source.length; index += 1) {
        const character = source[index];
        if (quote) {
            if (character === '\\') index += 1;
            else if (character === quote) quote = '';
            continue;
        }
        if (character === "'" || character === '"' || character === '`') {
            quote = character;
        } else if (character === '{' || character === '[' || character === '(') {
            depth += 1;
        } else if (character === '}' || character === ']' || character === ')') {
            depth -= 1;
            if (depth === 0) return index + 1;
        }
    }
    return -1;
}
