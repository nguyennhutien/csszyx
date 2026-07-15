/**
 * Class Parser: Parses a single Tailwind CSS class (without variants)
 * into an sz prop/value pair.
 *
 * Uses longest-prefix-match against sorted prefix table, then
 * disambiguation for ambiguous prefixes (text-*, font-*, border-*, bg-*).
 */

import {
    ALIGN_CONTENT_KEYWORDS,
    BG_ATTACHMENT_KEYWORDS,
    BG_POSITION_KEYWORDS,
    BG_REPEAT_KEYWORDS,
    BG_SIZE_KEYWORDS,
    BOOLEAN_VALUE_MAP,
    BORDER_STYLE_KEYWORDS,
    BORDER_WIDTH_KEYWORDS,
    DECORATION_STYLE_KEYWORDS,
    DECORATION_THICKNESS_KEYWORDS,
    FONT_FAMILY_KEYWORDS,
    FONT_STRETCH_KEYWORDS,
    FONT_WEIGHT_KEYWORDS,
    FRACTION_SUPPORTED,
    NEGATIVE_ALLOWED,
    OBJECT_FIT_KEYWORDS,
    OBJECT_POSITION_KEYWORDS,
    OUTLINE_STYLE_KEYWORDS,
    REVERSE_BOOLEAN_MAP,
    REVERSE_PROPERTY_MAP,
    SHADOW_SIZE_KEYWORDS,
    SORTED_PREFIXES,
    SPACING_PROPS,
    TEXT_ALIGN_KEYWORDS,
    TEXT_OVERFLOW_KEYWORDS,
    TEXT_SIZE_KEYWORDS,
    TEXT_WRAP_KEYWORDS,
    TRANSITION_PROPERTY_KEYWORDS,
} from './reverse-map.js';

/** Parsed sz prop/value pair from a Tailwind class. */
export interface ParsedClass {
    prop: string;
    value: unknown; // string | number | boolean | object
    cssProperty?: string;
}

/** Parser options for migration-specific output policy. */
export interface ParseClassOptions {
    /**
     * Display utilities can be emitted as csszyx boolean sugar (`flex: true`) or
     * as the canonical CSS property (`display: 'flex'`).
     */
    display?: 'sugar' | 'canonical';
}

/**
 * Parse a single Tailwind utility class (no variant prefix) into an sz prop/value.
 * Returns null if the class is not recognized.
 * @param cls - The Tailwind utility class string
 * @param _options - Reserved parser output policy for migration callers.
 * @returns {ParsedClass | null} Parsed prop/value or null if unrecognized
 */
export function parseClass(cls: string, _options: ParseClassOptions = {}): ParsedClass | null {
    const { input, source, negative, important } = parseClassModifiers(cls);

    const container = parseContainerMarker(input);
    if (container) {
        return container;
    }

    const boolResult = tryBooleanMatch(input);
    if (boolResult) {
        return applyImportant(boolResult, important);
    }

    const gradResult = tryGradient(source, negative);
    if (gradResult) {
        return applyImportant(gradResult, important);
    }

    const utility = parseLongestPrefix(source, negative);
    if (utility) {
        return applyImportant(utility, important);
    }

    const customProperty = parseCustomPropertyDeclaration(input);
    return customProperty ? applyImportant(customProperty, important) : null;
}

/**
 * Splits important and negative syntax from a Tailwind class.
 * @param cls - The original utility class.
 * @returns Its normalized source and modifier flags.
 */
function parseClassModifiers(cls: string): {
    input: string;
    source: string;
    negative: boolean;
    important: boolean;
} {
    const important = cls.endsWith('!');
    const input = important ? cls.slice(0, -1) : cls;
    const negative = input.startsWith('-');
    return { input, source: negative ? input.slice(1) : input, negative, important };
}

/**
 * Parses the base and named container-query markers.
 * @param input - The utility after removing the important marker.
 * @returns The container marker result, or null.
 */
function parseContainerMarker(input: string): ParsedClass | null {
    if (input === '@container') return { prop: '@container', value: true };
    return input.startsWith('@container/')
        ? { prop: '@container', value: input.slice('@container/'.length) }
        : null;
}

/**
 * Applies longest-prefix matching to an unsigned utility source.
 * @param source - The utility after removing its negative marker.
 * @param negative - Whether the original utility was negative.
 * @returns The parsed utility, or null.
 */
function parseLongestPrefix(source: string, negative: boolean): ParsedClass | null {
    for (const prefix of SORTED_PREFIXES) {
        if (source === prefix) {
            const exact = parseExactPrefix(prefix, negative);
            if (exact) return exact;
            continue;
        }
        const parsed = parseValuedPrefix(source, prefix, negative);
        if (parsed) {
            return parsed;
        }
    }
    return null;
}

/**
 * Parses an exact utility prefix with its implicit boolean value.
 * @param prefix - The exact matched prefix.
 * @param negative - Whether the original utility was negative.
 * @returns The implicit utility value, or null.
 */
