/**
 * Variant Parser: Extracts variant chain from a Tailwind class token
 * and builds the nested sz object structure.
 *
 * Handles: simple variants (hover:, md:), complex variants (group-hover/name:,
 * peer-checked/draft:), compound variants (has-[selector]:, data-[attr]:,
 * aria-STATE:, not-STATE:, supports-[cond]:), container queries (@md:,
 * @md/name:, @min-[value]:), min/max breakpoints.
 */

import { parseClass } from './class-parser.js';
import { REVERSE_VARIANT_MAP } from './reverse-map.js';

/**
 *
 */
export interface ParsedToken {
    variants: VariantNode[];
    baseClass: string;
}

/**
 *
 */
export interface VariantNode {
    type:
        | 'simple'
        | 'group'
        | 'peer'
        | 'has'
        | 'not'
        | 'data'
        | 'aria'
        | 'supports'
        | 'min'
        | 'max'
        | '@query'
        | '@container'
        | 'arbitrary';
    key: string; // The sz object key
    nested?: VariantNode[]; // For group/peer with state inside
    name?: string; // For named group/peer/container
    selector?: string; // For has/data/aria/supports selector
}

/**
 * Tokenize a className string into individual class tokens.
 * Handles brackets and parentheses to avoid splitting on colons inside them.
 *
 * @param {string} className - The full class string to split
 * @returns {string[]} Array of individual class tokens
 */
export function tokenize(className: string): string[] {
    return className.trim().split(/\s+/).filter(Boolean);
}

/**
 * Parse a single class token into variants + base class.
 * Handles complex colon-separated variant chains while respecting brackets.
 *
 * Example: "group-hover/sidebar:md:text-white" →
 *   variants: [group-hover/sidebar, md], baseClass: "text-white"
 *
 * @param {string} token - A single Tailwind class token
 * @returns {{ variantParts: string[]; baseClass: string }} Parsed variant parts and base class
 */
