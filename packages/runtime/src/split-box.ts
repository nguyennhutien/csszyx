/**
 * Route a (csszyx-emitted) className string to nested elements by CSS box-model
 * role, plus a category-aware toolkit that exposes csszyx's class knowledge as
 * primitives. Pure string functions — framework-agnostic, cross-platform, no
 * React, no DOM. The class-token → box-role map is GENERATED from the compiler's
 * property tables (see `box-role-map.generated.ts`), so it never drifts.
 *
 * The problem this solves: a caller passes one flat `className` (e.g. from an sz
 * prop) to a component, but the component renders nested elements — the margin
 * belongs on the outer frame while the padding belongs on the inner content. A
 * slot recipe can't re-route a caller's flat string; only a runtime partition
 * can. `splitBox` does that partition at the border line (outer = border-outward,
 * inner = border-inward); the toolkit lets a project express cross-element
 * dependency rules (e.g. "if the frame clips, make the scroller scroll") without
 * hardcoding csszyx's class vocabulary.
 */
import {
    isForbiddenSzKey,
    MAX_SZ_DEPTH,
    SzDepthError,
    type SzObject,
    type SzValue,
} from '@csszyx/compiler/browser';
import {
    BOX_ROLE_BY_KEY,
    BOX_ROLE_PREFIXES,
    BOX_ROLE_SCOPE_MARKERS,
    BOX_ROLE_TOKENS,
    type BoxRole,
    type BoxRoleEntry,
} from './box-role-map.generated.js';
import { decodeToken, type MangleBridge, mangleBridge } from './class-codec.js';
import type { SzInput } from './concatenate.js';
import { devWarn } from './dev-warn.js';
import {
    classifyAmbiguousValue,
    getSzcnGroupsGeneration,
    MERGE_GROUP_PROPERTIES,
} from './merge-groups.js';

export type { BoxRole };

/** The classification of a single class token. */
export interface Classification {
    /** Which side of the border the property acts on. */
    readonly role: BoxRole;
    /** Semantic group (margin, padding, border, overflow, text, …). */
    readonly category: string;
    /**
     * Which CSS property inside the category, for the prefixes that span more
     * than one (`text-red-500` is color, `text-sm` is font-size), including for
     * token names the app declared in its Tailwind `@theme`. Absent — never
     * `null`, never `''` — when the prefix means exactly one property
     * (`p-4`) or when the value does not confidently name one.
     *
     * The BARE half of `szcn`'s group id (`'color'`, not `'text:color'`). The
     * qualified half names the CLASS PREFIX, which is not always the category:
     * `font-bold` is prefix `font` and category `text`. Carrying it would put a
     * second, differently-spelled family name next to {@link Classification.category}
     * and invite a consumer to branch on the wrong one. What the field answers
     * is one question — which property within this token's family — and the
     * family is already in the object next to it.
     */
    readonly property?: string;
}

/**
 * A way to address a set of classes. One of:
 * - a box-role: `'outer'` | `'inner'`
 * - a box-layer alias: `'content'` (= inner) (`'margin'`/`'border'`/`'padding'`
 *   are also categories, so they work directly)
 * - a category: `'overflow'`, `'text'`, `'bg'`, …
 * - a class-prefix: `'px'`, `'bg'`, … (matches `px-2`, `bg-red-500`, …)
 * - a category+value pair: `{ overflow: 'hidden' }`
 * - any of the above qualified by a CSS property: `'text:color'`, `'font:weight'`,
 *   `'outer:color'` — the token must match the half before the colon AND carry
 *   that {@link Classification.property}
 */
export type BoxSelector = string | Readonly<Record<string, string>>;

/** Options controlling how `splitBox` partitions a className. */
export interface SplitBoxOptions {
    /** Force these selectors onto the outer node, overriding the default map. */
    outer?: BoxSelector[];
    /** Force these selectors onto the inner node, overriding the default map. */
    inner?: BoxSelector[];
    /** Where an unrecognized token goes. Defaults to `'outer'`. */
    fallback?: BoxRole;
}

/** The two class buckets produced by `splitBox`. */
export interface SplitBoxResult {
    /** Classes for the outer (border-outward) element. */
    outer: string;
    /** Classes for the inner (border-inward) element. */
    inner: string;
}

/** A classified token enriched with its stripped base and value segment. */
interface TokenInfo extends Classification {
    /** Base utility with variant prefix / `!` / leading `-` stripped. */
    readonly base: string;
    /** Value segment after the matched prefix (`''` for value-keyed tokens). */
    readonly value: string;
    /** Declared on both nodes rather than routed to one (`transition-*`). */
    readonly both?: boolean;
}

/**
 * Strip the variant prefix from a token, returning the base utility. Splits on
 * the LAST `:` that is not inside `[]` or `()`, so arbitrary variants
 * (`@max-[600px]:`, `[&:hover]:`, `aria-[sort=asc]:`) survive intact.
 *
 * @param token - A single class token, possibly variant-prefixed.
 * @returns The base utility with the variant prefix removed.
 */
export function stripVariant(token: string): string {
    let depth = 0;
    for (let i = token.length - 1; i >= 0; i--) {
        const ch = token[i];
        if (ch === ']' || ch === ')') depth++;
        else if (ch === '[' || ch === '(') depth--;
        else if (ch === ':' && depth === 0) return token.slice(i + 1);
    }
    return token;
}

/**
 * Remove leading/trailing `!` (important) and a leading `-` (negative).
 *
 * @param base - The base utility, possibly important- or negative-marked.
 * @returns The base with important/negative markers stripped.
 */
export function normalizeBase(base: string): string {
    let b = base;
    if (b.startsWith('!')) b = b.slice(1);
    if (b.endsWith('!')) b = b.slice(0, -1);
    if (b.startsWith('-')) b = b.slice(1);
    return b;
}

/**
 * `BOX_ROLE_PREFIXES` bucketed by first dash-segment: a matching prefix always
 * shares the base's first segment, so per-token classification scans ~2 entries
 * instead of all 267 while returning exactly what the full ordered scan did.
 * Shared with `merge-classes.ts` (szcn), which classifies through the same
 * table.
 */
export const BOX_ROLE_PREFIXES_BY_FIRST_SEGMENT: ReadonlyMap<
    string,
    ReadonlyArray<[string, (typeof BOX_ROLE_PREFIXES)[number][1]]>
> = (() => {
    const buckets = new Map<string, Array<[string, (typeof BOX_ROLE_PREFIXES)[number][1]]>>();
    for (const [prefix, entry] of BOX_ROLE_PREFIXES) {
        const segment = prefix.split('-', 1)[0] as string;
        let bucket = buckets.get(segment);
        if (!bucket) {
            bucket = [];
            buckets.set(segment, bucket);
        }
        bucket.push([prefix, entry]);
    }
    return buckets;
})();