function parseExactPrefix(prefix: string, negative: boolean): ParsedClass | null {
    if (negative && NEGATIVE_ALLOWED.has(prefix)) return null;
    if (REVERSE_BOOLEAN_MAP[prefix]) {
        return { prop: REVERSE_BOOLEAN_MAP[prefix], value: true };
    }
    const prop = REVERSE_PROPERTY_MAP[prefix];
    if (prefix === 'divide-x' || prefix === 'divide-y') return { prop, value: true };
    if (prefix === 'border') return { prop: 'border', value: true };
    return /^border-[trblxyse]$/.test(prefix) ? { prop, value: true } : null;
}

/**
 * Parses one prefix followed by a non-empty value.
 * @param source - The unsigned utility source.
 * @param prefix - The candidate prefix.
 * @param negative - Whether the original utility was negative.
 * @returns The parsed utility, or null.
 */
function parseValuedPrefix(source: string, prefix: string, negative: boolean): ParsedClass | null {
    if (!source.startsWith(`${prefix}-`)) return null;
    const rawValue = source.slice(prefix.length + 1);
    if (!rawValue || (negative && !NEGATIVE_ALLOWED.has(prefix))) return null;
    if (SPACING_PROPS.has(prefix) && !isValidSpacingValue(rawValue)) return null;
    return disambiguateAndParse(prefix, rawValue, negative);
}

/**
 * Parses an arbitrary CSS custom-property declaration.
 * @param input - The utility after removing the important marker.
 * @returns The custom-property declaration, or null.
 */
function parseCustomPropertyDeclaration(input: string): ParsedClass | null {
    if (!input.startsWith('[') || !input.endsWith(']') || !input.includes(':')) return null;
    const inner = input.slice(1, -1);
    if (!inner.startsWith('--')) return null;
    const colonIndex = inner.indexOf(':');
    return {
        prop: inner.slice(0, colonIndex),
        value: inner.slice(colonIndex + 1),
    };
}

/**
 * Applies the important modifier to a parsed result.
 * @param result - The parsed class result to modify
 * @param important - Whether important flag is set
 * @returns {ParsedClass} Result with important modifier applied
 */
function applyImportant(result: ParsedClass, important: boolean): ParsedClass {
    if (!important) {
        return result;
    }
    const base = result.cssProperty ? { cssProperty: result.cssProperty } : {};
    if (typeof result.value === 'string') {
        return { ...base, prop: result.prop, value: `${result.value}!` };
    }
    if (typeof result.value === 'boolean') {
        return { ...base, prop: result.prop, value: '!' };
    }
    // For numeric values, convert to string + !
    if (typeof result.value === 'number') {
        return { ...base, prop: result.prop, value: `${String(result.value)}!` };
    }
    return result;
}

/**
 * Attempts to match a class as a boolean value.
 * @param cls - The class string to match
 * @returns {ParsedClass | null} Parsed result or null if no match
 */
function tryBooleanMatch(cls: string): ParsedClass | null {
    // Canonical value classes (display/position/visibility/text-transform/…) and
    // other class→{prop,value} mappings resolve here first. cssProperty (when set)
    // lets the variant parser fail closed on a same-scope conflict.
    if (BOOLEAN_VALUE_MAP[cls]) {
        const { prop, value, cssProperty } = BOOLEAN_VALUE_MAP[cls];
        return cssProperty ? { prop, value, cssProperty } : { prop, value };
    }

    // Remaining true-boolean shorthands (ring, outline, truncate, grow, …).
    if (REVERSE_BOOLEAN_MAP[cls]) {
        return { prop: REVERSE_BOOLEAN_MAP[cls], value: true };
    }

    return null;
}

/**
 * Attempts to match a class as a display value.
 * @param cls - The class string to match
 * @param options - Parser output policy.
 * @returns {ParsedClass | null} Parsed result or null if no match
 */
// ============================================================================
// GRADIENT PARSING
// ============================================================================

/**
 * Split a gradient utility into its type and remaining suffix.
 *
 * @param className Candidate background-gradient class.
 * @returns Gradient type and suffix, or null when not a gradient.
 */
function parseGradientType(
    className: string,
): { type: 'linear' | 'radial' | 'conic'; suffix: string } | null {
    const types = ['linear', 'radial', 'conic'] as const;
    for (const type of types) {
        const prefix = `bg-${type}`;
        if (className.startsWith(prefix)) {
            return { type, suffix: className.slice(prefix.length) };
        }
    }
    return null;
}

/**
 * Parse the optional gradient direction suffix.
 *
 * @param input Gradient suffix before interpolation mode.
 * @param negative Whether numeric angles are negative.
 * @returns Parsed direction, or undefined when absent.
 */