export function extractVariants(token: string): { variantParts: string[]; baseClass: string } {
    const parts: string[] = [];
    let current = '';
    let depth = 0;

    for (const ch of token) {
        if (ch === '[' || ch === '(') {
            depth++;
            current += ch;
        } else if (ch === ']' || ch === ')') {
            depth--;
            current += ch;
        } else if (ch === ':' && depth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }

    // The last part is the base class
    if (parts.length === 0) {
        return { variantParts: [], baseClass: current };
    }

    return { variantParts: parts, baseClass: current };
}

/**
 * Map a variant string to its sz key(s).
 * Returns an array of keys to nest in the sz object.
 *
 * Examples:
 *   "hover" → ["hover"]
 *   "focus-within" → ["focusWithin"]
 *   "group-hover" → ["group", "hover"]
 *   "group-hover/sidebar" → ["group", "sidebar", "hover"]
 *   "has-[img]" → ["has", "img"]
 *   "has-[:checked]" → ["has", "checked"]
 *   "data-[active]" → ["data", "active"]
 *   "aria-checked" → ["aria", "checked"]
 *   "aria-[current=page]" → ["aria", "current=page"]
 *   "not-hover" → ["not", "hover"]
 *   "supports-[display:grid]" → ["supports", "display:grid"]
 *   "min-[320px]" → ["min", "320px"]
 *   "min-md" → ["min", "md"]
 *   "@md" → ["@md"]
 *   "@md/sidebar" → ["@md", "sidebar"]
 *   "@min-[475px]" → ["@min", "475px"]
 *   "group-has-[a]" → ["group", "has", "a"]
 *   "peer-checked/draft" → ["peer", "draft", "checked"]
 *   "group-[.is-published]" → ["group", ".is-published"]
 *
 * @param {string} variant - A single variant string to map
 * @returns {string[]} Array of sz object keys for nesting
 */
export function mapVariant(variant: string): string[] {
    if (variant.startsWith('@')) {
        return mapContainerVariant(variant);
    }
    if (variant.startsWith('group-') || variant.startsWith('peer-')) {
        return parseGroupPeerVariant(variant);
    }
    if (variant.startsWith('has-')) {
        return mapHasVariant(variant);
    }
    if (variant.startsWith('not-')) {
        return mapNotVariant(variant);
    }
    if (variant.startsWith('data-')) {
        return mapAttributeVariant('data', variant.slice(5));
    }
    if (variant.startsWith('aria-')) {
        return mapAttributeVariant('aria', variant.slice(5));
    }
    if (variant.startsWith('supports-')) {
        return mapAttributeVariant('supports', variant.slice(9));
    }
    if (variant.startsWith('min-') || variant.startsWith('max-')) {
        return mapRangeVariant(variant);
    }
    if (variant.startsWith('[') && variant.endsWith(']')) {
        return [variant];
    }
    return [normalizeVariantKey(variant)];
}

/**
 * Maps an `@`-prefixed container-query variant.
 * @param variant - The complete container-query variant.
 * @returns The normalized sz nesting keys.
 */
function mapContainerVariant(variant: string): string[] {
    if (variant === '@container') return ['@container'];
    const slashIndex = variant.indexOf('/');
    if (slashIndex !== -1) {
        return [normalizeVariantKey(variant.slice(0, slashIndex)), variant.slice(slashIndex + 1)];
    }
    const arbitraryRange = /^(@min|@max)-\[(.+)\]$/.exec(variant);
    return arbitraryRange ? [arbitraryRange[1], arbitraryRange[2]] : [normalizeVariantKey(variant)];
}

/**
 * Maps `has-*`, stripping brackets and a leading pseudo-selector colon.
 * @param variant - The complete has variant.
 * @returns The normalized sz nesting keys.
 */
function mapHasVariant(variant: string): string[] {
    const rest = variant.slice(4);
    if (!isBracketed(rest)) return ['has', rest];
    const selector = rest.slice(1, -1);
    return ['has', selector.startsWith(':') ? selector.slice(1) : selector];
}

/**
 * Maps simple and supports-wrapped negation variants.
 * @param variant - The complete not variant.
 * @returns The normalized sz nesting keys.
 */
function mapNotVariant(variant: string): string[] {
    const rest = variant.slice(4);
    if (rest.startsWith('supports-[') && rest.endsWith(']')) {
        return ['not', 'supports', rest.slice(10, -1)];
    }
    return ['not', normalizeVariantKey(rest)];
}

/**
 * Maps a data, aria, or supports value, unwrapping arbitrary brackets.
 * @param prefix - The sz nesting prefix.
 * @param rest - The variant value after its prefix.
 * @returns The normalized sz nesting keys.
 */
function mapAttributeVariant(prefix: string, rest: string): string[] {
    return [prefix, isBracketed(rest) ? rest.slice(1, -1) : rest];
}

/**
 * Maps named and arbitrary min/max breakpoint variants.
 * @param variant - The complete min or max variant.
 * @returns The normalized sz nesting keys.
 */
function mapRangeVariant(variant: string): string[] {
    const prefix = variant.startsWith('min-') ? 'min' : 'max';
    const rest = variant.slice(4);
    return [prefix, isBracketed(rest) ? rest.slice(1, -1) : rest];
}

/**
 * Tests whether a variant segment is enclosed in square brackets.
 * @param value - The variant segment to inspect.
 * @returns Whether the segment is bracketed.
 */
function isBracketed(value: string): boolean {
    return value.startsWith('[') && value.endsWith(']');
}

/**
 * Parse group/peer variant strings.
 *
 * Patterns:
 *   group-hover → group, hover
 *   group-hover/sidebar → group, sidebar, hover
 *   group-[.is-published] → group, .is-published
 *   group-has-[a] → group, has, a
 *   peer-checked → peer, checked
 *   peer-checked/draft → peer, draft, checked
 *
 * @param {string} variant - A group or peer variant string
 * @returns {string[]} Array of sz object keys for nesting
 */
function parseGroupPeerVariant(variant: string): string[] {
    const isGroup = variant.startsWith('group-');
    const type = isGroup ? 'group' : 'peer';
    let rest = variant.slice(type.length + 1); // after "group-" or "peer-"

    // Check for /name suffix (but not inside brackets)
    let name: string | undefined;
    const slashIdx = findTopLevelSlash(rest);
    if (slashIdx !== -1) {
        name = rest.slice(slashIdx + 1);
        rest = rest.slice(0, slashIdx);
    }

    const keys: string[] = [type];

    // If there's a name, it goes between type and state
    if (name) {
        keys.push(name);
    }

    keys.push(...parseGroupPeerState(rest));

    return keys;
}

/**
 * Parse the state suffix of a group or peer variant.
 * @param state - Variant state suffix.
 * @returns Nested sz keys for the state.
 */
function parseGroupPeerState(state: string): string[] {
    if (isWrappedVariantState(state)) return [state.slice(1, -1)];
    if (state.startsWith('has-')) return ['has', unwrapVariantState(state.slice(4))];
    if (state.startsWith('data-')) return ['data', unwrapVariantState(state.slice(5))];
    if (state.startsWith('aria-')) return ['aria', unwrapVariantState(state.slice(5))];
    return [normalizeVariantKey(state)];
}

/**
 * Whether a variant state uses arbitrary brackets or CSS-variable parentheses.
 * @param state - Variant state to inspect.
 * @returns Whether the state has a supported wrapper.
 */
function isWrappedVariantState(state: string): boolean {
    return (
        (state.startsWith('[') && state.endsWith(']')) ||
        (state.startsWith('(') && state.endsWith(')'))
    );
}

/**
 * Remove supported state wrappers while preserving bare shorthand names.
 * @param state - Variant state to unwrap.
 * @returns Unwrapped or original state.
 */
function unwrapVariantState(state: string): string {
    return isWrappedVariantState(state) ? state.slice(1, -1) : state;
}

/**
 * Finds the index of the first top-level slash (not inside brackets/parens).
 * @param s - The string to search
 * @returns Index of the slash, or -1 if not found
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

/**
 * Normalize a variant key to its sz camelCase form.
 * Uses REVERSE_VARIANT_MAP for known multi-word variants,
 * otherwise returns as-is (already in correct form).
 *
 * @param {string} variant - The variant key to normalize
 * @returns {string} The camelCase sz object key
 */
function normalizeVariantKey(variant: string): string {
    if (REVERSE_VARIANT_MAP[variant]) {
        return REVERSE_VARIANT_MAP[variant];
    }
    // @ prefixed variants stay as-is
    if (variant.startsWith('@')) {
        return variant;
    }
    return variant;
}

/**
 * Reserved string values for migration-resolution entries.
 * All use the "sz:" prefix to avoid collision with CSS class names.
 */
export const TODO_KEEP = 'sz:keep'; // Keep in className, acknowledged
export const TODO_REMOVE = 'sz:remove'; // Omit from output entirely
export const TODO_PENDING = 'sz:todo'; // Not yet decided (generated by --audit)

/**
 * A single migration-resolution entry. Possible values:
 *   - `Record<string, unknown>` — direct sz object mapping ({ p: 4, bg: 'blue-500' })
 *   - `string` — Tailwind class string to auto-convert, or a "sz:" directive
 *                (pending, keep, or remove sentinel)
 *   - `null | false` — treated as unresolved for backwards compatibility
 */
export type CsszyxTodoEntry = Record<string, unknown> | string | null | false;

/**
 * Shape of the migration-resolution file: class names mapped to resolution entries.
 */
export type CsszyxTodoMap = Record<string, CsszyxTodoEntry>;

interface ParsedClassToken {
    keyPath: string[];
    prop: string;
    value: unknown;
    cssProperty?: string;
    /** Companion prop emitted alongside `prop` (text-sm/6 → text + leading). */
    extra?: { prop: string; value: unknown };
}

interface ClassNameConversionState {
    szObject: Record<string, unknown>;
    unrecognized: string[];
    keepInClassName: string[];
    seenCssPropertiesByPath: Map<string, Map<string, string>>;
    conflictedCssPropertiesByPath: Map<string, Set<string>>;
}

const MAX_TOKEN_CACHE_SIZE = 4096;
const parsedTokenCache = new Map<string, ParsedClassToken | null>();

/**
 * Resolve a customMap value for a given token.
 *
 * Supported value types in the migration-resolution file:
 *   { sz object }         → merge into sz output
 *   "p-4 bg-blue-500"     → Tailwind class string, auto-converted to sz
 *   "sz:keep"             → keep token in className, mark as acknowledged
 *   "sz:remove"           → omit token from output entirely
 *   pending sentinel       → unresolved, leave as unrecognized
 *   null / false / missing → treated as unresolved (backwards compat)
 *
 * Returns:
 *   { action: 'sz', value: Record }  → merge value into sz
 *   { action: 'keep' }               → retain in className
 *   { action: 'remove' }             → omit from output
 *   { action: 'unresolved' }         → treat as unrecognized class
 *   null                             → no entry for this token
 */
type CustomMapAction =
    | { action: 'sz'; value: Record<string, unknown>; cascade?: string[] }
    | { action: 'keep' }
    | { action: 'remove' }
    | { action: 'unresolved' };

/**
 * Resolve a single token against a custom migration-map entry.
 * @param token - The Tailwind class token to look up.
 * @param customMap - The parsed migration-resolution map.
 * @param resolveString - Callback to parse a Tailwind string recursively.
 * @returns A CustomMapAction descriptor, or null if the token has no entry.
 */
function resolveCustomMapEntry(
    token: string,
    customMap: CsszyxTodoMap,
    // Returns both the recognized sz object and any unrecognized tokens from the string
    resolveString: (s: string) => { sz: Record<string, unknown>; cascade: string[] } | null,
): CustomMapAction | null {
    if (!(token in customMap)) {
        return null;
    }

    const val = customMap[token];

    // Object → direct sz mapping
    if (val && typeof val === 'object' && !Array.isArray(val)) {
        return { action: 'sz', value: val as Record<string, unknown> };
    }

    // String values
    if (typeof val === 'string') {
        if (val === TODO_KEEP) {
            return { action: 'keep' };
        }
        if (val === TODO_REMOVE) {
            return { action: 'remove' };
        }
        if (val === TODO_PENDING) {
            return { action: 'unresolved' };
        }
        // Any other string: treat as Tailwind class string, auto-convert.
        // Partially-recognized strings: recognized classes → sz, unrecognized → cascade
        // back to the caller as additional unrecognized tokens (written to the resolution file).
        const result = resolveString(val);
        if (result && Object.keys(result.sz).length > 0) {
            return { action: 'sz', value: result.sz, cascade: result.cascade };
        }
        // Tailwind string with no recognized classes → unresolved
        return { action: 'unresolved' };
    }

    // false / null / undefined / anything else → unresolved (backwards compat)
    return { action: 'unresolved' };
}

/**
 * Convert a full className string into a single merged sz object.
 * Returns the sz object plus any unrecognized classes and classes to keep in className.
 *
 * @param {string} className - The full Tailwind class string
 * @param {CsszyxTodoMap} [customMap] - Optional csszyx-todo.json mapping
 * @returns {{ szObject, unrecognized, keepInClassName }} Merged sz object, unrecognized, and "sz:keep" classes
 */
export function classNameToSzObject(
    className: string,
    customMap?: CsszyxTodoMap,
): {
    szObject: Record<string, unknown>;
    unrecognized: string[];
    keepInClassName: string[];
} {
    const tokens = tokenize(className);
    const state: ClassNameConversionState = {
        szObject: {},
        unrecognized: [],
        keepInClassName: [],
        seenCssPropertiesByPath: new Map(),
        conflictedCssPropertiesByPath: new Map(),
    };

    for (const token of tokens) {
        if (applyCustomMapToken(token, customMap, state)) {
            continue;
        }
        applyParsedToken(token, state);
    }

    return {
        szObject: state.szObject,
        unrecognized: state.unrecognized,
        keepInClassName: state.keepInClassName,
    };
}

/**
 * Resolves a custom-map Tailwind string without recursively applying that map.
 * @param value - The replacement Tailwind class string.
 * @returns Its recognized sz object and unresolved cascade, or null when none is recognized.
 */
function resolveCustomMapString(
    value: string,
): { sz: Record<string, unknown>; cascade: string[] } | null {
    const inner = classNameToSzObject(value);
    return Object.keys(inner.szObject).length === 0
        ? null
        : { sz: inner.szObject, cascade: inner.unrecognized };
}

/**
 * Applies one custom-map action and reports whether normal parsing is bypassed.
 * @param token - The original Tailwind token.
 * @param customMap - The optional migration-resolution map.
 * @param state - The conversion state to update.
 * @returns Whether a custom-map entry consumed the token.
 */
function applyCustomMapToken(
    token: string,
    customMap: CsszyxTodoMap | undefined,
    state: ClassNameConversionState,
): boolean {
    if (!customMap) return false;
    const entry = resolveCustomMapEntry(token, customMap, resolveCustomMapString);
    if (!entry) return false;

    switch (entry.action) {
        case 'sz':
            // The map's object is shared by every className this run converts;
            // nesting later tokens into it would write them into the map.
            Object.assign(state.szObject, cloneParsedValue(entry.value) as Record<string, unknown>);
            if (entry.cascade?.length) state.unrecognized.push(...entry.cascade);
            return true;
        case 'keep':
            state.keepInClassName.push(token);
            return true;
        case 'remove':
            return true;
        case 'unresolved':
            state.unrecognized.push(token);
            return true;
    }
}

/**
 * Parses and applies one ordinary Tailwind token to the conversion state.
 * @param token - The Tailwind token to parse.
 * @param state - The conversion state to update.
 */
function applyParsedToken(token: string, state: ClassNameConversionState): void {
    const parsedToken = parseClassTokenCached(token);
    if (!parsedToken) {
        state.unrecognized.push(token);
        return;
    }
    if (isCssPropertyConflicted(state.conflictedCssPropertiesByPath, parsedToken)) {
        state.unrecognized.push(token);
        return;
    }

    const conflict = findCssPropertyConflict(state.seenCssPropertiesByPath, parsedToken, token);
    if (conflict) {
        rememberCssPropertyConflict(state.conflictedCssPropertiesByPath, parsedToken);
        state.unrecognized.push(conflict, token);
        removeNestedValue(state.szObject, parsedToken.keyPath, parsedToken.prop);
        return;
    }

    rememberCssProperty(state.seenCssPropertiesByPath, parsedToken, token);
    setNestedValue(
        state.szObject,
        parsedToken.keyPath,
        parsedToken.prop,
        cloneParsedValue(parsedToken.value),
    );
    if (parsedToken.extra) {
        setNestedValue(
            state.szObject,
            parsedToken.keyPath,
            parsedToken.extra.prop,
            cloneParsedValue(parsedToken.extra.value),
        );
    }
}

/**
 * Parse one Tailwind class token and cache the pure token-level result.
 * Custom-map routes intentionally bypass this cache before calling here.
 *
 * @param token - A single Tailwind class token.
 * @returns Parsed token metadata, or null for unrecognized tokens.
 */
function parseClassTokenCached(token: string): ParsedClassToken | null {
    if (parsedTokenCache.has(token)) {
        return parsedTokenCache.get(token) ?? null;
    }

    const parsed = parseClassToken(token);
    rememberParsedToken(token, parsed);
    return parsed;
}

/**
 * Parse one Tailwind class token into a path + property/value tuple.
 *
 * @param token - A single Tailwind class token.
 * @returns Parsed token metadata, or null for unrecognized tokens.
 */
function parseClassToken(token: string): ParsedClassToken | null {
    const { variantParts, baseClass } = extractVariants(token);
    const parsed = parseClass(baseClass, { display: 'canonical' });
    if (!parsed) {
        return null;
    }

    const keyPath: string[] = [];
    for (const variant of variantParts) {
        keyPath.push(...mapVariant(variant));
    }

    return {
        keyPath,
        prop: parsed.prop,
        value: parsed.value,
        cssProperty: parsed.cssProperty,
        extra: parsed.extra,
    };
}

/**
 * Store a parsed token result with a small FIFO cap.
 *
 * @param token - Cache key.
 * @param parsed - Parsed token metadata or null for misses.
 */
function rememberParsedToken(token: string, parsed: ParsedClassToken | null): void {
    if (parsedTokenCache.size >= MAX_TOKEN_CACHE_SIZE) {
        const oldest = parsedTokenCache.keys().next().value;
        if (oldest !== undefined) {
            parsedTokenCache.delete(oldest);
        }
    }
    parsedTokenCache.set(token, parsed);
}

/**
 * Clone object-valued parser results before placing them into an sz object.
 *
 * @param value - Parsed class value.
 * @returns A value safe to insert into the caller-owned sz object.
 */
function cloneParsedValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(cloneParsedValue);
    }
    if (value && typeof value === 'object') {
        const clone: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value)) {
            clone[key] = cloneParsedValue(nested);
        }
        return clone;
    }
    return value;
}

