/**
 * Stand-alone keyword families: a CSS property whose grammar is a keyword that
 * stands alone or a combination of groups (`font-variant-numeric`,
 * `touch-action`, `contain`), with one sz key for the stand-alone keywords and
 * one per group.
 *
 * The table and the pure settlement live here, apart from the transform, for
 * the reason `sz-limits` does: the runtime's `szv` merge needs them, and
 * importing them from the transform would pull its property tables into every
 * app that calls `szv`. No warnings and no property tables here; the
 * transform adds its warning on top.
 *
 * @module
 */

/**
 * The key that holds a property's stand-alone keywords, with the property and
 * its group keys (space-separated, for the generated Rust copy).
 *
 * The CSS grammar lets a global keyword stand only alone, so the lowering
 * resolves a global beside its groups by the object's order
 * ({@link settleGlobalKeywords}). The engine reads a generated copy
 * (`scripts/generate-rust-transform-tables.mjs`).
 */
export const GLOBAL_KEYWORD_GROUPS: Record<string, Record<'property' | 'groups', string>> = {
    nums: {
        property: 'font-variant-numeric',
        groups: 'numFigure numSpacing numFraction numOrdinal numSlashedZero',
    },
    touch: { property: 'touch-action', groups: 'touchPanX touchPanY touchPinchZoom' },
    contain: {
        property: 'contain',
        groups: 'containSize containLayout containPaint containStyle',
    },
};

/** `GLOBAL_KEYWORD_GROUPS` as entries, built once. */
const GLOBAL_KEYWORD_ENTRIES = Object.entries(GLOBAL_KEYWORD_GROUPS);

/** The group key → its stand-alone key. */
const GLOBAL_KEYWORD_OF_GROUP: ReadonlyMap<string, string> = new Map(
    GLOBAL_KEYWORD_ENTRIES.flatMap(([global, { groups }]) =>
        groups.split(' ').map(group => [group, global] as const),
    ),
);

/** A stand-alone key → its group keys. */
export const GROUPS_OF_GLOBAL_KEYWORD: ReadonlyMap<string, readonly string[]> = new Map(
    GLOBAL_KEYWORD_ENTRIES.map(([global, { groups }]) => [global, groups.split(' ')]),
);

/**
 * The keys a later layer's key replaces besides itself: a stand-alone keyword
 * resets its groups, and a group replaces its stand-alone keyword.
 *
 * Merging `sz` layers (an sz array, an `szv` selection) applies each layer
 * after the one before it, as CSS does. Dropping the replaced side in the merge
 * keeps the merged object from holding a stand-alone keyword before a group
 * key, the shape a spread override leaves and the lowering reports.
 * @param key - A key of the later layer.
 * @returns The keys it replaces; empty for a key of no such family.
 */
export function keysDisplacedBy(key: string): readonly string[] {
    const global = GLOBAL_KEYWORD_OF_GROUP.get(key);
    if (global !== undefined) return [global];
    return GROUPS_OF_GLOBAL_KEYWORD.get(key) ?? [];
}

/** The answer for an object with no stand-alone keyword key. */
const NOTHING_SETTLED: ReadonlySet<string> = new Set();

/**
 * Whether an object level holds any stand-alone keyword key.
 * @param szProp - One object level of an sz value.
 * @returns True when a key of `GLOBAL_KEYWORD_GROUPS` is present.
 */
function holdsGlobalKeyword(szProp: Readonly<Record<string, unknown>>): boolean {
    for (const [global] of GLOBAL_KEYWORD_ENTRIES) {
        if (global in szProp) return true;
    }
    return false;
}

/**
 * The keys of one object level that a stand-alone keyword overrides, or that
 * override it.
 *
 * The object's own order decides, as it does for every other key: a global
 * keyword resets each group written before it, and the groups written after
 * it combine and replace it. So `{ contain: 'strict', containPaint: true }` is
 * `contain-paint`, and `{ containPaint: true, contain: 'strict' }` is
 * `contain-strict`. The global class and a group class are never both
 * emitted, so the result does not depend on Tailwind's sort, which puts the
 * stand-alone class after its groups whatever order they were written in.
 * @param szProp - One object level of an sz value.
 * @param onReplaced - Called for each stand-alone key a later group replaces,
 *   with its value and that group; the transform warns from it.
 * @returns The keys to leave out of the lowering; empty when nothing is settled.
 */
export function settleGlobalKeywords(
    szProp: Readonly<Record<string, unknown>>,
    onReplaced?: (global: string, value: unknown, group: string) => void,
): ReadonlySet<string> {
    // Runs on every object level of every `_sz` call; almost none holds a
    // stand-alone keyword, so answer those without allocating.
    if (!holdsGlobalKeyword(szProp)) return NOTHING_SETTLED;
    const settled = new Set<string>();
    const keys = Object.keys(szProp);
    const active = (key: string): boolean =>
        szProp[key] !== undefined && szProp[key] !== null && szProp[key] !== false;
    for (const [global, { groups }] of GLOBAL_KEYWORD_ENTRIES) {
        const at = keys.indexOf(global);
        if (at === -1 || !active(global)) continue;
        const members = new Set(groups.split(' '));
        const later = keys.slice(at + 1).find(key => members.has(key) && active(key));
        if (later !== undefined) {
            settled.add(global);
            onReplaced?.(global, szProp[global], later);
        }
        for (const key of later === undefined ? keys : keys.slice(0, at)) {
            if (members.has(key)) settled.add(key);
        }
    }
    return settled;
}

/**
 * The keys of one object level its stand-alone keywords settle away: the
 * groups a keyword resets, or the keyword a later group replaces. For a merge
 * of sz layers (`szv`), which settles each layer before merging it; nothing is
 * reported.
 * @param szProp - One object level of an sz value.
 * @returns The keys the lowering leaves out.
 */
export function keysSettledAway(szProp: Readonly<Record<string, unknown>>): ReadonlySet<string> {
    return settleGlobalKeywords(szProp);
}
