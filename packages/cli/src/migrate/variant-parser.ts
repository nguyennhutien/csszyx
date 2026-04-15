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
import {
    REVERSE_VARIANT_MAP,
} from './reverse-map.js';

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
    type: 'simple' | 'group' | 'peer' | 'has' | 'not' | 'data' | 'aria' |
          'supports' | 'min' | 'max' | '@query' | '@container' | 'arbitrary';
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

    for (let i = 0; i < token.length; i++) {
        const ch = token[i];
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
    // ================================================================
    // @ PREFIXED VARIANTS (container queries)
    // ================================================================
    if (variant.startsWith('@')) {
        // @container → @container
        if (variant === '@container') {
            return ['@container'];
        }

        // @md/sidebar → @md, sidebar
        const slashIdx = variant.indexOf('/');
        if (slashIdx !== -1) {
            const queryPart = variant.slice(0, slashIdx);
            const namePart = variant.slice(slashIdx + 1);
            return [normalizeVariantKey(queryPart), namePart];
        }

        // @min-[475px] → @min, 475px (strip brackets)
        // @max-[600px] → @max, 600px
        const match = variant.match(/^(@min|@max)-\[(.+)\]$/);
        if (match) {
            return [match[1], match[2]];
        }

        // @md, @lg, etc.
        return [normalizeVariantKey(variant)];
    }

    // ================================================================
    // GROUP/PEER VARIANTS
    // ================================================================
    if (variant.startsWith('group-') || variant.startsWith('peer-')) {
        return parseGroupPeerVariant(variant);
    }

    // ================================================================
    // HAS VARIANT: has-[selector], has-[:checked]
    // ================================================================
    if (variant.startsWith('has-')) {
        const rest = variant.slice(4); // after "has-"
        if (rest.startsWith('[') && rest.endsWith(']')) {
            let selector = rest.slice(1, -1);
            // Strip leading : from pseudo-selectors
            if (selector.startsWith(':')) {
                selector = selector.slice(1);
            }
            return ['has', selector];
        }
        return ['has', rest];
    }

    // ================================================================
    // NOT VARIANT: not-hover, not-first, not-supports-[cond]
    // ================================================================
    if (variant.startsWith('not-')) {
        const rest = variant.slice(4);
        // not-supports-[condition]
        if (rest.startsWith('supports-[') && rest.endsWith(']')) {
            const cond = rest.slice(10, -1); // strip "supports-[" and "]"
            return ['not', 'supports', cond];
        }
        // Simple: not-hover → not, hover
        return ['not', normalizeVariantKey(rest)];
    }

    // ================================================================
    // DATA VARIANT: data-[attr], data-[attr=value]
    // ================================================================
    if (variant.startsWith('data-')) {
        const rest = variant.slice(5);
        if (rest.startsWith('[') && rest.endsWith(']')) {
            return ['data', rest.slice(1, -1)];
        }
        return ['data', rest];
    }

    // ================================================================
    // ARIA VARIANT: aria-checked, aria-[current=page]
    // ================================================================
    if (variant.startsWith('aria-')) {
        const rest = variant.slice(5);
        if (rest.startsWith('[') && rest.endsWith(']')) {
            return ['aria', rest.slice(1, -1)];
        }
        // Standard aria state
        return ['aria', rest];
    }

    // ================================================================
    // SUPPORTS VARIANT: supports-[display:grid]
    // ================================================================
    if (variant.startsWith('supports-')) {
        const rest = variant.slice(9);
        if (rest.startsWith('[') && rest.endsWith(']')) {
            return ['supports', rest.slice(1, -1)];
        }
        return ['supports', rest];
    }

    // ================================================================
    // MIN/MAX BREAKPOINTS: min-[320px], min-md, max-[600px]
    // ================================================================
    if (variant.startsWith('min-') || variant.startsWith('max-')) {
        const prefix = variant.startsWith('min-') ? 'min' : 'max';
        const rest = variant.slice(4);
        if (rest.startsWith('[') && rest.endsWith(']')) {
            // Arbitrary: min-[320px] → min, 320px (no brackets in key)
            return [prefix, rest.slice(1, -1)];
        }
        // Named: min-md → min, md
        return [prefix, rest];
    }

    // ================================================================
    // ARBITRARY VARIANT: [&>span], [&:nth-child(3)]
    // ================================================================
    if (variant.startsWith('[') && variant.endsWith(']')) {
        return [variant]; // Keep as-is including brackets
    }

    // ================================================================
    // SIMPLE VARIANT: hover, focus, md, dark, etc.
    // ================================================================
    return [normalizeVariantKey(variant)];
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

    // Parse the state/selector part
    if (rest.startsWith('[') && rest.endsWith(']')) {
        // Arbitrary selector: group-[.is-published]
        keys.push(rest.slice(1, -1));
    } else if (rest.startsWith('has-')) {
        // has inside group: group-has-[a]
        const hasRest = rest.slice(4);
        if (hasRest.startsWith('[') && hasRest.endsWith(']')) {
            keys.push('has');
            keys.push(hasRest.slice(1, -1));
        } else {
            keys.push('has');
            keys.push(hasRest);
        }
    } else if (rest.startsWith('data-')) {
        // data attribute inside group: group-data-[active], group-data-active,
        // group-data-[active='true'], group-data-(--state)
        const dataRest = rest.slice(5);
        keys.push('data');
        if (dataRest.startsWith('[') && dataRest.endsWith(']')) {
            keys.push(dataRest.slice(1, -1)); // strip brackets
        } else if (dataRest.startsWith('(') && dataRest.endsWith(')')) {
            keys.push(dataRest.slice(1, -1)); // strip parens → CSS var sugar
        } else {
            keys.push(dataRest); // bare shorthand: data-active
        }
    } else if (rest.startsWith('aria-')) {
        // aria state inside group: group-aria-checked, group-aria-[current=page]
        const ariaRest = rest.slice(5);
        keys.push('aria');
        if (ariaRest.startsWith('[') && ariaRest.endsWith(']')) {
            keys.push(ariaRest.slice(1, -1));
        } else {
            keys.push(ariaRest);
        }
    } else {
        // Simple state: hover, checked, etc.
        keys.push(normalizeVariantKey(rest));
    }

    return keys;
}