function parseGradientDirection(input: string, negative: boolean): string | number | undefined {
    if (!input.startsWith('-')) {
        return undefined;
    }
    const direction = input.slice(1);
    if (direction.startsWith('[') && direction.endsWith(']')) {
        return direction.slice(1, -1).replace(/_/g, ' ');
    }
    if (direction.startsWith('(') && direction.endsWith(')')) {
        return direction.slice(1, -1);
    }
    if (/^\d+$/.test(direction)) {
        const angle = Number.parseInt(direction, 10);
        return negative ? -angle : angle;
    }
    return direction;
}

/**
 * Attempts to parse a gradient class (linear, radial, conic).
 * @param cls - The class string to parse
 * @param negative - Whether the class has a negative prefix
 * @returns {ParsedClass | null} Parsed gradient result or null
 */
function tryGradient(cls: string, negative: boolean): ParsedClass | null {
    // bg-linear-to-r, bg-linear-45, bg-linear-to-r/hsl
    // bg-radial, bg-radial-[at_50%_75%], bg-radial/oklab
    // bg-conic, bg-conic-90, bg-conic-90/oklch

    const parsedType = parseGradientType(cls);
    if (!parsedType) {
        return null;
    }
    let { suffix: input } = parsedType;

    // Parse color interpolation (after /)
    let colorInterp: string | undefined;
    // Only split on / that's not inside brackets
    const slashIdx = findTopLevelSlash(input);
    if (slashIdx !== -1) {
        colorInterp = input.slice(slashIdx + 1);
        input = input.slice(0, slashIdx);
    }

    // Parse direction
    const grad: Record<string, unknown> = { gradient: parsedType.type };
    const direction = parseGradientDirection(input, negative);
    if (direction !== undefined) {
        grad.dir = direction;
    }

    if (colorInterp) {
        grad.in = colorInterp;
    }

    return { prop: 'bgImg', value: grad };
}

/**
 * Finds the first top-level slash not inside brackets.
 * @param s - The string to search
 * @returns {number} Index of the slash or -1 if none
 */
function findTopLevelSlash(s: string): number {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '[' || s[i] === '(') {
            depth++;
        } else if (s[i] === ']' || s[i] === ')') {
            depth--;
        } else if (s[i] === '/' && depth === 0) {
            return i;
        }
    }
    return -1;
}

// ============================================================================
// DISAMBIGUATE AND PARSE
// ============================================================================

/**
 * Disambiguates prefix and parses the raw value.
 * @param prefix - The matched Tailwind prefix
 * @param rawValue - The value portion after the prefix
 * @param negative - Whether the class has a negative prefix
 * @returns {ParsedClass | null} Parsed result or null if invalid
 */
function disambiguateAndParse(
    prefix: string,
    rawValue: string,
    negative: boolean,
): ParsedClass | null {
    const { value, opacity } = extractOpacity(prefix, rawValue);

    // Disambiguate ambiguous prefixes
    const result = disambiguate(prefix, value, negative);
    if (!result) {
        return null;
    }

    // Apply opacity
    if (opacity !== undefined && typeof result.value === 'string') {
        return {
            prop: result.prop,
            value: { color: result.value, op: opacity },
        };
    }

    return result;
}

/**
 * Separates a top-level color opacity modifier from a utility value.
 * @param prefix - The matched Tailwind prefix.
 * @param rawValue - The value portion after the prefix.
 * @returns The base value and optional normalized opacity.
 */
function extractOpacity(
    prefix: string,
    rawValue: string,
): { value: string; opacity?: string | number } {
    const slashIndex = findTopLevelSlash(rawValue);
    const isFraction = FRACTION_SUPPORTED.has(prefix) && /^\d+\/\d+$/.test(rawValue);
    if (slashIndex === -1 || isGradientPrefix(prefix) || isFraction) {
        return { value: rawValue };
    }
    return {
        value: rawValue.slice(0, slashIndex),
        opacity: parseOpacity(rawValue.slice(slashIndex + 1)),
    };
}

/**
 * Normalizes bracketed, parenthesized, numeric, and percentage opacity values.
 * @param rawOpacity - The opacity substring after the slash.
 * @returns The normalized opacity value.
 */
function parseOpacity(rawOpacity: string): string | number {
    if (rawOpacity.startsWith('[') && rawOpacity.endsWith(']')) {
        const unwrapped = rawOpacity.slice(1, -1);
        return unwrapped.includes('%') ? unwrapped : numericOpacity(unwrapped);
    }
    if (rawOpacity.startsWith('(') && rawOpacity.endsWith(')')) {
        return rawOpacity.slice(1, -1);
    }
    return numericOpacity(rawOpacity);
}

/**
 * Converts a numeric opacity string while preserving non-numeric tokens.
 * @param value - The candidate opacity value.
 * @returns A number when parseable; otherwise the original string.
 */
function numericOpacity(value: string): string | number {
    const numeric = Number(value);
    return Number.isNaN(numeric) ? value : numeric;
}

