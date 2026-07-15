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
    BOX_ROLE_TOKENS,
    type BoxRole,
} from './box-role-map.generated.js';
import type { SzInput } from './concatenate.js';

export type { BoxRole };

/** The classification of a single class token. */
export interface Classification {
    /** Which side of the border the property acts on. */
    readonly role: BoxRole;
    /** Semantic group (margin, padding, border, overflow, text, …). */
    readonly category: string;
}

/**
 * A way to address a set of classes. One of:
 * - a box-role: `'outer'` | `'inner'`
 * - a box-layer alias: `'content'` (= inner) (`'margin'`/`'border'`/`'padding'`
 *   are also categories, so they work directly)
 * - a category: `'overflow'`, `'text'`, `'bg'`, …
 * - a class-prefix: `'px'`, `'bg'`, … (matches `px-2`, `bg-red-500`, …)
 * - a category+value pair: `{ overflow: 'hidden' }`
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
 * Per-token classification memo. `inspect` is a pure function of the static
 * generated tables (custom szcn theme groups do not affect box roles), so
 * entries never invalidate; the cap only bounds adversarial dynamic classNames.
 * The cached info objects are shared across callers — every consumer
 * (`splitBox`, `matches`, `classify`) reads, never mutates.
 */
const INSPECT_MEMO_MAX = 4096;
const inspectMemo = new Map<string, TokenInfo | undefined>();

/**
 * Classify a single class token, or `undefined` if csszyx does not own it.
 * `splitBox` runs this per token per render at the leaf of a layered
 * design-system component, so it is memoized per token.
 *
 * @param token - A single class token to classify.
 * @returns Token info (role, category, base, value), or `undefined` if unowned.
 */
function inspect(token: string): TokenInfo | undefined {
    if (inspectMemo.has(token)) {
        return inspectMemo.get(token);
    }
    const info = inspectUncached(token);
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

    const exact = BOX_ROLE_TOKENS.get(base);
    if (exact) return { ...exact, base, value: base };

    const bucket = BOX_ROLE_PREFIXES_BY_FIRST_SEGMENT.get(base.split('-', 1)[0] as string) ?? [];
    for (const [prefix, entry] of bucket) {
        if (base === prefix) return { ...entry, base, value: '' };
        if (base.startsWith(`${prefix}-`)) {
            return { ...entry, base, value: base.slice(prefix.length + 1) };
        }
    }
    return undefined;
}

/**
 * Classify a class token by box-model role + semantic category, or `undefined`
 * if it is not a csszyx-owned utility. Variant-, important- and negative-aware.
 *
 * @param token - A single class token to classify.
 * @returns The token's role and category, or `undefined` if unowned.
 */
export function classify(token: string): Classification | undefined {
    const info = inspect(token);
    return info ? { role: info.role, category: info.category } : undefined;
}

/**
 * Does `info` satisfy `selector`? `info === undefined` never matches.
 *
 * @param info - The classified token info, or `undefined`.
 * @param selector - The selector to test the token against.
 * @returns `true` if the token matches the selector.
 */
function matches(info: TokenInfo | undefined, selector: BoxSelector): boolean {
    if (!info) return false;
    if (typeof selector === 'object') {
        return Object.entries(selector).every(
            ([category, value]) => info.category === category && info.value === value,
        );
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
 * @returns `true` if the token matches at least one selector.
 */
function anyMatch(info: TokenInfo | undefined, selectors: BoxSelector[]): boolean {
    return selectors.some(s => matches(info, s));
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
 * Partition a className string into `{ outer, inner }` at the CSS box-model
 * border line. Every token lands in exactly one bucket (no loss, no duplication)
 * and keeps its variant prefix. Overrides in `options.inner` / `options.outer`
 * win over the default map; `inner` is checked first when a token matches both.
 *
 * @param className - The flat className string to partition.
 * @param options - Overrides for forcing tokens onto a node and the fallback role.
 * @returns The `{ outer, inner }` class buckets.
 * @example splitBox('m-4 px-2 md:flex') // → { outer: 'm-4', inner: 'px-2 md:flex' }
 */
export function splitBox(className: string, options: SplitBoxOptions = {}): SplitBoxResult {
    const forceInner = options.inner ?? [];
    const forceOuter = options.outer ?? [];
    const fallback: BoxRole = options.fallback ?? 'outer';
    const outer: string[] = [];
    const inner: string[] = [];

    for (const token of tokenize(className)) {
        const info = inspect(token);
        let role: BoxRole;
        if (anyMatch(info, forceInner)) role = 'inner';
        else if (anyMatch(info, forceOuter)) role = 'outer';
        else role = info ? info.role : fallback;
        (role === 'outer' ? outer : inner).push(token);
    }

    return { outer: outer.join(' '), inner: inner.join(' ') };
}

/**
 * Does any token in `classes` match `selector`? Variant- and mangle-robust.
 *
 * @param classes - A className string to scan.
 * @param selector - The selector to test tokens against.
 * @returns `true` if any token matches the selector.
 */
export function has(classes: string, selector: BoxSelector): boolean {
    return tokenize(classes).some(t => matches(inspect(t), selector));
}

/**
 * Keep only the tokens in `classes` that match `selector`.
 *
 * @param classes - A className string to filter.
 * @param selector - The selector tokens must match to be kept.
 * @returns The matching tokens joined by spaces.
 */
export function pick(classes: string, selector: BoxSelector): string {
    return tokenize(classes)
        .filter(t => matches(inspect(t), selector))
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
    return tokenize(classes)
        .filter(t => !matches(inspect(t), selector))
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
 * @param key - An sz prop key (e.g. `'m'`, `'px'`, `'grow'`).
 * @returns The key's role and category, or `undefined` if unowned.
 */
export function classifySzKey(key: string): Classification | undefined {
    return BOX_ROLE_BY_KEY.get(key);
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
    const forceInner = options.inner ?? [];
    const forceOuter = options.outer ?? [];
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
        (entry.role === 'inner' ? context.inner : context.outer)[key] = value;
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
    return filterSz(flattenSz(sz, 0), selector, false, 0);
}