/**
 * Per-token classification memo, keyed by the RAW token. `inspect` is a pure
 * function of the static generated tables, the installed mangle bridge and the
 * registered szcn theme groups. Box ROLE and category come from the tables
 * alone; the theme groups reach {@link Classification.property} only, and both
 * of the other two can change at runtime, so {@link syncMemos} empties both
 * memos whenever the bridge identity or the registration generation moves. The
 * cap only bounds adversarial dynamic classNames. The cached info objects are
 * shared across callers — every consumer (`splitBox`, `matches`, `classify`)
 * reads, never mutates.
 */
const INSPECT_MEMO_MAX = 4096;
const inspectMemo = new Map<string, TokenInfo | undefined>();
/** The bridge both memos were filled under; `undefined` until the first call. */
let memoBridgeRef: MangleBridge | undefined;
/** The theme-group registration generation both memos were filled under. */
let memoGroupsGeneration = getSzcnGroupsGeneration();

/**
 * Read the mangle bridge once for a public operation, dropping every memo
 * entry when it is not the object the memos were filled under.
 *
 * A registry that arrives after a component's first render, a replaced map
 * in a test, or a cleared registry all change what a token means. Compared
 * by identity rather than presence, the way `szcn` does, so a swapped bridge
 * never serves answers memoized under the previous map. In production the
 * registry is installed once for the page lifetime, so this never clears.
 *
 * The theme-group generation is checked for the same reason and is NOT rare:
 * an HMR edit to a `@theme` block re-runs the build's `setSzcnGroups`, and a
 * token that was `{ category: 'text' }` a moment ago is `text:color` now.
 *
 * @returns The bridge to decode through for this operation.
 */
function syncMemos(): MangleBridge | undefined {
    const bridge = mangleBridge();
    const generation = getSzcnGroupsGeneration();
    if (bridge !== memoBridgeRef || generation !== memoGroupsGeneration) {
        inspectMemo.clear();
        splitMemo.clear();
        memoBridgeRef = bridge;
        memoGroupsGeneration = generation;
    }
    return bridge;
}

/**
 * Classify a single class token, or `undefined` if csszyx does not own it.
 * `splitBox` runs this per token per render at the leaf of a layered
 * design-system component, so it is memoized per token.
 *
 * The token is decoded through the bridge BEFORE classification: on a mangled
 * build the DOM carries `y`, not `w-full`, and the tables know only the
 * original spelling. The memo key stays the raw token, because that is what
 * every caller holds and what every caller must get back — see the public
 * functions below, none of which emits a decoded name.
 *
 * @param token - A single class token to classify.
 * @param bridge - The bridge read once by the caller via {@link syncMemos}.
 * @returns Token info (role, category, base, value), or `undefined` if unowned.
 */
function inspect(token: string, bridge: MangleBridge | undefined): TokenInfo | undefined {
    if (inspectMemo.has(token)) {
        return inspectMemo.get(token);
    }
    const info = inspectUncached(decodeToken(token, bridge));
    if (inspectMemo.size >= INSPECT_MEMO_MAX) {
        inspectMemo.clear();
    }
    inspectMemo.set(token, info);
    return info;
}

/**
 * The uncached classification — see {@link inspect}.
 *
 * @param token - A single class token to classify.
 * @returns Token info, or `undefined` if unowned.
 */
function inspectUncached(token: string): TokenInfo | undefined {
    const base = normalizeBase(stripVariant(token));
    if (!base) return undefined;

    // A token built from one closed value of a prefixed key carries that value
    // (`overflow-hidden` → `hidden`), so an object selector reads it the way it
    // reads a prefixed token. Value-keyed sugar has no prefix and its class name
    // IS the value (`block`, `italic`), so it answers with the whole base.
    const exact = BOX_ROLE_TOKENS.get(base);
    if (exact) {
        const value = exact.value ?? base;
        // Exact sugar can still belong to an ambiguous family (text-ellipsis).
        // Derive that family from its spelling, as the merge classifier does.
        const prefix = exact.prefix ?? (base.split('-', 1)[0] as string);
        return {
            ...exact,
            base,
            value,
            property: propertyOf(prefix, base.slice(prefix.length + 1)),
        };
    }

    // `group/item` names WHICH ancestor a `group-hover/item:` variant reads; the
    // marker itself does the same thing named or bare. Only the tokens in the
    // generated set take a name, because a slash means an opacity modifier
    // everywhere else (`bg-red-500/50`).
    const slash = base.indexOf('/');
    if (slash > 0) {
        const marker = BOX_ROLE_SCOPE_MARKERS.get(base.slice(0, slash));
        if (marker) return { ...marker, base, value: base.slice(slash + 1) };
    }

    const bucket = BOX_ROLE_PREFIXES_BY_FIRST_SEGMENT.get(base.split('-', 1)[0] as string) ?? [];
    for (const [prefix, entry] of bucket) {
        if (base === prefix) return { ...entry, base, value: '', property: propertyOf(prefix, '') };
        if (base.startsWith(`${prefix}-`)) {
            const value = base.slice(prefix.length + 1);
            return { ...entry, base, value, property: propertyOf(prefix, value) };
        }
    }
    return undefined;
}

/**
 * The CSS property a token's value names inside its family, or `undefined`.
 *
 * Reads `szcn`'s value classifier, so the two halves of csszyx answer the same
 * thing about the same token — including for names an app declared in its
 * Tailwind `@theme`, which the build registers through `setSzcnGroups`.
 *
 * ⚠ The two consumers fail safe in OPPOSITE directions and must not be
 * unified. `null` from the classifier means "not confidently one property":
 * for `szcn` that means KEEP BOTH classes, because merging on a guess deletes
 * a class the author wrote; here it means fall back to the coarse category, so
 * the field is simply absent. Passing the `null` through would hand consumers
 * a third state to destructure, and defaulting it to a guessed property would
 * import szcn's under-merge bias as an over-claim.
 *
 * @param prefix - The class prefix the token matched, if it has one.
 * @param value - The value segment after that prefix.
 * @returns The bare property name, or `undefined` when it is not certain.
 */
function propertyOf(prefix: string | undefined, value: string): string | undefined {
    if (prefix === undefined) return undefined;
    const group = classifyAmbiguousValue(prefix, value);
    // Group ids are `<prefix>:<property>`; the caller already has the family.
    return group === null ? undefined : group.slice(group.indexOf(':') + 1);
}