/**
 * Checks if a prefix is a gradient stop prefix.
 * @param prefix - The prefix to check
 * @returns {boolean} True if from, via, or to
 */
function isGradientPrefix(prefix: string): boolean {
    return prefix === 'from' || prefix === 'via' || prefix === 'to';
}

/**
 * Routes ambiguous prefixes to specific disambiguators.
 * @param prefix - The matched Tailwind prefix
 * @param value - The parsed value string
 * @param negative - Whether the class has a negative prefix
 * @returns {ParsedClass | null} Parsed result or null if invalid
 */
function disambiguate(prefix: string, value: string, negative: boolean): ParsedClass | null {
    switch (prefix) {
        case 'text':
            return disambiguateText(value);
        case 'font':
            return disambiguateFont(value);
        case 'border':
            return disambiguateBorder(value);
        case 'bg':
            return disambiguateBg(value);
        case 'object':
            return disambiguateObject(value);
        case 'shadow':
            return disambiguateShadow(value);
        case 'outline':
            return disambiguateOutline(value);
        case 'decoration':
            return disambiguateDecoration(value);
        case 'transition':
            return disambiguateTransition(value);
        case 'ring':
            return disambiguateRing(value, negative);
        case 'ring-offset':
            return disambiguateRingOffset(value);
        case 'inset-ring':
            return disambiguateInsetRing(value, negative);
        case 'inset-shadow':
            return disambiguateInsetShadow(value);
        case 'stroke':
            return disambiguateStroke(value);
        case 'from':
        case 'via':
        case 'to':
            return disambiguateGradientStop(prefix, value);
        case 'list':
            return disambiguateList(value);
        case 'ease':
            return { prop: 'ease', value: parseValue('ease', value, negative) };
        case 'snap':
            return disambiguateSnap(value);
        case 'content':
            return disambiguateContent(value);
        case 'flex':
            return disambiguateFlex(value);
        case 'table':
            return disambiguateTable(value);
        case 'divide':
            return disambiguateDivide(value);
        case 'break':
            // break-words belongs to overflow-wrap (wrap), not word-break
            if (value === 'words') {
                return { prop: 'wrap', value: 'break-word' };
            }
            return { prop: 'break', value };
        case 'wrap':
            return { prop: 'wrap', value };
        default:
            // Standard prefix-value
            return {
                prop: REVERSE_PROPERTY_MAP[prefix] || prefix,
                value: parseValue(prefix, value, negative),
            };
    }
}

// ============================================================================
// DISAMBIGUATION FUNCTIONS
// ============================================================================

/**
 * Disambiguates text-* classes by keyword type.
 * @param value - The value after the text prefix
 * @returns {ParsedClass | null} Parsed text property result
 */
function disambiguateText(value: string): ParsedClass | null {
    if (TEXT_SIZE_KEYWORDS.has(value)) {
        return { prop: 'text', value };
    }
    if (TEXT_ALIGN_KEYWORDS.has(value)) {
        return { prop: 'textAlign', value };
    }
    if (TEXT_WRAP_KEYWORDS.has(value)) {
        return { prop: 'textWrap', value };
    }
    if (TEXT_OVERFLOW_KEYWORDS.has(value)) {
        return { prop: 'textOverflow', value };
    }
    // Arbitrary dimension → font size (e.g. text-[0.8rem], text-[16px])
    if (isArbitraryDimension(value)) {
        return { prop: 'text', value: parseStringValue(value) };
    }
    // Default: color
    return { prop: 'color', value: parseStringValue(value) };
}

/**
 * Disambiguates font-* classes (and the ambiguous `font` sz key) by value type:
 * a weight keyword or 3-digit number → `weight`, a stretch keyword → `fontStretch`,
 * anything else → `fontFamily`. Exported so the key-migration can resolve the
 * passthrough `font` key the same way the class migration resolves `font-*`.
 * @param value - The value after the font prefix (or the `font` sz value).
 * @returns {ParsedClass | null} Parsed font property result
 */
export function disambiguateFont(value: string): ParsedClass | null {
    if (FONT_WEIGHT_KEYWORDS.has(value)) {
        return { prop: 'weight', value };
    }
    if (/^\d{3}$/.test(value)) {
        return { prop: 'weight', value: Number.parseInt(value, 10) };
    }
    if (FONT_FAMILY_KEYWORDS.has(value)) {
        return { prop: 'fontFamily', value };
    }
    // font-stretch-* is handled as a separate prefix
    if (value.startsWith('stretch-')) {
        const stretchVal = value.slice('stretch-'.length);
        // Strip arbitrary/CSS-var wrappers so font-stretch-(--s) round-trips
        // (the compiler re-wraps the bare value) instead of double-wrapping.
        return { prop: 'fontStretch', value: parseStringValue(stretchVal) };
    }
    if (FONT_STRETCH_KEYWORDS.has(value)) {
        return { prop: 'fontStretch', value };
    }
    // Arbitrary
    return { prop: 'fontFamily', value: parseStringValue(value) };
}

