/**
 * CSS Mangler Module - Zero-Risk CSS Selector Transformation.
 *
 * Uses PostCSS AST to safely transform CSS class selectors using the mangle map.
 * This module guarantees:
 * - Only class selectors are touched (never IDs, attributes, CSS variables)
 * - Exact class matching (no partial replacements)
 * - Proper handling of Tailwind's escaped characters
 * - Zero CSS syntax errors after transformation
 *
 * @module @csszyx/unplugin/css-mangler
 */

import postcss, { type Root, type Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';

const BACKSLASH = String.fromCodePoint(92);

/**
 * Mangle map type: original class name -> mangled ID.
 */
export type MangleMap = Record<string, string>;

/**
 * CSS Mangler options.
 */
export interface CSSManglerOptions {
    /**
     * Enable debug logging.
     */
    debug?: boolean;

    /**
     * Source file path for better error messages.
     */
    from?: string;
}

/**
 * One `[class …]` attribute selector found while walking a stylesheet.
 *
 * Reported, never rewritten: such a selector matches the class attribute's
 * text, and a mangled token carries no trace of the name it replaced, so no
 * rewrite is correct. The build compares these against the mangle map to say
 * which renamed classes the selector was matching by name.
 */
export interface ClassAttributeSelector {
    /** The attribute operator: `=`, `~=`, `|=`, `^=`, `$=` or `*=`. */
    operator: string;
    /** The value as written, unescaped and unquoted. */
    value: string;
    /** True when the selector carries the `i` flag. */
    insensitive: boolean;
}

/**
 * The identity of an attribute selector, for de-duplication across rules,
 * media queries and assets.
 *
 * @param selector - One collected selector.
 * @returns A key equal for two selectors that compare the same way.
 */
export function classAttributeSelectorKey(selector: ClassAttributeSelector): string {
    return `${selector.operator}\u0000${selector.value}\u0000${selector.insensitive ? 'i' : ''}`;
}

/**
 * CSS Mangler result.
 */
export interface CSSManglerResult {
    /**
     * The transformed CSS.
     */
    css: string;

    /**
     * Every distinct `[class …]` attribute selector the stylesheet contains,
     * in first-seen order. See {@link ClassAttributeSelector}.
     */
    classAttributeSelectors: ClassAttributeSelector[];

    /**
     * Number of selectors transformed.
     */
    transformedCount: number;

    /**
     * List of classes that were mangled.
     */
    mangledClasses: string[];

    /**
     * List of classes not found in the mangle map.
     */
    unmangledClasses: string[];
}

/**
 * Unescape a Tailwind CSS class name.
 *
 * Tailwind uses CSS escape sequences for special characters:
 * - `\.` for literal `.` (e.g., `p-0\.5` -> `p-0.5`)
 * - `\/` for literal `/` (e.g., `w-1\/2` -> `w-1/2`)
 * - `\:` for literal `:` (e.g., `hover\:bg-red-500` in CSS -> `hover:bg-red-500`)
 * - `\!` for literal `!` (important modifier)
 * - `\[` and `\]` for arbitrary values
 * - `\#` for hex colors
 * - `\@` for at-rules in class names
 * - `\32` (hex for '2') for numeric prefixes like `2xl:`
 * - Unicode escapes like `\31 ` (space-terminated)
 *
 * @param {string} escapedName - The escaped class name from CSS selector
 * @returns {string} The unescaped class name
 */
export function unescapeTailwindClass(escapedName: string): string {
    let result = '';
    let i = 0;

    while (i < escapedName.length) {
        if (escapedName[i] !== BACKSLASH) {
            result += escapedName[i];
            i++;
            continue;
        }
        const decoded = readCssEscape(escapedName, i + 1);
        if (!decoded) break;
        result += decoded.value;
        i = decoded.next;
    }

    return result;
}

/**
 * Decode one CSS escape beginning after its backslash.
 * @param source - Escaped CSS identifier.
 * @param start - Offset immediately after the backslash.
 * @returns Decoded value and next offset, or null for a trailing backslash.
 */
function readCssEscape(source: string, start: number): { value: string; next: number } | null {
    if (start >= source.length) return null;
    if (!/[0-9a-f]/i.test(source[start])) return { value: source[start], next: start + 1 };
    let next = start;
    let hex = '';
    while (next < source.length && /[0-9a-f]/i.test(source[next]) && hex.length < 6) {
        hex += source[next];
        next++;
    }
    if (source[next] === ' ') next++;
    const codePoint = Number.parseInt(hex, 16);
    return { value: codePoint > 0 ? String.fromCodePoint(codePoint) : '', next };
}

/**
 * Escape a leading character when CSS identifier grammar requires it.
 *
 * @param className Complete class name.
 * @param char Leading character.
 * @returns Escaped prefix or null when ordinary escaping should continue.
 */
function escapeLeadingClassCharacter(className: string, char: string): string | null {
    if (/\d/.test(char)) {
        return `${BACKSLASH}3${char} `;
    }
    if (char === '-' && className.length > 1) {
        const next = className[1] as string;
        if (/\d/.test(next) || next === '-') {
            return `${BACKSLASH}-`;
        }
    }
    return null;
}

/**
 * Escape one non-leading CSS identifier character.
 *
 * @param char Character to escape when required.
 * @returns CSS-safe character representation.
 */
function escapeClassCharacter(char: string): string {
    const codePoint = char.codePointAt(0) ?? 0;
    const requiresEscape =
        (codePoint >= 33 && codePoint <= 47 && codePoint !== 45) ||
        (codePoint >= 58 && codePoint <= 64) ||
        (codePoint >= 91 && codePoint <= 94) ||
        codePoint === 96 ||
        (codePoint >= 123 && codePoint <= 126);
    if (requiresEscape) {
        return `${BACKSLASH}${char}`;
    }
    return char;
}

/**
 * Escape a class name for use in CSS selector.
 *
 * This is the inverse of unescapeTailwindClass.
 *
 * @param {string} className - The unescaped class name
 * @returns {string} The escaped class name for CSS
 */
export function escapeCSSClassName(className: string): string {
    let result = '';

    for (let i = 0; i < className.length; i++) {
        const char = className[i] as string;
        if (i === 0) {
            const escapedLeading = escapeLeadingClassCharacter(className, char);
            if (escapedLeading !== null) {
                result += escapedLeading;
                continue;
            }
        }
        result += escapeClassCharacter(char);
    }

    return result;
}

/**
 * Create a PostCSS selector processor that mangles class names.
 *
 * @param {MangleMap} mangleMap - The mangle map
 * @param {Set<string>} mangledClasses - Set to track which classes were mangled
 * @param {Set<string>} unmangledClasses - Set to track classes not in the map
 * @param {Map<string, ClassAttributeSelector>} attributeSelectors - Collects every
 *   `[class …]` attribute selector walked, keyed by operator, value and flag
 * @returns {selectorParser.SyncProcessor<string>} PostCSS selector processor
 */
function createSelectorProcessor(
    mangleMap: MangleMap,
    mangledClasses: Set<string>,
    unmangledClasses: Set<string>,
    attributeSelectors: Map<string, ClassAttributeSelector> = new Map(),
): selectorParser.Processor<void> {
    return selectorParser(selectors => {
        selectors.walkAttributes(attribute => {
            // A namespaced attribute is not the HTML `class`; a presence check
            // (`[class]`) and an empty value (`[class*=""]`, which the spec
            // says represents nothing) do not depend on any name.
            if (attribute.namespace !== undefined) return;
            if (attribute.attribute.toLowerCase() !== 'class') return;
            const { operator, value } = attribute;
            if (operator === undefined || value === undefined || value.length === 0) return;
            const selector = { operator, value, insensitive: attribute.insensitive === true };
            const key = classAttributeSelectorKey(selector);
            if (!attributeSelectors.has(key)) attributeSelectors.set(key, selector);
        });
        selectors.walkClasses(classNode => {
            // Get the class value (already unescaped by postcss-selector-parser)
            const originalValue = classNode.value;

            // Also try to unescape in case there are nested escapes
            const unescapedValue = unescapeTailwindClass(originalValue);

            // Check both values against the mangle map
            let mangledValue: string | undefined, matchedKey: string | undefined;

            if (mangleMap[unescapedValue]) {
                mangledValue = mangleMap[unescapedValue];
                matchedKey = unescapedValue;
            } else if (mangleMap[originalValue]) {
                mangledValue = mangleMap[originalValue];
                matchedKey = originalValue;
            }

            if (mangledValue && matchedKey) {
                // Update the class node value
                classNode.value = mangledValue;
                mangledClasses.add(matchedKey);
            } else {
                // Track unmangled classes for debugging
                unmangledClasses.add(originalValue);
            }
        });
    });
}

/**
 * The state one mangling pass carries: the selector processor and what it
 * recorded. Shared by every entry point so the rule-rewrite step, the debug
 * logging and the result shape live in one place.
 */
interface ManglerSession {
    /**
     * Rewrite one rule's selector in place.
     *
     * @param rule - A PostCSS rule.
     * @returns Whether the selector changed.
     */
    mangleRule(rule: Rule): boolean;
    /**
     * Assemble the result once the stylesheet has been walked.
     *
     * @param css - The stylesheet as it now reads.
     * @param transformedCount - How many selectors changed.
     * @returns The transformation result.
     */
    result(css: string, transformedCount: number): CSSManglerResult;
}

/**
 * Start a mangling pass over one stylesheet.
 *
 * @param mangleMap - The mangle map (original -> mangled).
 * @param options - Options.
 * @returns The session the entry point drives.
 */
function createManglerSession(mangleMap: MangleMap, options: CSSManglerOptions): ManglerSession {
    const mangledClasses = new Set<string>();
    const unmangledClasses = new Set<string>();
    const attributeSelectors = new Map<string, ClassAttributeSelector>();
    const selectorProcessor = createSelectorProcessor(
        mangleMap,
        mangledClasses,
        unmangledClasses,
        attributeSelectors,
    );
    return {
        mangleRule(rule) {
            try {
                const originalSelector = rule.selector;
                const newSelector = selectorProcessor.processSync(originalSelector);
                if (newSelector === originalSelector) return false;
                rule.selector = newSelector;
                return true;
            } catch (error) {
                // Log but don't fail on selector parsing errors
                if (options.debug) {
                    console.warn(`[csszyx] Failed to process selector: ${rule.selector}`, error);
                }
                return false;
            }
        },
        result(css, transformedCount) {
            if (options.debug) {
                console.log(`[csszyx] CSS Mangler: ${transformedCount} selectors transformed`);
                console.log(`[csszyx] Mangled classes: ${mangledClasses.size}`);
                console.log(`[csszyx] Unmangled classes: ${unmangledClasses.size}`);
            }
            return {
                css,
                transformedCount,
                mangledClasses: Array.from(mangledClasses),
                unmangledClasses: Array.from(unmangledClasses),
                classAttributeSelectors: Array.from(attributeSelectors.values()),
            };
        },
    };
}

/**
 * Mangle CSS selectors using the provided mangle map.
 *
 * This function uses PostCSS AST to safely transform only class selectors,
 * ensuring zero risk of breaking CSS syntax or mangling unintended content.
 *
 * @param {string} css - The CSS content to transform
 * @param {MangleMap} mangleMap - The mangle map (original -> mangled)
 * @param {CSSManglerOptions} options - Options
 * @returns {Promise<CSSManglerResult>} The transformation result
 */
export async function mangleCSS(
    css: string,
    mangleMap: MangleMap,
    options: CSSManglerOptions = {},
): Promise<CSSManglerResult> {
    const session = createManglerSession(mangleMap, options);
    let transformedCount = 0;
    const csszyxManglerPlugin = {
        postcssPlugin: 'csszyx-css-mangler',
        Rule(rule: Rule) {
            if (session.mangleRule(rule)) transformedCount++;
        },
    };
    const result = await postcss([csszyxManglerPlugin]).process(css, {
        from: options.from,
    });
    return session.result(result.css, transformedCount);
}

/**
 * Synchronous version of mangleCSS.
 *
 * @param {string} css - The CSS content to transform
 * @param {MangleMap} mangleMap - The mangle map
 * @param {CSSManglerOptions} options - Options
 * @returns {CSSManglerResult} The transformation result
 */
export function mangleCSSSync(
    css: string,
    mangleMap: MangleMap,
    options: CSSManglerOptions = {},
): CSSManglerResult {
    const session = createManglerSession(mangleMap, options);
    let transformedCount = 0;
    const root: Root = postcss.parse(css, { from: options.from });
    root.walkRules(rule => {
        if (session.mangleRule(rule)) transformedCount++;
    });
    return session.result(root.toString(), transformedCount);
}

/**
 * Create a PostCSS plugin for CSS mangling.
 *
 * This can be used directly in a PostCSS pipeline.
 *
 * @param {MangleMap} mangleMap - The mangle map
 * @param {CSSManglerOptions} options - Options
 * @returns {postcss.Plugin} PostCSS plugin
 *
 * @example
 * ```typescript
 * import postcss from 'postcss';
 * import { createPostCSSPlugin } from '@csszyx/unplugin/css-mangler';
 *
 * const result = await postcss([
 *     createPostCSSPlugin(mangleMap, { debug: true })
 * ]).process(css);
 * ```
 */
export function createPostCSSPlugin(
    mangleMap: MangleMap,
    options: CSSManglerOptions = {},
): postcss.Plugin {
    const session = createManglerSession(mangleMap, options);
    let transformedCount = 0;
    return {
        postcssPlugin: 'csszyx-css-mangler',
        Rule(rule) {
            if (session.mangleRule(rule)) transformedCount++;
        },
        OnceExit() {
            // The plugin has no result object to hand back, so under debug
            // the count is the log — one line, as this entry point always did.
            if (options.debug) {
                const { mangledClasses } = session.result('', transformedCount);
                console.log(`[csszyx] Mangled ${mangledClasses.length} unique classes`);
            }
        },
    };
}