/**
 * Classify a class token by box-model role + semantic category, or `undefined`
 * if it is not a csszyx-owned utility. Variant-, important- and negative-aware.
 *
 * A prefix that spans more than one CSS property also answers with the
 * {@link Classification.property} its value names — `text-red-500` is a color
 * and `text-sm` a font-size — and a name the app declared in its Tailwind
 * `@theme` is read the same way a built-in one is.
 *
 * @param token - A single class token to classify.
 * @returns The token's role, category and property, or `undefined` if unowned.
 * @example classify('text-sm') // → { role: 'inner', category: 'text', property: 'size' }
 */
export function classify(token: string): Classification | undefined {
    const info = inspect(token, syncMemos());
    if (!info) return undefined;
    // The key is omitted rather than set to `undefined`, so a consumer testing
    // `'property' in c` reads the same answer as one testing `c.property`.
    return info.property === undefined
        ? { role: info.role, category: info.category }
        : { role: info.role, category: info.category, property: info.property };
}

/** Every category the generated tables use, for telling a typo from a miss. */
const KNOWN_CATEGORIES: ReadonlySet<string> = new Set([
    ...[...BOX_ROLE_TOKENS.values()].map(entry => entry.category),
    ...BOX_ROLE_PREFIXES.map(([, entry]) => entry.category),
]);

/** Every exact token and class prefix the generated tables know. */
const KNOWN_PREFIXES: ReadonlySet<string> = new Set([
    ...BOX_ROLE_TOKENS.keys(),
    ...BOX_ROLE_PREFIXES.map(([prefix]) => prefix),
]);

/** Words a caller reaches for that name a CSS property rather than a category. */
const CATEGORY_HINTS: Readonly<Record<string, string>> = {
    width: 'sizing',
    height: 'sizing',
    color: 'text',
    colour: 'text',
    background: 'bg',
    cursor: 'interaction',
};

/**
 * A property half is a plain word (`color`, `size`, `weight`), which
 * is what tells a qualified selector from a CLASS that happens to carry a colon
 * in an arbitrary value — `bg-[url(https://x)]` is a legitimate literal name a
 * placement list may address.
 */
const PROPERTY_HALF = /^[a-z]+$/i;

/**
 * Split `'<selector>:<property>'` into its two halves, or `null` if the string
 * is not that shape.
 *
 * The qualified STRING is the additive way to say this. A colon cannot appear
 * in a base utility — {@link stripVariant} removes everything up to the last
 * one before anything is matched — so the string namespace has room for it,
 * while the object form is already spoken for by `{ category: value }`, whose
 * value is the token's value segment and not its property. Qualifying an
 * existing selector rather than adding a parallel one also means every left
 * half keeps working: a role (`'outer:color'`), a category (`'text:color'`) and
 * a class prefix (`'font:weight'`) all compose with the property.
 *
 * @param selector - The string the caller passed.
 * @returns The `[selector, property]` halves, or `null`.
 */
function splitQualified(selector: string): readonly [string, string] | null {
    const sep = selector.indexOf(':');
    if (sep <= 0) return null;
    const property = selector.slice(sep + 1);
    return PROPERTY_HALF.test(property) ? [selector.slice(0, sep), property] : null;
}

/**
 * Which vocabulary a string selector is checked against.
 *
 * The class toolkit reads CLASS spellings, so a string selector is a
 * category, a role alias, or a class prefix. The sz-object twins read sz KEYS
 * (`minW`, `flexDir`, `gapX`), and a key is not a class prefix — the check
 * that is right for one family silently rejects half the other's inputs.
 */
type SelectorFamily = 'class' | 'sz';

/**
 * Whether a string selector names something the family's tables can match.
 *
 * @param selector - The string the caller passed.
 * @param family - Whose vocabulary to check it against.
 * @returns `true` when at least one token or key could match it.
 */
function stringSelectorIsKnown(selector: string, family: SelectorFamily): boolean {
    if (selector === 'outer' || selector === 'inner' || selector === 'content') return true;
    if (KNOWN_CATEGORIES.has(selector)) return true;
    if (family === 'sz') return BOX_ROLE_BY_KEY.has(selector);
    // A whole class (`overflow-hidden`), a prefix deeper than the table's
    // (`bg-red`) and the table's own prefix (`bg`) all start with a segment the
    // tables know; a typo (`widht`) or a property name (`width`) does not.
    return (
        KNOWN_PREFIXES.has(selector) ||
        BOX_ROLE_PREFIXES_BY_FIRST_SEGMENT.has(selector.split('-', 1)[0] as string)
    );
}

/**
 * Whether a selector can match anything, warning in development when it
 * cannot.
 *
 * Three shapes used to reach the matcher and answer without meaning to: an
 * empty object matched every csszyx token, because "every entry agrees" is
 * vacuously true of no entries; a misspelt category fell through to the
 * prefix test and answered false, indistinguishable from "no such class";
 * and an array — the shape `splitBox`'s override lists take — answered false
 * the same way. Called once per public operation, not per token.
 *
 * @param selector - What the caller passed.
 * @param family - Whose vocabulary a string selector is checked against.
 * @returns `true` when the selector is worth testing tokens against.
 */
function selectorIsUsable(selector: BoxSelector, family: SelectorFamily = 'class'): boolean {
    if (Array.isArray(selector)) {
        devWarn(
            'has/pick/omit take one selector, not an array; pass the selectors one at a time, ' +
                'or use splitBox whose inner/outer options take a list.',
        );
        return false;
    }
    if (typeof selector === 'object') {
        const categories = Object.keys(selector);
        if (categories.length === 0) {
            devWarn(
                'an empty selector {} matches nothing; name a category and value, ' +
                    'e.g. { overflow: "hidden" }.',
            );
            return false;
        }
        if (categories.length > 1) {
            // A token belongs to one category, so two entries can never both
            // agree on it.
            devWarn(
                'an object selector names one category and value; ' +
                    `{ ${categories.join(', ')} } can never match a single token.`,
            );
            return false;
        }
        const category = categories[0] as string;
        if (!KNOWN_CATEGORIES.has(category)) {
            warnUnknownSelector(category);
            return false;
        }
        return true;
    }
    const qualified = family === 'class' ? splitQualified(selector) : null;
    if (qualified && !MERGE_GROUP_PROPERTIES.has(qualified[1])) {
        devWarn(
            `'${qualified[1]}' is not a property csszyx tells apart; '${selector}' matches nothing. ` +
                `help: the properties are ${[...MERGE_GROUP_PROPERTIES].join(', ')} — ` +
                "classify('<a class>') shows the one a class carries.",
        );
        return false;
    }
    const name = qualified ? qualified[0] : selector;
    if (stringSelectorIsKnown(name, family)) return true;
    warnUnknownSelector(name);
    return false;
}