/**
 * Disambiguates border-* classes by keyword type.
 * @param value - The value after the border prefix
 * @returns Parsed border property result
 */
function disambiguateBorder(value: string): ParsedClass | null {
    if (BORDER_WIDTH_KEYWORDS.has(value) || value === 'px') {
        return { prop: 'border', value: parseNumericOrString('border', value, false) };
    }
    if (BORDER_STYLE_KEYWORDS.has(value)) {
        return { prop: 'borderStyle', value };
    }
    // Arbitrary dimension → width (e.g. border-[1.5px])
    if (isArbitraryDimension(value)) {
        return { prop: 'border', value: parseStringValue(value) };
    }
    // Default: color
    return { prop: 'borderColor', value: parseStringValue(value) };
}

/**
 * Disambiguates bg-* classes by keyword type.
 * @param value - The value after the bg prefix
 * @returns Parsed background property result
 */
function disambiguateBg(value: string): ParsedClass | null {
    if (BG_POSITION_KEYWORDS.has(value)) {
        return { prop: 'bgPos', value };
    }
    if (BG_SIZE_KEYWORDS.has(value)) {
        return { prop: 'bgSize', value };
    }
    if (BG_REPEAT_KEYWORDS.has(value)) {
        return { prop: 'bgRepeat', value };
    }
    if (BG_ATTACHMENT_KEYWORDS.has(value)) {
        return { prop: 'bgAttach', value };
    }
    // Arbitrary multi-token value led by a position keyword → background-position
    // (e.g. bg-[center_top_1rem]). A color or image arbitrary value never takes
    // this shape, so single-token / non-position arbitraries still fall through.
    if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).replace(/_/g, ' ');
        if (inner.includes(' ') && BG_POSITION_KEYWORDS.has(inner.split(' ')[0])) {
            return { prop: 'bgPos', value: inner };
        }
    }
    if (value === 'none') {
        return { prop: 'bgImg', value: 'none' };
    }
    // Default: color
    return { prop: 'bg', value: parseStringValue(value) };
}

/**
 * Disambiguates object-* classes by keyword type.
 * @param value - The value after the object prefix
 * @returns Parsed object-fit or object-position result
 */
function disambiguateObject(value: string): ParsedClass | null {
    if (OBJECT_FIT_KEYWORDS.has(value)) {
        return { prop: 'objectFit', value };
    }
    if (OBJECT_POSITION_KEYWORDS.has(value)) {
        return { prop: 'objectPos', value };
    }
    return { prop: 'objectPos', value: parseStringValue(value) };
}

/**
 * Disambiguates shadow-* classes into size or color.
 * @param value - The value after the shadow prefix
 * @returns Parsed shadow property result
 */
function disambiguateShadow(value: string): ParsedClass | null {
    if (SHADOW_SIZE_KEYWORDS.has(value)) {
        return { prop: 'shadow', value };
    }
    // CSS-var paren form: shadow-(color:--c) is the color, shadow-(--s) is the
    // shadow value itself. Bare arbitrary length also sets the shadow value.
    if (value.startsWith('(') && value.endsWith(')')) {
        const inner = value.slice(1, -1);
        if (inner.startsWith('color:')) {
            return { prop: 'shadowColor', value: inner.slice('color:'.length) };
        }
        return { prop: 'shadow', value: inner };
    }
    // shadow with color
    return { prop: 'shadowColor', value: parseStringValue(value) };
}

/**
 * Disambiguates outline-* classes into style, width, or color.
 * @param value - The value after the outline prefix
 * @returns Parsed outline property result
 */
function disambiguateOutline(value: string): ParsedClass | null {
    if (OUTLINE_STYLE_KEYWORDS.has(value)) {
        return { prop: 'outlineStyle', value };
    }
    // Check if it's a width (number)
    const num = Number(value);
    if (!Number.isNaN(num) && Number.isInteger(num)) {
        return { prop: 'outline', value: num };
    }
    // Arbitrary dimension → width (e.g. outline-[3px])
    if (isArbitraryDimension(value)) {
        return { prop: 'outline', value: parseStringValue(value) };
    }
    // Default: color
    return { prop: 'outlineColor', value: parseStringValue(value) };
}

/**
 * Disambiguates decoration-* classes into style, thickness, or color.
 * @param value - The value after the decoration prefix
 * @returns Parsed decoration property result
 */
function disambiguateDecoration(value: string): ParsedClass | null {
    if (DECORATION_STYLE_KEYWORDS.has(value)) {
        return { prop: 'decorationStyle', value };
    }
    if (DECORATION_THICKNESS_KEYWORDS.has(value)) {
        return { prop: 'decorationThickness', value };
    }
    // Arbitrary dimension (decoration-[3px]) or CSS-var (decoration-(--v)) → thickness.
    // csszyx models the bracket/paren length form as text-decoration-thickness.
    if (isArbitraryDimension(value) || (value.startsWith('(') && value.endsWith(')'))) {
        return { prop: 'decorationThickness', value: parseStringValue(value) };
    }
    // Default: color
    return { prop: 'decorationColor', value: parseStringValue(value) };
}

