/**
 * Mangle-aware className merge with last-wins override semantics.
 *
 * The design-system layered-component pattern (Box < Flex < Row/Col) flows
 * className strings down and resolves overrides ONCE at the leaf: a later class
 * overrides an earlier one of the SAME utility (e.g. an app's `gap-8` overriding
 * a component default `gap-2`). npm `tailwind-merge` cannot do this here because
 * in a production build csszyx MANGLES owned classes (`gap-2` → `q3`,
 * `gap-8` → `q7`), and tailwind-merge can't tell `q3`/`q7` are the same utility.
 *
 * csszyx owns the reverse mangle map, exposed at runtime as
 * `window.__csszyx.decode(mangled) → original`. So this merge decodes each token
 * to its original name, derives a conflict key (variant prefix + utility prefix),
 * keeps the LAST token per key, and returns the survivors (still in their
 * original — possibly mangled — token form, so the DOM matches the built CSS).
 *
 * Fail-safe: a token whose conflict group cannot be determined confidently is
 * NEVER merged away — it keys by itself, so at worst two classes coexist (the
 * pre-merge status quo), never a wrongly-dropped class.
 *
 * Single-property prefixes (gap, p, m, w, h, rounded, …) merge by prefix.
 * Prefixes that span multiple CSS properties (`text` covers font-size AND
 * color; `font` covers family AND weight; `bg`, `border`, `divide`, `ring`,
 * `outline`, `flex`) classify the token VALUE into a property group (see
 * `merge-groups.ts`): same group → last wins (`text-base` + `text-sm` →
 * `text-sm`), different group → co-exist, unclassifiable → keep-both.
 * Custom `@theme` tokens join their groups via `registerSzcnGroups` (the build
 * plugin injects this automatically from the theme scan).
 *
 * @module
 */
import { BOX_ROLE_TOKENS } from './box-role-map.generated.js';
import { classifyAmbiguousValue, getSzcnGroupsGeneration } from './merge-groups.js';
import { BOX_ROLE_PREFIXES_BY_FIRST_SEGMENT, normalizeBase, stripVariant } from './split-box.js';

/**
 * Utility prefixes that map to more than one CSS property. These route through
 * value-set classification (`merge-groups.ts`) instead of prefix-keyed merging
 * — merging by the prefix alone deleted a legitimate class of the OTHER
 * property (`font-sans` + `font-bold` → only `font-bold` survived).
 */
const AMBIGUOUS_PREFIXES: ReadonlySet<string> = new Set([
    'flex', // flex-1 (flex shorthand) vs flex-row (flex-direction)
    'text', // text-sm (font-size) vs text-red-500 (color)
    'bg', // bg-red-500 (color) vs bg-cover (size) vs bg-center (position)
    'border', // border-2 (width) vs border-red-500 (color) vs border-solid (style)
    'divide', // divide-x (width) vs divide-red-500 (color)
    'ring', // ring-2 (width) vs ring-red-500 (color)
    'outline', // outline-2 (width) vs outline-red-500 (color)
    'font', // font-sans (font-family) vs font-bold (font-weight)
]);

/**
 * Resolve a token to its original (un-mangled) name using the runtime reverse
 * mangle map when present. No map (dev / unmangled build) → token is already
 * original.
 *
 * @param token - A class token, possibly mangled.
 * @returns The original class name.
 */
function decodeToken(token: string): string {
    const decode = (globalThis as { __csszyx?: { decode?: (c: string) => string | undefined } })
        .__csszyx?.decode;
    if (typeof decode === 'function') {
        // The decode map is external (an inline script sets it). A buggy or
        // mid-update map that throws, or returns a non-string, must NEVER break
        // the merge — szcn is the leaf of every layered component, so a crash here
        // is a blank render. Fall back to the raw token (still valid; it just
        // won't be mangle-grouped, same as the no-map path). Fail-safe over clever.
        try {
            const decoded = decode(token);
            return typeof decoded === 'string' ? decoded : token;
        } catch {
            return token;
        }
    }
    return token;
}

/**
 * Directional shorthand → longhand coverage. A shorthand appearing LATER
 * overrides earlier longhands it subsumes (CSS-cascade-correct): a later `p-8`
 * removes an earlier `pb-4` (p covers bottom), while a later `pb-8` keeps an
 * earlier `p-4` (it only refines the bottom). Each entry includes itself.
 *
 * Covers padding, margin, inset (position), and border-radius. Logical sides
 * (`ps/pe`, `ms/me`) are subsumed by their padding/margin shorthand, but for
 * inset and rounded the coverage is PHYSICAL-only: `inset`/`rounded` do not
 * subsume the logical `start`/`end` / `rounded-s*`/`rounded-e*` tokens, which
 * are a different CSS longhand and could flip under RTL — leaving those as
 * keep-both (still cascade-correct, never wrongly dropped).
 *
 * TODO(v2): `border-<width>` is directional too, but the `border` prefix is
 * ambiguous (width vs color vs style), so it needs value-aware classification
 * (the same work as collapsing two `text-<size>` / two `bg-<color>`); deferred.
 */