/**
 * Say that a name matches nothing, and what would.
 *
 * @param name - The category or prefix the caller wrote.
 */
function warnUnknownSelector(name: string): void {
    const hint = CATEGORY_HINTS[name];
    if (hint === undefined) {
        devWarn(
            `'${name}' is not a category or class prefix csszyx knows; ` +
                "classify('<a class>') shows the category a class belongs to.",
        );
        return;
    }
    // `color` is both the word people reach for and a property the qualified
    // form can name, so the hint offers the narrower selector as well: `text`
    // alone would also catch `text-sm`.
    if (MERGE_GROUP_PROPERTIES.has(name)) {
        devWarn(
            `'${name}' is not a category or class prefix csszyx knows; ` +
                `the category is '${hint}', and '${hint}:${name}' matches that property only.`,
        );
        return;
    }
    devWarn(`'${name}' is not a category or class prefix csszyx knows; the category is '${hint}'.`);
}

/**
 * Does `info` satisfy `selector`? `info === undefined` never matches.
 *
 * @param info - The classified token info, or `undefined`.
 * @param selector - The selector to test the token against.
 * @param base - The literal name to fall back on when `info` is `undefined`:
 *   an unrecognised token answers to its own whole name so a placement list can
 *   address it.
 * @returns `true` if the token matches the selector.
 */
function matches(info: TokenInfo | undefined, selector: BoxSelector, base = ''): boolean {
    // A token csszyx does not recognise still answers to its own name. That is
    // the escape hatch the atomic-only scope owes the author: a custom
    // `@utility` has no correct side, so `{ inner: ['card'] }` must be able to
    // place it by hand. Whole name only — reading `card` as a prefix of
    // `card-lg` would be a guess about a structure csszyx knows nothing about.
    if (!info) return typeof selector === 'string' && selector !== '' && selector === base;
    if (typeof selector === 'object') {
        return Object.entries(selector).every(
            ([category, value]) => info.category === category && info.value === value,
        );
    }
    const qualified = splitQualified(selector);
    if (qualified) {
        return info.property === qualified[1] && matches(info, qualified[0], base);
    }
    if (selector === 'outer' || selector === 'inner') {
        return info.role === selector;
    }
    if (selector === 'content') return info.role === 'inner';
    if (selector === info.category) return true;
    if (info.base === selector) return true;
    return info.base.startsWith(`${selector}-`);
}

/**
 * Does `info` satisfy any of `selectors`?
 *
 * @param info - The classified token info, or `undefined`.
 * @param selectors - The selectors to test the token against.
 * @param base - The literal name to fall back on when `info` is `undefined`.
 * @returns `true` if the token matches at least one selector.
 */
function anyMatch(info: TokenInfo | undefined, selectors: BoxSelector[], base = ''): boolean {
    return selectors.some(s => matches(info, s, base));
}

/**
 * The name an unrecognised token answers to: decoded, variant- and
 * marker-stripped, the same normalisation {@link inspectUncached} does before
 * it gives up.
 *
 * @param token - A single raw class token.
 * @param bridge - The mangle bridge read once by the caller.
 * @returns The token's base name.
 */
function tokenBase(token: string, bridge: MangleBridge | undefined): string {
    return normalizeBase(stripVariant(decodeToken(token, bridge)));
}

/**
 * Split a className string into its individual non-empty tokens.
 *
 * @param className - A whitespace-separated className string.
 * @returns The non-empty class tokens.
 */
function tokenize(className: string): string[] {
    return className.split(/\s+/).filter(Boolean);
}

/**
 * Whole-partition memo for the default-options `splitBox`, which is what a
 * layered component calls per render on a className that does not change
 * between renders. Without it every render re-runs the regex tokenize (measured
 * at 35% of the call), the per-token classification, and both bucket joins.
 *
 * Only the default-options call is cached: an override list is an array of
 * selectors with no cheap identity, and the components that pass one are not
 * the per-render leaf this exists to serve.
 *
 * Safe to cache for the same reason `inspectMemo` is, and cleared by the same
 * {@link syncMemos}. The partition itself reads only the static generated
 * tables and the mangle bridge — a theme registration can add a `property` to
 * a token but can never move it between the two nodes — so this memo is
 * emptied on a registration change out of a single invalidation rule rather
 * than out of need.
 */
const SPLIT_MEMO_MAX = 512;
const splitMemo = new Map<string, { readonly outer: string; readonly inner: string }>();

/**
 * Whether any option would change the partition away from the memoized default.
 *
 * @param options - The caller's split options.
 * @returns `true` when the call must not read or write the result memo.
 */
function hasSplitOverrides(options: SplitBoxOptions): boolean {
    return (
        options.inner !== undefined || options.outer !== undefined || options.fallback !== undefined
    );
}

/**
 * Partition a className string into `{ outer, inner }` at the CSS box-model
 * border line. Nothing is lost and every token keeps its variant prefix: each
 * lands in exactly one bucket, except the timing group (`transition-*`,
 * `duration-*`, `ease-*`, `delay-*`), which is declared on both because the
 * state that fires a transition can sit on either node. Overrides in
 * `options.inner` / `options.outer` win over the default map and over the
 * both-node rule; `inner` is checked first when a token matches both.
 *
 * @param className - The flat className string to partition.
 * @param options - Overrides for forcing tokens onto a node and the fallback role.
 * @returns The `{ outer, inner }` class buckets.
 * @example splitBox('m-4 px-2 md:flex') // → { outer: 'm-4', inner: 'px-2 md:flex' }
 */
export function splitBox(className: string, options: SplitBoxOptions = {}): SplitBoxResult {
    const bridge = syncMemos();
    if (hasSplitOverrides(options)) {
        return splitBoxUncached(className, options, bridge);
    }
    let cached = splitMemo.get(className);
    if (cached === undefined) {
        cached = splitBoxUncached(className, options, bridge);
        // Admission stop at the cap, not a clear: clearing flushed every hot
        // entry whenever cold traffic crossed the cap, while overflow calls
        // pay only their own uncached split under either policy.
        if (splitMemo.size < SPLIT_MEMO_MAX) {
            splitMemo.set(className, cached);
        }
    }
    // A FRESH result object per call, never the cached one: `SplitBoxResult`'s
    // fields are mutable and callers have always received an object they own.
    // Handing out the shared instance would let one caller's write corrupt
    // every later render.
    return { outer: cached.outer, inner: cached.inner };
}