/**
 * Finds the index of the first top-level slash (not inside brackets/parens).
 * @param s - The string to search
 * @returns Index of the slash, or -1 if not found
 */
function findTopLevelSlash(s: string): number {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '[' || s[i] === '(') {depth++;} else if (s[i] === ']' || s[i] === ')') {depth--;} else if (s[i] === '/' && depth === 0) {return i;}
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
    if (variant.startsWith('@')) {return variant;}
    return variant;
}

/**
 * Reserved string values for csszyx-todo.json entries.
 * All use the "sz:" prefix to avoid collision with CSS class names.
 */
export const TODO_KEEP = 'sz:keep'; // Keep in className, acknowledged
export const TODO_REMOVE = 'sz:remove'; // Omit from output entirely
export const TODO_PENDING = 'sz:todo'; // Not yet decided (generated by --audit)

/**
 * A single entry in .csszyx-todo.json. Possible values:
 *   - `Record<string, unknown>` — direct sz object mapping ({ p: 4, bg: 'blue-500' })
 *   - `string` — Tailwind class string to auto-convert, or a "sz:" directive
 *                ('sz:todo' | 'sz:keep' | 'sz:remove')
 *   - `null | false` — treated as 'sz:todo' (unresolved, for backwards compat)
 */
export type CsszyxTodoEntry = Record<string, unknown> | string | null | false;

/**
 * Shape of .csszyx-todo.json — a map from Tailwind class names to resolution entries.
 */
export type CsszyxTodoMap = Record<string, CsszyxTodoEntry>;