/**
 * Set a value deep in a nested object.
 * keyPath = variant nesting keys, prop = the final property name.
 *
 * @param {Record<string, unknown>} obj - The root object to set into
 * @param {string[]} keyPath - Variant nesting keys path
 * @param {string} prop - The final property name
 * @param {unknown} value - The value to set
 * @returns {void}
 */
function setNestedValue(
    obj: Record<string, unknown>,
    keyPath: string[],
    prop: string,
    value: unknown,
): void {
    let current = obj;

    for (const key of keyPath) {
        if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
            current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
    }

    current[prop] = value;
}

/**
 * Find a semantic CSS property conflict in the same variant scope.
 *
 * @param seen Previously accepted semantic CSS properties by variant path.
 * @param parsed Parsed token metadata.
 * @param token Current token.
 * @returns The previous conflicting token, or null.
 */
function findCssPropertyConflict(
    seen: Map<string, Map<string, string>>,
    parsed: ParsedClassToken,
    token: string,
): string | null {
    if (!parsed.cssProperty) {
        return null;
    }
    const scope = parsed.keyPath.join('\0');
    const previous = seen.get(scope)?.get(parsed.cssProperty);
    return previous && previous !== token ? previous : null;
}

/**
 * Check whether a semantic CSS property is already unsafe in this variant scope.
 *
 * @param conflicted Previously marked conflicts by variant path.
 * @param parsed Parsed token metadata.
 * @returns true when this property should stay unresolved.
 */