/**
 * Decide which node one token goes to.
 *
 * @param info - The classified token info, or `undefined` if unowned.
 * @param base - The token's literal name, for an unowned token.
 * @param forceInner - Placement selectors pinning a token to the content node.
 * @param forceOuter - Placement selectors pinning a token to the frame.
 * @returns The node, `'both'` for a property declared on each, or `undefined`
 *   when no rule decided and the caller's fallback is what places the token.
 */
function placementFor(
    info: TokenInfo | undefined,
    base: string,
    forceInner: BoxSelector[],
    forceOuter: BoxSelector[],
): BoxRole | 'both' | undefined {
    if (anyMatch(info, forceInner, base)) return 'inner';
    if (anyMatch(info, forceOuter, base)) return 'outer';
    // A transition is declared on both nodes unless the caller pinned it: it
    // does nothing on its own, and the state that fires it can sit on either
    // side. An override still wins, which is why this runs after the two
    // checks above.
    if (info?.both) return 'both';
    // `undefined` here is the whole point of the return type: it separates "the
    // table chose this side" from "nothing chose, so the fallback did". Asking
    // instead whether the chosen side EQUALS the fallback cannot tell a
    // deliberate placement onto that side from an unplaced token, and reports
    // the author's own decision back to them as a problem.
    return info?.role;
}

/**
 * Keep the placement selectors that can match something.
 *
 * A placement list may address an unrecognised token by its literal name —
 * that is the escape hatch the atomic-only scope owes the author, since a
 * custom `@utility` declaring several properties has no correct side.
 *
 * @param selectors - The caller's `outer` or `inner` list, possibly absent.
 * @param side - The placement option to name in the correction.
 * @param family - Class names strip variants; sz placements name literal keys.
 * @returns The selectors worth testing tokens against.
 */
function usablePlacements(
    selectors: BoxSelector[] | undefined,
    side: BoxRole,
    family: SelectorFamily = 'class',
): BoxSelector[] {
    if (selectors === undefined || selectors.length === 0) return [];
    // A string here names a class the author wrote, not a category they are
    // querying, so an unrecognised one is accepted rather than reported. That
    // is the escape hatch the atomic-only scope owes them: a custom `@utility`
    // declaring several properties has no correct side, so they must be able to
    // pick one. It also has to hold for a className that does not carry the
    // name — one options object serves many renders, and a render without the
    // class is not a typo.
    //
    // The cost is that a misspelt CATEGORY in a placement list is now silent.
    // It always was for a spelling that happened to exist: `{ inner: ['ring'] }`
    // against a className with no ring classes has never said anything. Only
    // `has`/`pick`/`omit` promise that warning, because there the string IS the
    // query and matching nothing is the whole answer.
    return selectors.filter(sel => {
        if (typeof sel !== 'string') return selectorIsUsable(sel, family);
        // The same normalisation `tokenBase` applies to the token, so a
        // placement written as `md:hidden`, `!hidden` or `-mt-4` can never equal
        // a base. Say so rather than let it match nothing.
        const base = family === 'class' ? normalizeBase(stripVariant(sel)) : sel;
        if (base !== sel && base !== '') {
            if (process.env.NODE_ENV !== 'production') {
                devWarn(
                    `splitBox: a placement list names a class by its base, so '${sel}' never matches; ` +
                        'the variant prefix and the ! or - marker are stripped before the comparison. ' +
                        `help: write { ${side}: ['${base}'] }; it places every variant of '${base}'.`,
                );
            }
            return false;
        }
        return sel !== '';
    });
}

/**
 * The uncached partition — see {@link splitBox} for the contract.
 *
 * @param className - The flat className string to partition.
 * @param options - Overrides for forcing tokens onto a node and the fallback role.
 * @param bridge - The mangle bridge read once by the caller via {@link syncMemos}.
 * @returns The `{ outer, inner }` class buckets.
 */
function splitBoxUncached(
    className: string,
    options: SplitBoxOptions,
    bridge: MangleBridge | undefined,
): SplitBoxResult {
    const tokens = tokenize(className);
    const forceInner = usablePlacements(options.inner, 'inner');
    const forceOuter = usablePlacements(options.outer, 'outer');
    const fallback: BoxRole = options.fallback ?? 'outer';
    const outer: string[] = [];
    const inner: string[] = [];

    const unplaced: string[] = [];

    for (const token of tokens) {
        const info = inspect(token, bridge);
        const base = info ? '' : tokenBase(token, bridge);
        const decided = placementFor(info, base, forceInner, forceOuter);
        // An empty base is a malformed token (`md:` on its own, a bare `!`).
        // There is no class to name and no placement list that could hold one.
        if (decided === undefined && base !== '') unplaced.push(base);
        const side = decided ?? fallback;
        if (side === 'both') {
            outer.push(token);
            inner.push(token);
            continue;
        }
        (side === 'outer' ? outer : inner).push(token);
    }

    if (process.env.NODE_ENV !== 'production') {
        warnUnplacedTokens(unplaced, fallback);
        warnUnusableSplit(outer, inner, bridge);
    }

    return { outer: outer.join(' '), inner: inner.join(' ') };
}

/**
 * Whether any token in `tokens` satisfies `predicate` once classified.
 *
 * @param tokens - Raw tokens from one bucket.
 * @param bridge - The mangle bridge for this operation.
 * @param predicate - Test run against each token's info and its stripped base.
 * @returns `true` when at least one token satisfies it.
 */
function someToken(
    tokens: readonly string[],
    bridge: MangleBridge | undefined,
    predicate: (info: TokenInfo | undefined, base: string) => boolean,
): boolean {
    // A token csszyx does not own has no base to test: every utility these
    // predicates name is one csszyx emits, so it can never be a match.
    return tokens.some(token => {
        const info = inspect(token, bridge);
        return predicate(info, info?.base ?? '');
    });
}

/**
 * A token that asks its element to scroll, rather than to clip.
 *
 * @param info - The classified token info, or `undefined` if unowned.
 * @returns `true` for `overflow-auto` / `overflow-scroll` on any axis.
 */
function isScroller(info: TokenInfo | undefined): boolean {
    return info?.category === 'overflow' && (info.value === 'auto' || info.value === 'scroll');
}

/**
 * A token that clips the element it is on.
 *
 * @param info - The classified token info, or `undefined` if unowned.
 * @returns `true` for `overflow-hidden` / `overflow-clip` on any axis.
 */
function isClip(info: TokenInfo | undefined): boolean {
    return info?.category === 'overflow' && (info.value === 'hidden' || info.value === 'clip');
}

/** Height bounds a scroll container can inherit or be given directly. */
const HEIGHT_BOUND_PREFIXES = ['h-', 'max-h-', 'min-h-', 'size-'];