/**
 * Disambiguates ring-* classes into width or color.
 * @param value - The value after the ring prefix
 * @param negative - Whether the class has a negative prefix
 * @returns Parsed ring property result
 */
function disambiguateRing(value: string, negative: boolean): ParsedClass | null {
    // ring-0, ring-1, ring-2, ring-4, ring-8 → width
    const num = Number(value);
    if (!Number.isNaN(num) && Number.isInteger(num)) {
        return { prop: 'ring', value: negative ? -num : num };
    }
    // Arbitrary dimension → width (e.g. ring-[3px])
    if (isArbitraryDimension(value)) {
        return { prop: 'ring', value: parseStringValue(value) };
    }
    // Default: color
    return { prop: 'ringColor', value: parseStringValue(value) };
}

/**
 * Disambiguates ring-offset-* classes into width or color.
 * @param value - The value after the ring-offset prefix
 * @returns Parsed ring-offset property result
 */
function disambiguateRingOffset(value: string): ParsedClass | null {
    const num = Number(value);
    if (!Number.isNaN(num) && Number.isInteger(num)) {
        return { prop: 'ringOffset', value: num };
    }
    return { prop: 'ringOffsetColor', value: parseStringValue(value) };
}

/**
 * Disambiguates inset-ring-* classes (TW v4) into width or color.
 * inset-ring-1 → { insetRing: 1 }, inset-ring-blue-500 → { insetRingColor: 'blue-500' }
 * @param value - The suffix after 'inset-ring-'.
 * @param negative - Whether a '-' prefix was present.
 * @returns Parsed class with insetRing or insetRingColor prop, or null.
 */
function disambiguateInsetRing(value: string, negative: boolean): ParsedClass | null {
    const num = Number(value);
    if (!Number.isNaN(num) && Number.isInteger(num)) {
        return { prop: 'insetRing', value: negative ? -num : num };
    }
    if (isArbitraryDimension(value)) {
        return { prop: 'insetRing', value: parseStringValue(value) };
    }
    return { prop: 'insetRingColor', value: parseStringValue(value) };
}

/**
 * Disambiguates inset-shadow-* classes (TW v4) into size keyword or color.
 * inset-shadow-sm → { insetShadow: 'sm' }, inset-shadow-blue-500 → { insetShadowColor: 'blue-500' }
 * @param value - The suffix after 'inset-shadow-'.
 * @returns Parsed class with insetShadow or insetShadowColor prop, or null.
 */
function disambiguateInsetShadow(value: string): ParsedClass | null {
    const INSET_SHADOW_SIZE_KEYWORDS = new Set(['sm', 'md', 'lg', 'xl', '2xl', 'none', 'inner']);
    if (INSET_SHADOW_SIZE_KEYWORDS.has(value)) {
        return { prop: 'insetShadow', value };
    }
    if (isArbitraryDimension(value)) {
        return { prop: 'insetShadow', value: parseStringValue(value) };
    }
    return { prop: 'insetShadowColor', value: parseStringValue(value) };
}

/**
 * Disambiguates stroke-* classes into width or color.
 * @param value - The value after the stroke prefix
 * @returns Parsed stroke property result
 */
function disambiguateStroke(value: string): ParsedClass | null {
    const num = Number(value);
    if (!Number.isNaN(num) && Number.isInteger(num)) {
        return { prop: 'strokeWidth', value: num };
    }
    // Arbitrary dimension → width (e.g. stroke-[0.5rem])
    if (isArbitraryDimension(value)) {
        return { prop: 'strokeWidth', value: parseStringValue(value) };
    }
    return { prop: 'stroke', value: parseStringValue(value) };
}

/**
 * Disambiguates gradient color-stop classes (from/via/to) into a color or a
 * color-stop position. A percentage, bare number, or arbitrary length is a stop
 * position (from-4%, from-[300px] → fromPos); anything else is a color.
 * @param prefix - The gradient stop prefix (from/via/to)
 * @param value - The value after the prefix
 * @returns Parsed gradient-stop result
 */
function disambiguateGradientStop(prefix: string, value: string): ParsedClass | null {
    let posKey = 'toPos';
    if (prefix === 'from') posKey = 'fromPos';
    else if (prefix === 'via') posKey = 'viaPos';
    if (/^\d+(\.\d+)?%$/.test(value) || /^\d+$/.test(value) || isArbitraryDimension(value)) {
        return { prop: posKey, value: parseStringValue(value) };
    }
    return { prop: prefix, value: parseStringValue(value) };
}

/**
 * Disambiguates transition-* classes by property keyword.
 * @param value - The value after the transition prefix
 * @returns Parsed transition property result
 */
