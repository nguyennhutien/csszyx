/**
 * Class Parser: Parses a single Tailwind CSS class (without variants)
 * into an sz prop/value pair.
 *
 * Uses longest-prefix-match against sorted prefix table, then
 * disambiguation for ambiguous prefixes (text-*, font-*, border-*, bg-*).
 */

import {
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
}

/**
 * Parse a single Tailwind utility class (no variant prefix) into an sz prop/value.
 * Returns null if the class is not recognized.
 * @param cls - The Tailwind utility class string
 * @returns {ParsedClass | null} Parsed prop/value or null if unrecognized
 */
export function parseClass(cls: string): ParsedClass | null {
    // Handle important modifier
    let important = false;
    let input = cls;
    if (input.endsWith('!')) {
        important = true;
        input = input.slice(0, -1);
    }

    // Handle negative prefix
    let negative = false;
    let negInput = input;
    if (input.startsWith('-')) {
        negative = true;
        negInput = input.slice(1);
    }

    // 1. Try exact boolean match first (highest priority)
    const boolResult = tryBooleanMatch(input);
    if (boolResult) {
        return applyImportant(boolResult, important);
    }

    // 2. Try gradient patterns (bg-linear-*, bg-radial*, bg-conic*)
    const gradResult = tryGradient(negInput, negative);
    if (gradResult) {
        return applyImportant(gradResult, important);
    }

    // 3. Try longest-prefix-match
    const source = negative ? negInput : input;
    for (const prefix of SORTED_PREFIXES) {
        // Exact match: class IS the prefix (e.g., "blur", "ring", "outline")
        if (source === prefix) {
            // Some of these are booleans handled above, but others have default values
            const prop = REVERSE_PROPERTY_MAP[prefix];
            if (negative && NEGATIVE_ALLOWED.has(prefix)) {
                // e.g., "-z" doesn't make sense alone; skip
                continue;
            }
            // For properties like "ring", "outline" — boolean true
            if (REVERSE_BOOLEAN_MAP[source]) {
                return applyImportant({ prop: REVERSE_BOOLEAN_MAP[source], value: true }, important);
            }
            // For divide-x, divide-y without value → boolean
            if (prefix === 'divide-x' || prefix === 'divide-y') {
                return applyImportant({ prop, value: true }, important);
            }
            // For border without value → boolean
            if (prefix === 'border') {
                return applyImportant({ prop: 'border', value: true }, important);
            }
            // For border-t/r/b/l/x/y/s/e without value → boolean side border
            if (['border-t', 'border-r', 'border-b', 'border-l', 'border-x', 'border-y', 'border-s', 'border-e'].includes(prefix)) {
                return applyImportant({ prop, value: true }, important);
            }
            continue;
        }

        // Class starts with prefix + "-"
        if (source.startsWith(prefix + '-')) {
            const rawValue = source.slice(prefix.length + 1); // strip prefix and "-"
            if (!rawValue) {continue;}

            // Validate negative
            if (negative && !NEGATIVE_ALLOWED.has(prefix)) {
                continue; // Invalid negative for this prefix
            }

            // For spacing-type prefixes, validate value looks like a spacing value
            // This prevents false positives like "my-custom-class" matching "my" (margin-y)
            if (SPACING_PROPS.has(prefix) && !isValidSpacingValue(rawValue)) {
                continue;
            }

            // Disambiguate and parse
            const result = disambiguateAndParse(prefix, rawValue, negative);
            if (result) {
                return applyImportant(result, important);
            }
        }
    }

    // 4. Handle display/position shorthand values
    const displayResult = tryDisplay(input);
    if (displayResult) {return applyImportant(displayResult, important);}

    // 5. Try CSS custom property declaration: [--var:value]
    if (input.startsWith('[') && input.endsWith(']') && input.includes(':')) {
        const inner = input.slice(1, -1);
        if (inner.startsWith('--')) {
            const colonIdx = inner.indexOf(':');
            return applyImportant({
                prop: inner.slice(0, colonIdx),
                value: inner.slice(colonIdx + 1),
            }, important);
        }
    }

    return null;
}

/**
 * Applies the important modifier to a parsed result.
 * @param result - The parsed class result to modify
 * @param important - Whether important flag is set
 * @returns {ParsedClass} Result with important modifier applied
 */