/** Utilities that let a parent decide the height instead of a class here. */
const STRETCHED_BASES: ReadonlySet<string> = new Set(['flex-1', 'grow']);

/** Prefixes of the same, for the sized forms (`grow-0`, `basis-1/2`). */
const STRETCHED_PREFIXES = ['grow-', 'basis-'];

/**
 * Say that a token nothing classified was placed by the fallback rather than by
 * a rule. The atomic-only scope means a custom `@utility` declaring several
 * properties at once has no correct side, so the author has to make the call —
 * and cannot make it without being told. Development only; the caller guards on
 * `NODE_ENV`.
 *
 * @param unplaced - Base names of the tokens the fallback placed.
 * @param fallback - The role the fallback sent them to.
 */
function warnUnplacedTokens(unplaced: readonly string[], fallback: BoxRole): void {
    const node = fallback === 'outer' ? 'frame' : 'content';
    const other = fallback === 'outer' ? 'inner' : 'outer';
    for (const token of new Set(unplaced)) {
        devWarn(
            `splitBox: '${token}' is not a utility csszyx knows, so it went to the ${node} node with everything else it could not classify. ` +
                `help: if it is a custom @utility that declares properties for both nodes, csszyx cannot split it — no side is correct — so place it yourself with { ${other}: ['${token}'] }.`,
        );
    }
}

/**
 * Say when a partition produced a shape that cannot do what the className asked
 * for. Development only — the caller guards on `NODE_ENV`, so nothing here is
 * reachable in a production bundle, and every lookup goes through the same
 * memoized `inspect` the partition already filled.
 *
 * @param outer - Raw tokens routed to the frame.
 * @param inner - Raw tokens routed to the content.
 * @param bridge - The mangle bridge for this operation.
 */
function warnUnusableSplit(
    outer: readonly string[],
    inner: readonly string[],
    bridge: MangleBridge | undefined,
): void {
    const scroller = inner.find(token => isScroller(inspect(token, bridge)));

    if (scroller !== undefined) {
        // A scroll container with no height grows to fit its content, so it
        // never scrolls. The bound can be a class on either node, or it can
        // come from the parent, which is what the position and flex cases are.
        const bounded =
            someToken(
                [...outer, ...inner],
                bridge,
                (info, base) =>
                    info?.category === 'sizing' &&
                    HEIGHT_BOUND_PREFIXES.some(prefix => base.startsWith(prefix)),
            ) ||
            someToken(
                outer,
                bridge,
                (_info, base) =>
                    STRETCHED_BASES.has(base) ||
                    STRETCHED_PREFIXES.some(prefix => base.startsWith(prefix)),
            ) ||
            (someToken(outer, bridge, (_info, base) => base === 'absolute' || base === 'fixed') &&
                someToken(
                    outer,
                    bridge,
                    (info, base) =>
                        info?.category === 'position' && base !== 'absolute' && base !== 'fixed',
                ));
        if (!bounded) {
            devWarn(
                `splitBox: '${scroller}' went to the content node, but nothing bounds the height of either node, so the content will grow instead of scrolling. ` +
                    "help: give the className a height bound such as h-64, max-h-96 or h-full, or put 'flex flex-col min-h-0' on the frame and 'flex-1 min-h-0' on the content.",
            );
        }

        // Scrolled content paints to the padding box, so it runs over a corner
        // the frame rounded but did not clip.
        if (
            someToken(outer, bridge, info => info?.category === 'rounded') &&
            !someToken(outer, bridge, isClip)
        ) {
            devWarn(
                'splitBox: the frame is rounded and the content scrolls, but the frame does not clip, so scrolled content paints over the corners. ' +
                    "help: add 'overflow-hidden' to the frame.",
            );
        }
    }

    // `hidden` is display:none, which is inner: it stops the CONTENT node from
    // rendering while the frame keeps its own background, border and size. Under
    // a variant the pair is usually deliberate, so only the bare form is named.
    const hidden = inner.find(
        token =>
            token === stripVariant(token) && normalizeBase(decodeToken(token, bridge)) === 'hidden',
    );
    if (hidden !== undefined) {
        devWarn(
            `splitBox: '${hidden}' went to the content node, so the frame keeps its background, border and size and stays visible. ` +
                "help: pass { outer: ['hidden'] } if the whole box should disappear.",
        );
    }
}

/**
 * Does any token in `classes` match `selector`?
 *
 * Variant-aware — `md:w-4` is a width — and mangle-aware: a token is decoded
 * through the runtime registry before it is classified, so the answer is the
 * same on a production build where the DOM carries `y` for `w-full`. The
 * answer is lexical: it says whether a matching utility appears anywhere in
 * the list, not under which variant, so a responsive width counts as a width.
 *
 * @param classes - A className string to scan.
 * @param selector - The selector to test tokens against.
 * @returns `true` if any token matches the selector.
 */
export function has(classes: string, selector: BoxSelector): boolean {
    if (!selectorIsUsable(selector)) return false;
    const bridge = syncMemos();
    return tokenize(classes).some(t => matches(inspect(t, bridge), selector));
}

/**
 * Keep only the tokens in `classes` that match `selector`.
 *
 * @param classes - A className string to filter.
 * @param selector - The selector tokens must match to be kept.
 * @returns The matching tokens joined by spaces.
 */
export function pick(classes: string, selector: BoxSelector): string {
    if (!selectorIsUsable(selector)) return '';
    const bridge = syncMemos();
    return tokenize(classes)
        .filter(t => matches(inspect(t, bridge), selector))
        .join(' ');
}

/**
 * Drop the tokens in `classes` that match `selector`, keeping the rest.
 *
 * @param classes - A className string to filter.
 * @param selector - The selector tokens must match to be dropped.
 * @returns The non-matching tokens joined by spaces.
 */
export function omit(classes: string, selector: BoxSelector): string {
    if (!selectorIsUsable(selector)) return tokenize(classes).join(' ');
    const bridge = syncMemos();
    return tokenize(classes)
        .filter(t => !matches(inspect(t, bridge), selector))
        .join(' ');
}

// ── sz-object partitioning ──────────────────────────────────────────────────
// The string functions above route an emitted className. A component that stays
// sz-native (e.g. via `szv`) holds an sz OBJECT, not a string, and bridging
// through a className loses `szv`'s auto-safelisting. The functions below
// partition the sz object directly, using the same generated box-role map keyed
// by sz prop key (`BOX_ROLE_BY_KEY`), so a key lands on the same side its
// emitted class would: `splitBoxSz(x)` ≡ `splitBox(compile(x))` by construction.