function disambiguateTransition(value: string): ParsedClass | null {
    if (TRANSITION_PROPERTY_KEYWORDS.has(value)) {
        return { prop: 'transition', value };
    }
    return { prop: 'transition', value: parseStringValue(value) };
}

/**
 * Disambiguates list-* classes into position or style type.
 * @param value - The value after the list prefix
 * @returns Parsed list property result
 */
function disambiguateList(value: string): ParsedClass | null {
    if (value === 'inside' || value === 'outside') {
        return { prop: 'listPos', value };
    }
    return { prop: 'list', value: parseStringValue(value) };
}

/**
 * Disambiguates snap-* classes (fallback, usually caught by boolean map).
 * @param _value - The value after the snap prefix (currently unused — fallback only)
 * @returns Parsed snap property result or null
 */
function disambiguateSnap(_value: string): ParsedClass | null {
    // snap-start, snap-end, etc. should be caught by boolean map
    // Here we handle snap-* prefix matching (shouldn't normally reach here)
    return null;
}

/**
 * Disambiguates content-* classes into align-content vs the `content` CSS property.
 * `content-center`/`content-between`/… are align-content (flex/grid alignment),
 * while `content-none`, `content-['x']`, `content-(--v)`, `content-[attr(x)]` set
 * the generated-content `content` property.
 * @param value - The value after the content prefix
 * @returns Parsed alignContent or content result
 */
function disambiguateContent(value: string): ParsedClass | null {
    if (ALIGN_CONTENT_KEYWORDS.has(value)) {
        return { prop: 'alignContent', value };
    }
    return { prop: 'content', value: parseValue('content', value, false) };
}

/**
 * Disambiguates flex-* classes into direction or shorthand.
 * @param value - The value after the flex prefix
 * @returns Parsed flex property result
 */
function disambiguateFlex(value: string): ParsedClass | null {
    // flex-row, flex-col, flex-row-reverse, flex-col-reverse → flexDir
    const dirValues = new Set(['row', 'col', 'row-reverse', 'col-reverse']);
    if (dirValues.has(value)) {
        return { prop: 'flexDir', value };
    }
    // flex-wrap, flex-nowrap, flex-wrap-reverse → flexWrap (string-based)
    const wrapValues = new Set(['wrap', 'nowrap', 'wrap-reverse']);
    if (wrapValues.has(value)) {
        return { prop: 'flexWrap', value };
    }
    // flex-1, flex-auto, flex-initial, flex-none → flex shorthand
    if (value === '1' || value === 'auto' || value === 'initial' || value === 'none') {
        return { prop: 'flex', value: parseStringValue(value) };
    }
    return { prop: 'flex', value: parseStringValue(value) };
}

/**
 * Disambiguates table-* classes into layout property.
 * @param value - The value after the table prefix
 * @returns Parsed table layout result or null
 */
function disambiguateTable(value: string): ParsedClass | null {
    if (value === 'auto' || value === 'fixed') {
        return { prop: 'tableLayout', value };
    }
    return null;
}

/**
 * Disambiguates divide-* classes (colors only, widths handled elsewhere).
 * @param value - The value after the divide prefix
 * @returns Parsed divide color result
 */
function disambiguateDivide(value: string): ParsedClass | null {
    // divide-{color} — divideColor
    return { prop: 'divideColor', value: parseStringValue(value) };
}

// ============================================================================
// ARBITRARY VALUE CLASSIFICATION
// ============================================================================

/**
 * CSS length/dimension units — used to decide if an arbitrary value like
 * [1.5px] or [0.8rem] is a *dimension* (maps to width/size prop) vs a color.
 */
const CSS_DIMENSION_UNITS = [
    'vmin',
    'vmax',
    'rem',
    'svh',
    'svw',
    'dvh',
    'dvw',
    'lvh',
    'lvw',
    'cqw',
    'cqh',
    'cqi',
    'cqb',
    'turn',
    'grad',
    'px',
    'em',
    'ex',
    'ch',
    'vw',
    'vh',
    '%',
    'fr',
    'deg',
    'rad',
    'ms',
    's',
    'pt',
    'pc',
    'cm',
    'mm',
    'in',
] as const;

/**
 * Returns true when value is an arbitrary bracket expression whose inner
 * content is a CSS dimension (e.g. [1.5px], [0.8rem], [3px]).
 * Used by disambiguators to decide width/size vs color routing.
 * @param value - Raw value string (may include brackets)
 * @returns True if the value is an arbitrary CSS dimension
 */
function isArbitraryDimension(value: string): boolean {
    if (!value.startsWith('[') || !value.endsWith(']')) {
        return false;
    }
    const dimension = value.slice(1, -1);
    return CSS_DIMENSION_UNITS.some(unit => {
        if (!dimension.endsWith(unit)) return false;
        return /^-?[\d.]+$/.test(dimension.slice(0, -unit.length));
    });
}