/**
 * Resolve a customMap value for a given token.
 *
 * Supported value types in csszyx-todo.json:
 *   { sz object }         → merge into sz output
 *   "p-4 bg-blue-500"     → Tailwind class string, auto-converted to sz
 *   "sz:keep"             → keep token in className, mark as acknowledged
 *   "sz:remove"           → omit token from output entirely
 *   "sz:todo"             → unresolved, leave as unrecognized
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
 * Resolve a single token against a csszyx-todo.json customMap entry.
 * @param token - The Tailwind class token to look up.
 * @param customMap - The parsed .csszyx-todo.json map.
 * @param resolveString - Callback to parse a Tailwind string recursively.
 * @returns A CustomMapAction descriptor, or null if the token has no entry.
 */
function resolveCustomMapEntry(
    token: string,
    customMap: CsszyxTodoMap,
    // Returns both the recognized sz object and any unrecognized tokens from the string
    resolveString: (s: string) => { sz: Record<string, unknown>; cascade: string[] } | null,
): CustomMapAction | null {
    if (!(token in customMap)) { return null; }

    const val = customMap[token];

    // Object → direct sz mapping
    if (val && typeof val === 'object' && !Array.isArray(val)) {
        return { action: 'sz', value: val as Record<string, unknown> };
    }

    // String values
    if (typeof val === 'string') {
        if (val === TODO_KEEP) { return { action: 'keep' }; }
        if (val === TODO_REMOVE) { return { action: 'remove' }; }
        if (val === TODO_PENDING) { return { action: 'unresolved' }; }
        // Any other string: treat as Tailwind class string, auto-convert.
        // Partially-recognized strings: recognized classes → sz, unrecognized → cascade
        // back to the caller as additional unrecognized tokens (written to todo file).
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
    const szObject: Record<string, unknown> = {};
    const unrecognized: string[] = [];
    const keepInClassName: string[] = [];

    for (const token of tokens) {
        // Check custom map first
        if (customMap && token in customMap) {
            const entry = resolveCustomMapEntry(
                token,
                customMap,
                // Inline resolver: parse Tailwind string recursively (no customMap to avoid infinite loop).
                // Returns both the sz object and any unrecognized tokens from the string value,
                // so partially-valid strings cascade their unknowns back to the unrecognized list.
                (twStr) => {
                    const inner = classNameToSzObject(twStr);
                    if (Object.keys(inner.szObject).length === 0) {return null;}
                    return { sz: inner.szObject, cascade: inner.unrecognized };
                },
            );

            if (entry) {
                if (entry.action === 'sz') {
                    Object.assign(szObject, entry.value);
                    // Cascade: unrecognized tokens from string-route values are treated as
                    // additional unrecognized classes so they surface in reports and auto-
                    // cascade back into csszyx-todo.json when --resolve-todos is active.
                    if (entry.cascade && entry.cascade.length > 0) {
                        unrecognized.push(...entry.cascade);
                    }
                    continue;
                }
                if (entry.action === 'keep') {
                    keepInClassName.push(token);
                    continue;
                }
                if (entry.action === 'remove') {
                    // Omit entirely — don't add to sz or className
                    continue;
                }
                // action === 'unresolved': token has sz:todo / null / false value —
                // "not yet decided". Never fall through to the normal parser here;
                // that would silently convert valid TW classes (e.g. "flex") even
                // though the dev explicitly marked them as pending. Instead, surface
                // them in unrecognized[] so @sz-todo comments get re-injected and
                // they appear in reports as still-unresolved.
                if (entry.action === 'unresolved') {
                    unrecognized.push(token);
                    continue;
                }
            }
        }

        const { variantParts, baseClass } = extractVariants(token);

        // Parse the base class
        const parsed = parseClass(baseClass);
        if (!parsed) {
            unrecognized.push(token);
            continue;
        }

        // Map variant parts to sz keys
        const variantKeys: string[][] = variantParts.map(v => mapVariant(v));

        // Build the full key path: flatten variant keys + prop
        const keyPath: string[] = [];
        for (const vk of variantKeys) {
            keyPath.push(...vk);
        }

        // Set value in the nested object
        setNestedValue(szObject, keyPath, parsed.prop, parsed.value);
    }

    return { szObject, unrecognized, keepInClassName };
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