/** Options controlling how `splitBoxSz` partitions an sz object. */
export interface SplitBoxSzOptions {
    /** Force these selectors onto the outer object, overriding the default map. */
    outer?: BoxSelector[];
    /** Force these selectors onto the inner object, overriding the default map. */
    inner?: BoxSelector[];
    /** Where an unrecognized key goes. Defaults to `'outer'`. */
    fallback?: BoxRole;
}

/** The two sz-object buckets produced by `splitBoxSz`. */
export interface SplitBoxSzResult {
    /** sz for the outer (border-outward) element. */
    outer: SzObject;
    /** sz for the inner (border-inward) element. */
    inner: SzObject;
}

/**
 * Classify an sz prop key by box-model role + semantic category, or `undefined`
 * if it is not a csszyx-owned key. The sz-object analog of `classify` (which
 * takes an emitted class token) — both read the same generated map, so
 * `classifySzKey('m')` and `classify('m-4')` agree.
 *
 * A few keys mean different things per value — `overflow: 'hidden'` clips the
 * frame while `overflow: 'auto'` scrolls the content — so pass the value to get
 * the role the emitted class would have. Without it the key's own role is
 * returned, which is what the class for any other value has.
 *
 * @param key - An sz prop key (e.g. `'m'`, `'px'`, `'grow'`).
 * @param value - The value the key holds, when it is known.
 * @returns The key's role and category, or `undefined` if unowned.
 */
export function classifySzKey(key: string, value?: SzValue): Classification | undefined {
    const entry = BOX_ROLE_BY_KEY.get(key);
    if (entry === undefined) return undefined;
    // A fresh pair, never the generated entry: that entry also carries the
    // routing detail behind the answer — a per-value role map, a both-node flag
    // — and this reads as `{ role, category }` everywhere it is documented.
    return { role: roleForValue(entry, value), category: entry.category };
}

/**
 * The role an sz entry takes for the value it holds.
 *
 * @param entry - The key's classification.
 * @param value - The value the key holds.
 * @returns The value's role, or the key's own when the value does not change it.
 */
function roleForValue(entry: BoxRoleEntry, value: SzValue | undefined): BoxRole {
    if (entry.byValue === undefined || typeof value !== 'string') return entry.role;
    return entry.byValue.get(value) ?? entry.role;
}

/**
 * A non-null, non-array object — a nested sz / variant object.
 *
 * @param value - Any sz value.
 * @returns `true` if `value` is a plain object.
 */
function isPlainObject(value: unknown): value is SzObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Does an sz key (with its classification) satisfy `selector`? A category+value
 * object selector matches on category alone, since the value lives on the sz
 * value rather than the key.
 *
 * @param key - The sz prop key.
 * @param entry - The key's classification, or `undefined` if unowned.
 * @param selector - The selector to test the key against.
 * @returns `true` if the key matches the selector.
 */
function matchesKey(
    key: string,
    entry: Classification | undefined,
    selector: BoxSelector,
): boolean {
    if (typeof selector === 'object') {
        return !!entry && Object.keys(selector).every(category => entry.category === category);
    }
    if (selector === 'outer' || selector === 'inner') return entry?.role === selector;
    if (selector === 'content') return entry?.role === 'inner';
    if (key === selector) return true;
    return !!entry && selector === entry.category;
}

/**
 * Does any selector in `selectors` match the key?
 *
 * @param key - The sz prop key.
 * @param entry - The key's classification, or `undefined` if unowned.
 * @param selectors - The selectors to test the key against.
 * @returns `true` if the key matches at least one selector.
 */
function anyMatchKey(
    key: string,
    entry: Classification | undefined,
    selectors: readonly BoxSelector[],
): boolean {
    return selectors.some(s => matchesKey(key, entry, s));
}

/**
 * Deep-merge `source` into `target` (last-write-wins), bounded in depth and
 * skipping prototype-polluting keys — sz can be untrusted runtime input.
 *
 * @param target - The object merged into (mutated and returned).
 * @param source - The object whose values win on conflict.
 * @param depth - Current recursion depth, bounded by `MAX_SZ_DEPTH`.
 * @returns `target`.
 */
function mergeSzInto(target: SzObject, source: SzObject, depth: number): SzObject {
    if (depth >= MAX_SZ_DEPTH) throw new SzDepthError();
    for (const key of Object.keys(source)) {
        if (isForbiddenSzKey(key)) continue;
        const sv = source[key];
        const tv = target[key];
        target[key] =
            isPlainObject(sv) && isPlainObject(tv) ? mergeSzInto({ ...tv }, sv, depth + 1) : sv;
    }
    return target;
}

/**
 * Flatten an `SzInput` into one merged sz object: arrays are flattened and
 * merged (last-write-wins), `null`/`false`/`undefined` are dropped. A raw string
 * has no sz-object representation, so it throws in development (mirroring `_sz`)
 * and is dropped in production.
 *
 * @param sz - The sz input to flatten.
 * @param depth - Current recursion depth, bounded by `MAX_SZ_DEPTH`.
 * @returns A single merged sz object.
 */
function flattenSz(sz: SzInput, depth: number): SzObject {
    if (depth >= MAX_SZ_DEPTH) throw new SzDepthError();
    if (!sz) return {};
    if (typeof sz === 'string') {
        if (process.env.NODE_ENV !== 'production' && sz.trim()) {
            throw new TypeError(
                `splitBoxSz partitions sz objects, not raw class strings — use splitBox() for ${JSON.stringify(sz)}.`,
            );
        }
        return {};
    }
    if (Array.isArray(sz)) {
        const acc: SzObject = {};
        for (const part of sz) mergeSzInto(acc, flattenSz(part, depth + 1), depth + 1);
        return acc;
    }
    // `SzInput`'s object member is the broad `object` (so a forwarded `SzProps`
    // type assigns in); here it is a real sz object the partitioner walks by key.
    return sz as SzObject;
}

/**
 * Partition `obj`'s keys into the `outer` / `inner` accumulators. A property key
 * routes by its box role (overrides win, `inner` checked first); an unowned key
 * with a nested object is a variant container (`hover`, `md`, `[&_*]`, …) and is
 * recursed, so it lands by the role of the property inside it and splits across
 * buckets when its inner properties disagree.
 *
 * @param obj - The sz object to partition.
 * @param options - The partition overrides and fallback.
 * @param outer - Accumulator for outer keys (mutated).
 * @param inner - Accumulator for inner keys (mutated).
 * @param depth - Current recursion depth, bounded by `MAX_SZ_DEPTH`.
 */