// ============================================================================
// VALUE VALIDATION
// ============================================================================

/**
 * Check if a value looks like a valid Tailwind spacing value.
 * Spacing props (p, m, gap, w, h, etc.) only accept numbers, px, auto, full, screen, fractions, arbitrary.
 * @param value - The raw value string to check
 * @returns True if the value is valid for spacing properties
 */
function isValidSpacingValue(value: string): boolean {
    if (value.startsWith('[') && value.endsWith(']')) {
        return true;
    }
    if (value.startsWith('(') && value.endsWith(')')) {
        return true;
    }
    if (!Number.isNaN(Number(value))) {
        return true;
    }
    if (/^\d+\/\d+$/.test(value)) {
        return true;
    }
    // Keywords valid for spacing/sizing props
    if (
        [
            'auto',
            'full',
            'screen',
            'px',
            'min',
            'max',
            'fit',
            'none',
            'dvh',
            'dvw',
            'svh',
            'svw',
            'lvh',
            'lvw',
            // Max-width size keywords
            '3xs',
            '2xs',
            'xs',
            'sm',
            'md',
            'lg',
            'xl',
            '2xl',
            '3xl',
            '4xl',
            '5xl',
            '6xl',
            '7xl',
            'prose',
            'screen-sm',
            'screen-md',
            'screen-lg',
            'screen-xl',
            'screen-2xl',
            // Size keywords used in min-h, max-h
            'content',
        ].includes(value)
    ) {
        return true;
    }
    // Allow color values that happen to be on spacing borders (e.g. divide-blue-500 → divideColor)
    if (value.includes('/')) {
        return true;
    } // fractions or opacity
    return false;
}

// ============================================================================
// VALUE PARSING
// ============================================================================

/**
 * Parses a raw Tailwind value into the appropriate sz value type.
 * @param prefix - The matched Tailwind prefix
 * @param value - The raw value string
 * @param negative - Whether the class has a negative prefix
 * @returns The parsed sz value (number, string, or other)
 */
export function parseValue(prefix: string, value: string, negative: boolean): unknown {
    if (value.startsWith('[') && value.endsWith(']')) {
        return parseArbitraryValue(prefix, value.slice(1, -1).replace(/_/g, ' '), negative);
    }

    if (value.startsWith('(') && value.endsWith(')')) {
        return signedString(value.slice(1, -1), negative);
    }

    if (FRACTION_SUPPORTED.has(prefix) && /^\d+\/\d+$/.test(value)) {
        return signedString(value, negative);
    }

    if (value === 'px') {
        return signedString('px', negative);
    }
    if (value === 'full') {
        return signedString('full', negative);
    }
    if (value === 'auto' || value === 'screen') {
        return value;
    }

    const num = Number(value);
    if (!Number.isNaN(num)) {
        return negative ? -num : num;
    }
    return signedString(value, negative);
}

/**
 * Normalizes an arbitrary value, including content string quote stability.
 * @param prefix - The matched Tailwind prefix.
 * @param inner - The unwrapped arbitrary value.
 * @param negative - Whether to apply a negative prefix.
 * @returns The normalized arbitrary value.
 */
function parseArbitraryValue(prefix: string, inner: string, negative: boolean): string {
    if (negative) return `-${inner}`;
    if (prefix === 'content' && isQuotedString(inner)) {
        return `"${inner.slice(1, -1)}"`;
    }
    return inner;
}

/**
 * Tests whether a value is wrapped in matching single or double quotes.
 * @param value - The value to inspect.
 * @returns Whether it has matching quote delimiters.
 */
function isQuotedString(value: string): boolean {
    return (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
    );
}

/**
 * Applies the Tailwind negative marker to a string value when requested.
 * @param value - The unsigned string value.
 * @param negative - Whether to prepend the negative marker.
 * @returns The signed string value.
 */
function signedString(value: string, negative: boolean): string {
    return negative ? `-${value}` : value;
}

/**
 * Parses a value as numeric if possible, otherwise returns as string.
 * @param prefix - The matched Tailwind prefix
 * @param value - The raw value string
 * @param negative - Whether the class has a negative prefix
 * @returns Numeric value or string
 */
function parseNumericOrString(prefix: string, value: string, negative: boolean): unknown {
    if (value === 'px') {
        return 'px';
    }
    const num = Number(value);
    if (!Number.isNaN(num)) {
        return negative ? -num : num;
    }
    return value;
}

/**
 * Parses a string value, stripping arbitrary brackets and CSS var parens.
 * @param value - The raw value string
 * @returns Cleaned string value
 */
function parseStringValue(value: string): string {
    // Handle arbitrary values
    if (value.startsWith('[') && value.endsWith(']')) {
        return value.slice(1, -1).replace(/_/g, ' ');
    }
    // Handle CSS variable sugar
    if (value.startsWith('(') && value.endsWith(')')) {
        return value.slice(1, -1);
    }
    return value;
}
