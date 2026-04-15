/**
 * csszyx_lookup — Look up how a CSS property or keyword maps to an sz key.
 *
 * Accepts CSS property names (kebab-case or camelCase), sz keys, or free-text
 * keywords. Builds its search index dynamically from PROPERTY_MAP and
 * SUGGESTION_MAP so it never drifts from the actual compiler.
 *
 * Example: "background-color" → { szKey: "bg", tailwindPrefix: "bg", examples: [...] }
 */

import { BOOLEAN_SHORTHANDS, PROPERTY_MAP, SUGGESTION_MAP } from '@csszyx/compiler';
import { z } from 'zod';

// ============================================================================
// SEARCH INDEX (derived from compiler data — no static drift)
// ============================================================================

// Maps lowercase search terms → list of matching sz keys.
const SEARCH_INDEX = new Map<string, string[]>();

/**
 * Add a search term → sz key mapping to the search index.
 * @param term - The search term to index (will be lowercased).
 * @param szKey - The sz key that this term maps to.
 */
function addSearch(term: string, szKey: string): void {
    const lower = term.toLowerCase();
    const existing = SEARCH_INDEX.get(lower) ?? [];
    if (!existing.includes(szKey)) {
        existing.push(szKey);
        SEARCH_INDEX.set(lower, existing);
    }
}

/**
 * Convert a camelCase identifier to kebab-case.
 * @param camel - The camelCase string to convert.
 * @returns The kebab-case equivalent.
 */
function toKebab(camel: string): string {
    return camel.replace(/([A-Z])/g, '-$1').toLowerCase();
}

// Index all PROPERTY_MAP keys by their camelCase and kebab-case forms.
for (const szKey of Object.keys(PROPERTY_MAP)) {
    addSearch(szKey, szKey);
    addSearch(toKebab(szKey), szKey);
}

// Index SUGGESTION_MAP entries (CSS property aliases → sz keys).
// Values can be descriptive strings like "fontWeight (for weight) or fontFamily (for family)".
// Extract the first token as the primary sz key.
for (const [cssAlias, szTarget] of Object.entries(SUGGESTION_MAP)) {
    const primaryKey = szTarget.split(/[\s/(]/)[0];
    if (primaryKey && (PROPERTY_MAP[primaryKey] !== undefined || BOOLEAN_SHORTHANDS.has(primaryKey))) {
        addSearch(cssAlias, primaryKey);
        addSearch(toKebab(cssAlias), primaryKey);
    }
}

// Index boolean shorthand keys.
for (const key of BOOLEAN_SHORTHANDS) {
    addSearch(key, key);
    addSearch(toKebab(key), key);
}

// ============================================================================
// CURATED EXAMPLES (hand-written; updated as the API evolves)
// ============================================================================

const EXAMPLES: Record<string, string[]> = {
    bg: ["{ bg: 'blue-500' }", "{ bg: { color: 'blue-500', op: 50 } }"],
    p: ['{ p: 4 }', "{ p: '5px' }"],
    m: ['{ m: 4 }', "{ m: 'auto' }"],
    px: ['{ px: 4 }'], py: ['{ py: 2 }'],
    mx: ["{ mx: 'auto' }"], my: ['{ my: 4 }'],
    w: ['{ w: 64 }', "{ w: 'full' }"],
    h: ['{ h: 16 }', "{ h: 'screen' }"],
    text: ["{ text: 'lg' }", "{ text: '2xl' }"],
    color: ["{ color: 'white' }", "{ color: 'slate-500' }"],
    fontWeight: ["{ fontWeight: 'bold' }", '{ fontWeight: 700 }'],
    fontFamily: ["{ fontFamily: 'sans' }", "{ fontFamily: 'mono' }"],
    flex: ['{ flex: true }', "{ flex: 'auto' }", '{ flex: 1 }'],
    flexDir: ["{ flexDir: 'col' }", "{ flexDir: 'row' }"],
    grid: ['{ grid: true }'],
    gridCols: ['{ gridCols: 3 }', "{ gridCols: 'none' }"],
    gap: ['{ gap: 4 }'],
    items: ["{ items: 'center' }", "{ items: 'start' }"],
    justify: ["{ justify: 'center' }", "{ justify: 'between' }"],
    rounded: ["{ rounded: 'md' }", "{ rounded: 'full' }"],
    shadow: ["{ shadow: 'md' }"],
    border: ['{ border: true }', '{ border: 2 }'],
    opacity: ['{ opacity: 50 }'],
    z: ['{ z: 10 }', "{ z: 'auto' }"],
    overflow: ["{ overflow: 'hidden' }"],
    cursor: ["{ cursor: 'pointer' }"],
    transition: ["{ transition: 'all' }", "{ transition: 'colors' }"],
    duration: ['{ duration: 300 }'],
    scale: ['{ scale: 150 }', '{ scale: 75 }'],
    rotate: ['{ rotate: 45 }'],
    leading: ["{ leading: 'tight' }", '{ leading: 7 }'],
    tracking: ["{ tracking: 'wide' }"],
    textAlign: ["{ textAlign: 'center' }"],
    aspect: ["{ aspect: 'video' }", "{ aspect: 'square' }"],
    blur: ['{ blur: true }', "{ blur: 'sm' }"],
    grow: ['{ grow: true }'],
    shrink: ['{ shrink: true }'],
};

// ============================================================================
// TOOL
// ============================================================================

export const lookupSchema = z.object({
    query: z.string().describe(
        'CSS property name, sz key, or search term. Examples: "background-color", "bg", "padding", "flex-direction"',
    ),
});

/** Validated input type for the csszyx_lookup tool. */
export type LookupInput = z.infer<typeof lookupSchema>;

/**
 * Look up how a CSS property or keyword maps to an sz key.
 * @param input - The validated input object.
 * @returns MCP tool response with matching sz keys and usage examples.
 */
export function handleLookup(input: LookupInput): { content: Array<{ type: 'text'; text: string }> } {
    const query = input.query.trim().toLowerCase();

    const seen = new Set<string>();
    const results: Array<{ szKey: string; tailwindPrefix: string; examples: string[] }> = [];

    /**
     * Add an sz key to results if not already present.
     * @param szKey - The sz key to add.
     */
    function pushResult(szKey: string): void {
        if (seen.has(szKey)) { return; }
        seen.add(szKey);
        results.push({
            szKey,
            tailwindPrefix: PROPERTY_MAP[szKey] ?? szKey,
            examples: (EXAMPLES[szKey] ?? []).slice(0, 2),
        });
    }

    // 1. Exact match in search index.
    const exact = SEARCH_INDEX.get(query);
    if (exact) { exact.forEach(pushResult); }

    // 2. Fuzzy match if no exact hit (limited to 5 to avoid context bloat).
    if (results.length === 0) {
        for (const [term, szKeys] of SEARCH_INDEX.entries()) {
            if (results.length >= 5) { break; }
            if (term.includes(query)) { szKeys.forEach(pushResult); }
        }
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: results.length > 0
                    ? JSON.stringify({ query: input.query, results: results.slice(0, 8) }, null, 2)
                    : JSON.stringify({
                        query: input.query,
                        results: [],
                        message: `No mapping found for "${input.query}". Try a CSS property name (e.g. "padding") or sz key (e.g. "p").`,
                    }, null, 2),
            },
        ],
    };
}