function applyImportant(result: ParsedClass, important: boolean): ParsedClass {
    if (!important) {return result;}
    if (typeof result.value === 'string') {
        return { prop: result.prop, value: result.value + '!' };
    }
    if (typeof result.value === 'boolean') {
        return { prop: result.prop, value: '!' };
    }
    // For numeric values, convert to string + !
    if (typeof result.value === 'number') {
        return { prop: result.prop, value: String(result.value) + '!' };
    }
    return result;
}

/**
 * Attempts to match a class as a boolean value.
 * @param cls - The class string to match
 * @returns {ParsedClass | null} Parsed result or null if no match
 */
function tryBooleanMatch(cls: string): ParsedClass | null {
    // Check BOOLEAN_VALUE_MAP for classes with non-boolean values
    if (BOOLEAN_VALUE_MAP[cls]) {
        const { prop, value } = BOOLEAN_VALUE_MAP[cls];
        return { prop, value };
    }

    // Check REVERSE_BOOLEAN_MAP for true booleans
    if (REVERSE_BOOLEAN_MAP[cls]) {
        return { prop: REVERSE_BOOLEAN_MAP[cls], value: true };
    }

    return null;
}

/**
 * Attempts to match a class as a display value.
 * @param cls - The class string to match
 * @returns {ParsedClass | null} Parsed result or null if no match
 */
function tryDisplay(cls: string): ParsedClass | null {
    // Handle display-* not caught by booleans
    const displayValues = new Set([
        'block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid',
        'hidden', 'contents', 'table', 'table-row', 'table-cell', 'flow-root', 'list-item',
    ]);
    // These are already handled by boolean map; this is a fallback
    if (displayValues.has(cls)) {
        return REVERSE_BOOLEAN_MAP[cls]
            ? { prop: REVERSE_BOOLEAN_MAP[cls], value: true }
            : null;
    }
    return null;
}