function isCssPropertyConflicted(
    conflicted: Map<string, Set<string>>,
    parsed: ParsedClassToken,
): boolean {
    if (!parsed.cssProperty) {
        return false;
    }
    return conflicted.get(parsed.keyPath.join('\0'))?.has(parsed.cssProperty) === true;
}

/**
 * Mark a semantic CSS property as unsafe in this variant scope.
 *
 * @param conflicted Conflict map to update.
 * @param parsed Parsed token metadata.
 */
function rememberCssPropertyConflict(
    conflicted: Map<string, Set<string>>,
    parsed: ParsedClassToken,
): void {
    if (!parsed.cssProperty) {
        return;
    }
    const scope = parsed.keyPath.join('\0');
    let properties = conflicted.get(scope);
    if (!properties) {
        properties = new Set();
        conflicted.set(scope, properties);
    }
    properties.add(parsed.cssProperty);
}

/**
 * Record a semantic CSS property emitted into a variant scope.
 *
 * @param seen Property map to update.
 * @param parsed Parsed token metadata.
 * @param token Original Tailwind token.
 */
function rememberCssProperty(
    seen: Map<string, Map<string, string>>,
    parsed: ParsedClassToken,
    token: string,
): void {
    if (!parsed.cssProperty) {
        return;
    }
    const scope = parsed.keyPath.join('\0');
    let properties = seen.get(scope);
    if (!properties) {
        properties = new Map();
        seen.set(scope, properties);
    }
    properties.set(parsed.cssProperty, token);
}

/**
 * Remove a previously emitted value from a nested sz object.
 *
 * Used when a later token proves that auto-migrating a semantic CSS property
 * would be unsafe.
 *
 * @param obj Root sz object.
 * @param keyPath Variant key path.
 * @param prop Property to delete.
 */
function removeNestedValue(obj: Record<string, unknown>, keyPath: string[], prop: string): void {
    let current: Record<string, unknown> | undefined = obj;
    const parents: Array<[Record<string, unknown>, string]> = [];

    for (const key of keyPath) {
        const next = current[key];
        if (!next || typeof next !== 'object' || Array.isArray(next)) {
            return;
        }
        parents.push([current, key]);
        current = next as Record<string, unknown>;
    }

    delete current[prop];

    for (let index = parents.length - 1; index >= 0; index--) {
        const [parent, key] = parents[index];
        const child = parent[key];
        if (child && typeof child === 'object' && Object.keys(child).length === 0) {
            delete parent[key];
        }
    }
}