function partitionSz(
    obj: SzObject,
    options: SplitBoxSzOptions,
    outer: SzObject,
    inner: SzObject,
    depth: number,
): void {
    if (depth >= MAX_SZ_DEPTH) throw new SzDepthError();
    const forceInner = usablePlacements(options.inner, 'inner', 'sz');
    const forceOuter = usablePlacements(options.outer, 'outer', 'sz');
    const fallback: BoxRole = options.fallback ?? 'outer';
    const context: SzPartitionContext = {
        options,
        outer,
        inner,
        depth,
        forceInner,
        forceOuter,
        fallback,
    };

    for (const key of Object.keys(obj)) {
        if (!isForbiddenSzKey(key)) {
            partitionSzEntry(key, obj[key], context);
        }
    }
}

/** Shared state for routing one sz entry into box buckets. */
interface SzPartitionContext {
    options: SplitBoxSzOptions;
    outer: SzObject;
    inner: SzObject;
    depth: number;
    forceInner: readonly BoxSelector[];
    forceOuter: readonly BoxSelector[];
    fallback: BoxRole;
}

/**
 * Route one sz entry to its box bucket, recursing for variant containers.
 * @param key - Sz key to route.
 * @param value - Sz value associated with the key.
 * @param context - Partition configuration and bucket accumulators.
 */
function partitionSzEntry(key: string, value: SzValue, context: SzPartitionContext): void {
    const entry = BOX_ROLE_BY_KEY.get(key);
    if (anyMatchKey(key, entry, context.forceInner)) {
        context.inner[key] = value;
        return;
    }
    if (anyMatchKey(key, entry, context.forceOuter)) {
        context.outer[key] = value;
        return;
    }
    if (entry) {
        // Declared on both nodes, for the reason `splitBoxUncached` gives: the
        // transition is inert until something changes, and the change can sit
        // on either side.
        if (entry.both) {
            context.outer[key] = value;
            context.inner[key] = value;
            return;
        }
        (roleForValue(entry, value) === 'inner' ? context.inner : context.outer)[key] = value;
        return;
    }
    if (!isPlainObject(value)) {
        (context.fallback === 'inner' ? context.inner : context.outer)[key] = value;
        return;
    }
    const subOuter: SzObject = {};
    const subInner: SzObject = {};
    partitionSz(value, context.options, subOuter, subInner, context.depth + 1);
    if (Object.keys(subOuter).length > 0) context.outer[key] = subOuter;
    if (Object.keys(subInner).length > 0) context.inner[key] = subInner;
}

/**
 * Partition an sz object (or any `SzInput`) into `{ outer, inner }` at the CSS
 * box-model border line — the sz-object analog of `splitBox`. Each key routes to
 * the same side its emitted class would (`splitBoxSz(x)` buckets keys to the
 * roles `splitBox(compile(x))` gives the emitted classes). Arrays are flattened,
 * `null`/`false` collapse to empty objects, and `options.inner`/`outer`/
 * `fallback` behave like `SplitBoxOptions` (`inner` wins when a key matches both).
 *
 * @param sz - The sz object / input to partition.
 * @param options - Overrides for forcing keys onto a node and the fallback role.
 * @returns The `{ outer, inner }` sz-object buckets.
 * @example splitBoxSz({ m: 4, px: 2 }) // → { outer: { m: 4 }, inner: { px: 2 } }
 */
export function splitBoxSz(sz: SzInput, options: SplitBoxSzOptions = {}): SplitBoxSzResult {
    const outer: SzObject = {};
    const inner: SzObject = {};
    partitionSz(flattenSz(sz, 0), options, outer, inner, 0);
    return { outer, inner };
}

/**
 * Walk a flattened sz object (recursing into variant containers) keeping only
 * the keys whose `selector` match equals `keep` — the engine behind
 * `pickSz`/`omitSz`.
 *
 * @param obj - The flattened sz object.
 * @param selector - The selector keys are tested against.
 * @param keep - `true` to keep matches (pick), `false` to keep non-matches (omit).
 * @param depth - Current recursion depth, bounded by `MAX_SZ_DEPTH`.
 * @returns A new sz object with the filtered keys.
 */
function filterSz(obj: SzObject, selector: BoxSelector, keep: boolean, depth: number): SzObject {
    if (depth >= MAX_SZ_DEPTH) throw new SzDepthError();
    const result: SzObject = {};
    for (const key of Object.keys(obj)) {
        if (isForbiddenSzKey(key)) continue;
        const value = obj[key];
        const entry = BOX_ROLE_BY_KEY.get(key);
        if (entry || !isPlainObject(value)) {
            if (matchesKey(key, entry, selector) === keep) result[key] = value;
        } else {
            const sub = filterSz(value, selector, keep, depth + 1);
            if (Object.keys(sub).length > 0) result[key] = sub;
        }
    }
    return result;
}

/**
 * Does any key in `sz` match `selector` (after flattening, recursing into
 * variants)? The sz-object analog of `has`.
 *
 * @param sz - The sz input to scan.
 * @param selector - The selector to test keys against.
 * @returns `true` if any key matches.
 */
export function hasSz(sz: SzInput, selector: BoxSelector): boolean {
    if (!selectorIsUsable(selector, 'sz')) return false;
    const scan = (obj: SzObject, depth: number): boolean => {
        if (depth >= MAX_SZ_DEPTH) throw new SzDepthError();
        for (const key of Object.keys(obj)) {
            if (isForbiddenSzKey(key)) continue;
            const value = obj[key];
            const entry = BOX_ROLE_BY_KEY.get(key);
            if (matchesKey(key, entry, selector)) return true;
            if (!entry && isPlainObject(value) && scan(value, depth + 1)) return true;
        }
        return false;
    };
    return scan(flattenSz(sz, 0), 0);
}

/**
 * Keep only the keys in `sz` that match `selector` (recursing into variants).
 * The sz-object analog of `pick`.
 *
 * @param sz - The sz input to filter.
 * @param selector - The selector keys must match to be kept.
 * @returns A new sz object with the matching keys.
 */
export function pickSz(sz: SzInput, selector: BoxSelector): SzObject {
    if (!selectorIsUsable(selector, 'sz')) return {};
    return filterSz(flattenSz(sz, 0), selector, true, 0);
}

/**
 * Drop the keys in `sz` that match `selector`, keeping the rest (recursing into
 * variants). The sz-object analog of `omit`.
 *
 * @param sz - The sz input to filter.
 * @param selector - The selector keys must match to be dropped.
 * @returns A new sz object with the non-matching keys.
 */
export function omitSz(sz: SzInput, selector: BoxSelector): SzObject {
    const flat = flattenSz(sz, 0);
    if (!selectorIsUsable(selector, 'sz')) return flat;
    return filterSz(flat, selector, false, 0);
}