const SHORTHAND_COVERAGE: Record<string, readonly string[]> = {
    p: ['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'ps', 'pe'],
    px: ['px', 'pl', 'pr', 'ps', 'pe'],
    py: ['py', 'pt', 'pb'],
    m: ['m', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'ms', 'me'],
    mx: ['mx', 'ml', 'mr', 'ms', 'me'],
    my: ['my', 'mt', 'mb'],
    // inset (position) — physical sides only.
    inset: ['inset', 'inset-x', 'inset-y', 'top', 'right', 'bottom', 'left'],
    'inset-x': ['inset-x', 'left', 'right'],
    'inset-y': ['inset-y', 'top', 'bottom'],
    // border-radius — physical corners only (logical rounded-s*/e* stay keep-both).
    rounded: [
        'rounded',
        'rounded-t',
        'rounded-r',
        'rounded-b',
        'rounded-l',
        'rounded-tl',
        'rounded-tr',
        'rounded-br',
        'rounded-bl',
    ],
    'rounded-t': ['rounded-t', 'rounded-tl', 'rounded-tr'],
    'rounded-r': ['rounded-r', 'rounded-tr', 'rounded-br'],
    'rounded-b': ['rounded-b', 'rounded-bl', 'rounded-br'],
    'rounded-l': ['rounded-l', 'rounded-tl', 'rounded-bl'],
};

/**
 * Classify a normalized token after its utility prefix has matched.
 *
 * @param norm Normalized utility token.
 * @param variant Variant prefix removed from the token.
 * @param prefix Matched utility prefix.
 * @returns Conflict classification or null when the value is ambiguous.
 */
function classifyMatchedPrefix(
    norm: string,
    variant: string,
    prefix: string,
): { key: string; covers: string[] } | null {
    if (AMBIGUOUS_PREFIXES.has(prefix)) {
        const value = norm === prefix ? '' : norm.slice(prefix.length + 1);
        const group = classifyAmbiguousValue(prefix, value);
        if (group === null) {
            return null;
        }
        const key = `${variant} ${group}`;
        return { key, covers: [key] };
    }

    const coveredPrefixes = SHORTHAND_COVERAGE[prefix] ?? [prefix];
    return {
        key: `${variant} ${prefix}`,
        covers: coveredPrefixes.map(covered => `${variant} ${covered}`),
    };
}

/**
 * Classify a token for merging: its conflict `key` plus the `covers` keys it
 * removes when it appears (the key itself, and — for a spacing shorthand — the
 * longhand keys it subsumes). Returns `null` when the token can't be confidently
 * grouped, so the caller keys it by itself (never merged away).
 *
 * @param token - A class token (already decoded to its original name).
 * @returns `{ key, covers }`, or `null` to key by the token itself.
 */
function mergeClassify(token: string): { key: string; covers: string[] } | null {
    const base = stripVariant(token);
    // The variant prefix is whatever stripVariant removed (e.g. `md:`, `hover:`).
    const variant = token.slice(0, token.length - base.length);
    const norm = normalizeBase(base);
    if (!norm) {
        return null;
    }
    // A BEM-style modifier (`tab-item-header--active`) is a DISTINCT class from its
    // base (`tab-item-header`), not a value-pair of the same utility — collapsing
    // them last-wins would drop the base (e.g. `tab-item-header` happens to start
    // with the real `tab` utility prefix). `--` never appears in a Tailwind utility
    // class (arbitrary values use `[…]`/`(…)`), so a token containing one — other
    // than a leading CSS-variable class — keys by itself and is never merged away.
    if (base.indexOf('--') > 0) {
        return null;
    }
    // Exact value-keyed tokens (flex/block/italic/underline …) span several CSS
    // properties under one category, so under-merge to avoid dropping a sibling.
    if (BOX_ROLE_TOKENS.has(norm)) {
        return null;
    }
    const bucket = BOX_ROLE_PREFIXES_BY_FIRST_SEGMENT.get(norm.split('-', 1)[0] as string) ?? [];
    for (const [prefix] of bucket) {
        if (norm === prefix || norm.startsWith(`${prefix}-`)) {
            return classifyMatchedPrefix(norm, variant, prefix);
        }
    }
    return null;
}

/**
 * Memo for repeated merges. Layered components call szcn with IDENTICAL inputs
 * every render (component defaults are constants), so a small LRU turns the
 * per-render cost into one Map lookup. The cache self-invalidates when either
 * classification input changes: the custom-group registration generation, or
 * the identity of the runtime decode bridge (both normally settle at startup,
 * before render loops, so steady-state renders never clear).
 */
const MEMO_MAX_ENTRIES = 500;
const memo = new Map<string, string>();
let memoGroupsGeneration = -1;
let memoDecodeRef: unknown;

/**
 * Merge className strings with last-wins override per utility, mangle-aware and
 * memoized (see the memo note above — repeated inputs return in one Map lookup).
 *
 * Intended for the single resolution point in a layered design-system component
 * (typically at the leaf Box): combine the component's default classes with the
 * forwarded override so the override wins on a same-utility collision, while
 * keeping production mangling intact (unlike npm tailwind-merge).
 *
 * @param inputs - Class strings; falsy inputs (`false`/`null`/`undefined`/`''`) are skipped.
 * @returns The merged className string.
 * @example szcn('gap-2 p-4', 'gap-8') // → 'p-4 gap-8'  (gap-8 overrides gap-2)
 */
export function szcn(...inputs: (string | false | null | undefined)[]): string {
    let key = '';
    for (const input of inputs) {
        if (input && typeof input === 'string') {
            key = key === '' ? input : `${key} ${input}`;
        }
    }
    const generation = getSzcnGroupsGeneration();
    // Compare the decode FUNCTION IDENTITY, not mere presence: a swapped bridge
    // (tests, or an exotic host replacing the inline script's object) must not
    // serve merges memoized under the previous map. In production the identity
    // is stable for the page lifetime, so this never clears.
    const decodeRef = (globalThis as { __csszyx?: { decode?: unknown } }).__csszyx?.decode;
    if (generation !== memoGroupsGeneration || decodeRef !== memoDecodeRef) {
        memo.clear();
        memoGroupsGeneration = generation;
        memoDecodeRef = decodeRef;
    }
    const cached = memo.get(key);
    if (cached !== undefined) {
        // Refresh recency so hot merges never age out.
        memo.delete(key);
        memo.set(key, cached);
        return cached;
    }
    const merged = mergeUncached(inputs);
    memo.set(key, merged);
    if (memo.size > MEMO_MAX_ENTRIES) {
        const oldest = memo.keys().next().value;
        if (oldest !== undefined) {
            memo.delete(oldest);
        }
    }
    return merged;
}

/**
 * Compiler-injected variant of {@link szcn} for compiled `sz={[...]}` arrays —
 * identical merge semantics, NO memo. The memo exists for layered components
 * that pass IDENTICAL constant inputs every render; compiled arrays carry
 * runtime parts (`_szPart(row.style)`) that vary per element, so routing them
 * through the shared 500-entry LRU would never hit AND would evict the hot
 * layered-component entries — a list render could flush the memo several
 * times over per frame. Skipping the memo keeps each call at the plain
 * uncached cost and leaves the authored-`szcn` fast path untouched.
 *
 * The `_` prefix marks it as generated-code-only (like `_sz`/`_szMerge`/
 * `_szPart`) — hand-author `szcn` instead.
 *
 * @param inputs - Class strings; falsy inputs (`false`/`null`/`undefined`/`''`) are skipped.
 * @returns The merged className string.
 */
export function _szcn(...inputs: (string | false | null | undefined)[]): string {
    return mergeUncached(inputs);
}

/**
 * The uncached merge — see {@link szcn} for the contract.
 *
 * @param inputs - Class strings; falsy inputs are skipped.
 * @returns The merged className string.
 */
function mergeUncached(inputs: readonly (string | false | null | undefined)[]): string {
    const order: string[] = [];
    const byKey = new Map<string, string>();

    for (const input of inputs) {
        if (!input || typeof input !== 'string') {
            continue;
        }
        for (const token of input.split(/\s+/)) {
            if (token) mergeClassToken(token, order, byKey);
        }
    }

    return order.map(key => byKey.get(key) as string).join(' ');
}

/**
 * Merge one class token into the ordered survivor map.
 * @param token - Encoded class token.
 * @param order - Ordered survivor keys.
 * @param byKey - Survivor token lookup.
 */
function mergeClassToken(token: string, order: string[], byKey: Map<string, string>): void {
    const original = decodeToken(token);
    const info = mergeClassify(original);
    const key = info ? info.key : original;
    for (const covered of info ? info.covers : [key]) {
        if (!byKey.delete(covered)) continue;
        const index = order.indexOf(covered);
        if (index !== -1) order.splice(index, 1);
    }
    byKey.set(key, token);
    order.push(key);
}