// ============================================================================
// GRADIENT PARSING
// ============================================================================

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

    let input = cls;
    let type: 'linear' | 'radial' | 'conic' | null = null;

    if (input.startsWith('bg-linear')) {
        type = 'linear';
        input = input.slice('bg-linear'.length);
    } else if (input.startsWith('bg-radial')) {
        type = 'radial';
        input = input.slice('bg-radial'.length);
    } else if (input.startsWith('bg-conic')) {
        type = 'conic';
        input = input.slice('bg-conic'.length);
    }

    if (!type) {return null;}

    // Parse color interpolation (after /)
    let colorInterp: string | undefined;
    // Only split on / that's not inside brackets
    const slashIdx = findTopLevelSlash(input);
    if (slashIdx !== -1) {
        colorInterp = input.slice(slashIdx + 1);
        input = input.slice(0, slashIdx);
    }

    // Parse direction
    const grad: Record<string, unknown> = { gradient: type };

    if (input === '' || input === undefined) {
        // No direction: bg-radial, bg-conic
    } else if (input.startsWith('-')) {
        // Has direction: -to-r, -45, -[at_50%_75%]
        const dir = input.slice(1);
        if (dir.startsWith('[') && dir.endsWith(']')) {
            // Arbitrary: [at_50%_75%] → "at 50% 75%"
            grad.dir = dir.slice(1, -1).replace(/_/g, ' ');
        } else if (dir.startsWith('(') && dir.endsWith(')')) {
            // CSS variable: (--dir)
            grad.dir = dir.slice(1, -1);
        } else if (/^\d+$/.test(dir)) {
            // Numeric angle
            grad.dir = negative ? -parseInt(dir, 10) : parseInt(dir, 10);
        } else {
            // Keyword: to-r, to-br, etc.
            grad.dir = dir;
        }
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
        if (s[i] === '[' || s[i] === '(') {depth++;} else if (s[i] === ']' || s[i] === ')') {depth--;} else if (s[i] === '/' && depth === 0) {return i;}
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
function disambiguateAndParse(prefix: string, rawValue: string, negative: boolean): ParsedClass | null {
    // Handle color+opacity: value contains / at top level
    const slashIdx = findTopLevelSlash(rawValue);
    let opacity: string | number | undefined;
    let value = rawValue;

    if (slashIdx !== -1 && !isGradientPrefix(prefix)) {
        // Check if this is a fraction (e.g., "1/2") before treating as opacity
        const isFraction = FRACTION_SUPPORTED.has(prefix) && /^\d+\/\d+$/.test(rawValue);

        if (!isFraction) {
            opacity = rawValue.slice(slashIdx + 1);
            value = rawValue.slice(0, slashIdx);

            // Parse opacity
            if (opacity.startsWith('[') && opacity.endsWith(']')) {
                opacity = opacity.slice(1, -1); // strip brackets → "0.05" or "78%"
                // Convert numeric strings to numbers after stripping brackets.
                // "0.05" → 0.05 (decimal fraction), "78%" stays as string (percentage).
                if (!String(opacity).includes('%')) {
                    const opNum = Number(opacity);
                    if (!isNaN(opNum)) {opacity = opNum;}
                }
            } else if (opacity.startsWith('(') && opacity.endsWith(')')) {
                opacity = opacity.slice(1, -1); // strip parens → "--alpha"
            } else {
                const opNum = Number(opacity);
                if (!isNaN(opNum)) {opacity = opNum;}
            }
        }
    }

    // Disambiguate ambiguous prefixes
    const result = disambiguate(prefix, value, negative);
    if (!result) {return null;}

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
        case 'list':
            return disambiguateList(value);
        case 'ease':
            return { prop: 'ease', value: parseValue('ease', value, negative) };
        case 'snap':
            return disambiguateSnap(value);
        case 'flex':
            return disambiguateFlex(value);
        case 'table':
            return disambiguateTable(value);
        case 'divide':
            return disambiguateDivide(value);
        case 'break':
            // break-words belongs to overflow-wrap (wrap), not word-break
            if (value === 'words') {return { prop: 'wrap', value: 'break-word' };}
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
    if (TEXT_SIZE_KEYWORDS.has(value)) {return { prop: 'text', value };}
    if (TEXT_ALIGN_KEYWORDS.has(value)) {return { prop: 'textAlign', value };}
    if (TEXT_WRAP_KEYWORDS.has(value)) {return { prop: 'textWrap', value };}
    if (TEXT_OVERFLOW_KEYWORDS.has(value)) {return { prop: 'textOverflow', value };}
    // Arbitrary dimension → font size (e.g. text-[0.8rem], text-[16px])
    if (isArbitraryDimension(value)) {return { prop: 'text', value: parseStringValue(value) };}
    // Default: color
    return { prop: 'color', value: parseStringValue(value) };
}

/**
 * Disambiguates font-* classes by keyword type.
 * @param value - The value after the font prefix
 * @returns {ParsedClass | null} Parsed font property result
 */
function disambiguateFont(value: string): ParsedClass | null {
    if (FONT_WEIGHT_KEYWORDS.has(value)) {return { prop: 'fontWeight', value };}
    if (/^\d{3}$/.test(value)) {return { prop: 'fontWeight', value: parseInt(value, 10) };}
    if (FONT_FAMILY_KEYWORDS.has(value)) {return { prop: 'fontFamily', value };}
    // font-stretch-* is handled as a separate prefix
    if (value.startsWith('stretch-')) {
        const stretchVal = value.slice('stretch-'.length);
        return { prop: 'fontStretch', value: stretchVal };
    }
    if (FONT_STRETCH_KEYWORDS.has(value)) {return { prop: 'fontStretch', value };}
    // Arbitrary
    return { prop: 'fontFamily', value: parseStringValue(value) };
}

/**
 * Disambiguates border-* classes by keyword type.
 * @param value - The value after the border prefix
 * @returns Parsed border property result
 */
function disambiguateBorder(value: string): ParsedClass | null {
    if (BORDER_WIDTH_KEYWORDS.has(value) || value === 'px') {return { prop: 'border', value: parseNumericOrString('border', value, false) };}
    if (BORDER_STYLE_KEYWORDS.has(value)) {return { prop: 'borderStyle', value };}
    // Arbitrary dimension → width (e.g. border-[1.5px])
    if (isArbitraryDimension(value)) {return { prop: 'border', value: parseStringValue(value) };}
    // Default: color
    return { prop: 'borderColor', value: parseStringValue(value) };
}

/**
 * Disambiguates bg-* classes by keyword type.
 * @param value - The value after the bg prefix
 * @returns Parsed background property result
 */
function disambiguateBg(value: string): ParsedClass | null {
    if (BG_POSITION_KEYWORDS.has(value)) {return { prop: 'bgPos', value };}
    if (BG_SIZE_KEYWORDS.has(value)) {return { prop: 'bgSize', value };}
    if (BG_REPEAT_KEYWORDS.has(value)) {return { prop: 'bgRepeat', value };}
    if (BG_ATTACHMENT_KEYWORDS.has(value)) {return { prop: 'bgAttach', value };}
    if (value === 'none') {return { prop: 'bgImg', value: 'none' };}
    // Default: color
    return { prop: 'bg', value: parseStringValue(value) };
}

/**
 * Disambiguates object-* classes by keyword type.
 * @param value - The value after the object prefix
 * @returns Parsed object-fit or object-position result
 */
function disambiguateObject(value: string): ParsedClass | null {
    if (OBJECT_FIT_KEYWORDS.has(value)) {return { prop: 'objectFit', value };}
    if (OBJECT_POSITION_KEYWORDS.has(value)) {return { prop: 'objectPos', value };}
    return { prop: 'objectPos', value: parseStringValue(value) };
}

/**
 * Disambiguates shadow-* classes into size or color.
 * @param value - The value after the shadow prefix
 * @returns Parsed shadow property result
 */
function disambiguateShadow(value: string): ParsedClass | null {
    if (SHADOW_SIZE_KEYWORDS.has(value)) {return { prop: 'shadow', value };}
    // shadow with color
    return { prop: 'shadowColor', value: parseStringValue(value) };
}

/**
 * Disambiguates outline-* classes into style, width, or color.
 * @param value - The value after the outline prefix
 * @returns Parsed outline property result
 */
function disambiguateOutline(value: string): ParsedClass | null {
    if (OUTLINE_STYLE_KEYWORDS.has(value)) {return { prop: 'outlineStyle', value };}
    // Check if it's a width (number)
    const num = Number(value);
    if (!isNaN(num) && Number.isInteger(num)) {return { prop: 'outline', value: num };}
    // Arbitrary dimension → width (e.g. outline-[3px])
    if (isArbitraryDimension(value)) {return { prop: 'outline', value: parseStringValue(value) };}
    // Default: color
    return { prop: 'outlineColor', value: parseStringValue(value) };
}

/**
 * Disambiguates decoration-* classes into style, thickness, or color.
 * @param value - The value after the decoration prefix
 * @returns Parsed decoration property result
 */
function disambiguateDecoration(value: string): ParsedClass | null {
    if (DECORATION_STYLE_KEYWORDS.has(value)) {return { prop: 'decorationStyle', value };}
    if (DECORATION_THICKNESS_KEYWORDS.has(value)) {
        const num = Number(value);
        if (!isNaN(num)) {return { prop: 'decorationThickness', value };}
        return { prop: 'decorationThickness', value };
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
    if (!isNaN(num) && Number.isInteger(num)) {return { prop: 'ring', value: negative ? -num : num };}
    // Arbitrary dimension → width (e.g. ring-[3px])
    if (isArbitraryDimension(value)) {return { prop: 'ring', value: parseStringValue(value) };}
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
    if (!isNaN(num) && Number.isInteger(num)) {return { prop: 'ringOffset', value: num };}
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
    if (!isNaN(num) && Number.isInteger(num)) {return { prop: 'insetRing', value: negative ? -num : num };}
    if (isArbitraryDimension(value)) {return { prop: 'insetRing', value: parseStringValue(value) };}
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
    if (INSET_SHADOW_SIZE_KEYWORDS.has(value)) {return { prop: 'insetShadow', value };}
    if (isArbitraryDimension(value)) {return { prop: 'insetShadow', value: parseStringValue(value) };}
    return { prop: 'insetShadowColor', value: parseStringValue(value) };
}

/**
 * Disambiguates stroke-* classes into width or color.
 * @param value - The value after the stroke prefix
 * @returns Parsed stroke property result
 */
function disambiguateStroke(value: string): ParsedClass | null {
    const num = Number(value);
    if (!isNaN(num) && Number.isInteger(num)) {return { prop: 'strokeWidth', value: num };}
    return { prop: 'stroke', value: parseStringValue(value) };
}

/**
 * Disambiguates transition-* classes by property keyword.
 * @param value - The value after the transition prefix
 * @returns Parsed transition property result
 */
function disambiguateTransition(value: string): ParsedClass | null {
    if (TRANSITION_PROPERTY_KEYWORDS.has(value)) {return { prop: 'transition', value };}
    return { prop: 'transition', value: parseStringValue(value) };
}

/**
 * Disambiguates list-* classes into position or style type.
 * @param value - The value after the list prefix
 * @returns Parsed list property result
 */
function disambiguateList(value: string): ParsedClass | null {
    if (value === 'inside' || value === 'outside') {return { prop: 'listPos', value };}
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
 * Disambiguates flex-* classes into direction or shorthand.
 * @param value - The value after the flex prefix
 * @returns Parsed flex property result
 */
function disambiguateFlex(value: string): ParsedClass | null {
    // flex-row, flex-col, flex-row-reverse, flex-col-reverse → flexDir
    const dirValues = new Set(['row', 'col', 'row-reverse', 'col-reverse']);
    if (dirValues.has(value)) {return { prop: 'flexDir', value };}
    // flex-wrap, flex-nowrap, flex-wrap-reverse → flexWrap (string-based)
    const wrapValues = new Set(['wrap', 'nowrap', 'wrap-reverse']);
    if (wrapValues.has(value)) {return { prop: 'flexWrap', value };}
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
    if (value === 'auto' || value === 'fixed') {return { prop: 'tableLayout', value };}
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
const CSS_DIMENSION_RE =
    /^-?[\d.]+(?:px|r?em|ex|ch|vw|vh|vmin|vmax|svh|svw|dvh|dvw|lvh|lvw|cqw|cqh|cqi|cqb|%|fr|deg|rad|turn|grad|ms|s|pt|pc|cm|mm|in)$/;

/**
 * Returns true when value is an arbitrary bracket expression whose inner
 * content is a CSS dimension (e.g. [1.5px], [0.8rem], [3px]).
 * Used by disambiguators to decide width/size vs color routing.
 * @param value - Raw value string (may include brackets)
 * @returns True if the value is an arbitrary CSS dimension
 */
function isArbitraryDimension(value: string): boolean {
    if (!value.startsWith('[') || !value.endsWith(']')) {return false;}
    return CSS_DIMENSION_RE.test(value.slice(1, -1));
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
    if (value.startsWith('[') && value.endsWith(']')) {return true;}
    if (value.startsWith('(') && value.endsWith(')')) {return true;}
    if (!isNaN(Number(value))) {return true;}
    if (/^\d+\/\d+$/.test(value)) {return true;}
    // Keywords valid for spacing/sizing props
    if ([
        'auto', 'full', 'screen', 'px', 'min', 'max', 'fit', 'none',
        'dvh', 'dvw', 'svh', 'svw', 'lvh', 'lvw',
        // Max-width size keywords
        'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl',
        'prose', 'screen-sm', 'screen-md', 'screen-lg', 'screen-xl', 'screen-2xl',
        // Size keywords used in min-h, max-h
        'content',
    ].includes(value)) {return true;}
    // Allow color values that happen to be on spacing borders (e.g. divide-blue-500 → divideColor)
    if (value.includes('/')) {return true;} // fractions or opacity
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
    // Arbitrary values: [10px], [calc(100%-1rem)]
    if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).replace(/_/g, ' ');
        if (negative) {return '-' + inner;}
        // content prefix: normalize CSS string literals to double-quote form so that
        // content-[''] and content-[""] both produce { content: '""' } for round-trip stability.
        if (prefix === 'content') {
            const isQuoted =
                (inner.startsWith("'") && inner.endsWith("'")) ||
                (inner.startsWith('"') && inner.endsWith('"'));
            if (isQuoted) {
                return `"${inner.slice(1, -1)}"`;
            }
        }
        return inner;
    }

    // CSS variable sugar: (--spacing), (--my-var)
    if (value.startsWith('(') && value.endsWith(')')) {
        const inner = value.slice(1, -1);
        if (negative) {return '-' + inner;}
        return inner;
    }

    // Fraction: 1/2, 2/3, etc.
    if (FRACTION_SUPPORTED.has(prefix) && /^\d+\/\d+$/.test(value)) {
        return value; // Keep as string "1/2"
    }

    // Px keyword
    if (value === 'px') {return negative ? '-px' : 'px';}

    // Auto
    if (value === 'auto') {return 'auto';}

    // Full
    if (value === 'full') {return 'full';}

    // Screen
    if (value === 'screen') {return 'screen';}

    // Numeric: integer or 0.5-step decimal
    const num = Number(value);
    if (!isNaN(num)) {
        if (negative) {return -num;}
        return num;
    }

    // String value
    if (negative) {return '-' + value;}
    return value;
}

/**
 * Parses a value as numeric if possible, otherwise returns as string.
 * @param prefix - The matched Tailwind prefix
 * @param value - The raw value string
 * @param negative - Whether the class has a negative prefix
 * @returns Numeric value or string
 */
function parseNumericOrString(prefix: string, value: string, negative: boolean): unknown {
    if (value === 'px') {return 'px';}
    const num = Number(value);
    if (!isNaN(num)) {return negative ? -num : num;}
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
