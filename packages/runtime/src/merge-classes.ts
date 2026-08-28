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
 * csszyx owns the reverse mangle map, registered at runtime by the bundled
 * module (`getMangleRegistry().decode(mangled) → original`). So this merge decodes each token
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
import { getMangleRegistry } from './mangle-registry.js';
import { classifyAmbiguousValue, getSzcnGroupsGeneration } from './merge-groups.js';
import { BOX_ROLE_PREFIXES_BY_FIRST_SEGMENT, normalizeBase, stripVariant } from './split-box.js';

/** Class string accepted by the public and generated merge helpers. */
type ClassInput = string | false | null | undefined;

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
    'shadow', // shadow-lg (size) vs shadow-red-500 (shadow colour)
    'drop-shadow', // drop-shadow-lg (size) vs drop-shadow-red-500 (colour)
    'inset-shadow', // inset-shadow-sm (size) vs inset-shadow-red-500 (colour)
    'decoration', // decoration-2 (thickness) vs -solid (style) vs -red-500 (colour)
    'stroke', // stroke-2 (width) vs stroke-red-500 (paint)
    'from', // from-10% (stop position) vs from-red-500 (stop colour)
    'via', // via-40% (stop position) vs via-red-500 (stop colour)
    'to', // to-90% (stop position) vs to-red-500 (stop colour)
]);

/**
 * Resolve a token to its original (un-mangled) name using the runtime reverse
 * mangle map when present. No map (dev / unmangled build) → token is already
 * original.
 *
 * @param token - A class token, possibly mangled.
 * @returns The original class name.
 */
/** The runtime mangle bridge: the registry, or the legacy inline-script object. */
interface MangleBridge {
    decode?: (c: string) => string | undefined;
    mangleMap?: Readonly<Record<string, string>>;
}

/**
 * Read the installed runtime bridge ONCE per merge. `_szcn` runs unmemoized
 * per element in list renders, so per-token global reads are the hot cost
 * here — every token needs both the decode bridge (conflict classification)
 * and the encode map (output form), and one read serves both.
 *
 * The registry the bundled module installs comes first; `globalThis.__csszyx`
 * is the object the deprecated inline HTML installer assigns and stays
 * readable for one migration window.
 *
 * @returns The installed bridge object, or undefined.
 */
function mangleBridge(): MangleBridge | undefined {
    return getMangleRegistry() ?? (globalThis as { __csszyx?: MangleBridge }).__csszyx;
}

/**
 * Resolve a token to its original (un-mangled) name using the runtime reverse
 * mangle map when present. No map (dev / unmangled build) → token is already
 * original.
 *
 * @param token - A class token, possibly mangled.
 * @param bridge - The runtime bridge read once by the caller.
 * @returns The original class name.
 */
function decodeToken(token: string, bridge: MangleBridge | undefined): string {
    const decode = bridge?.decode;
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
 * Encode one token through the runtime mangle map when present.
 *
 * A string that is a map KEY is always an original class name — the build
 * reserves every census name from the token allocator, so a mangled token can
 * never collide with a key — which makes this a single unambiguous, idempotent
 * lookup: originals of mangled classes encode to their token; already-mangled
 * tokens, authored classes, and external names pass through unchanged.
 *
 * This is what heals a class RESOLVED AT RUNTIME as a plain string (a
 * component mapping a prop to a class name and merging it at its leaf): the
 * CSS ships mangled, so the string must reach the DOM mangled too.
 *
 * The `typeof` guard is not decorative: a plain-object map inherits
 * `Object.prototype`, so a hostile or unlucky token (`constructor`,
 * `hasOwnProperty`) resolves to a function up the prototype chain and must
 * pass through as itself, never be stringified into the output.
 *
 * @param token - A class token, possibly an original censused name.
 * @param bridge - The runtime bridge read once by the caller.
 * @returns The mangled token when the map covers it, otherwise the token.
 */
function encodeToken(token: string, bridge: MangleBridge | undefined): string {
    const map = bridge?.mangleMap;
    if (!map) {
        return token;
    }
    // Same fail-safe stance as decodeToken: an exotic host object must never
    // break the merge.
    try {
        const encoded = map[token];
        return typeof encoded === 'string' ? encoded : token;
    } catch {
        return token;
    }
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
 * Deferred for v2: `border-<width>` is directional too, but the `border` prefix is
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
 * Mask utilities key by the `--tw-mask-*` custom property they write, not by
 * the `mask` prefix they share. Tailwind composites mask-image from three
 * layer variables, and inside the linear layer every side owns another, so
 * `mask-t-from-0%` and `mask-b-from-60%` are different declarations that must
 * BOTH survive — keying them together dropped one silently.
 */
const MASK_SIDES: ReadonlySet<string> = new Set(['t', 'r', 'b', 'l', 'x', 'y']);

/** Layers of `mask-image`; each owns its own variable and never conflicts. */
const MASK_LAYERS: ReadonlySet<string> = new Set(['linear', 'radial', 'conic']);

/** Radial extent keywords, which share `--tw-mask-radial-size`. */
const MASK_RADIAL_SIZES: ReadonlySet<string> = new Set([
    'closest-side',
    'closest-corner',
    'farthest-side',
    'farthest-corner',
]);

/** `x` and `y` write two sides each, so they cover those sides' keys. */
const MASK_SIDE_COVERAGE: Readonly<Record<string, readonly string[]>> = {
    x: ['x', 'l', 'r'],
    y: ['y', 't', 'b'],
};

/**
 * Classify a `mask-*` token by the custom property it writes.
 *
 * @param norm - Normalized token, `mask-` prefix included.
 * @param variant - Variant prefix removed from the token.
 * @returns `{ key, covers }`, or null to fall through to the shared tables.
 */
function classifyMaskToken(
    norm: string,
    variant: string,
): { key: string; covers: string[] } | null {
    if (norm === 'mask-circle' || norm === 'mask-ellipse') {
        const key = `${variant} mask-radial-shape`;
        return { key, covers: [key] };
    }
    const rest = norm.slice('mask-'.length);
    const [head, second] = rest.split('-', 2);

    if (MASK_SIDES.has(head) && (second === 'from' || second === 'to')) {
        const sides = MASK_SIDE_COVERAGE[head] ?? [head];
        return {
            key: `${variant} mask-${head}-${second}`,
            covers: sides.map(side => `${variant} mask-${side}-${second}`),
        };
    }
    if (!MASK_LAYERS.has(head)) return null;
    if (second === 'from' || second === 'to') {
        const key = `${variant} mask-${head}-${second}`;
        return { key, covers: [key] };
    }
    if (head === 'radial') {
        if (second === 'at') {
            const key = `${variant} mask-radial-position`;
            return { key, covers: [key] };
        }
        if (MASK_RADIAL_SIZES.has(rest.slice('radial-'.length))) {
            const key = `${variant} mask-radial-size`;
            return { key, covers: [key] };
        }
    }
    // Bare `mask-linear-45` / `mask-conic-90`: the layer's own gradient.
    const key = `${variant} mask-${head}`;
    return { key, covers: [key] };
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
    const firstSegment = norm.split('-', 1)[0] as string;
    if (firstSegment === 'mask' && norm.length > 'mask-'.length) {
        const masked = classifyMaskToken(norm, variant);
        if (masked !== null) return masked;
    }
    // A token that belongs to an ambiguous prefix AND classifies to a concrete
    // value group (e.g. `text-ellipsis`/`text-clip` → `text:overflow`, or a
    // data-type-hinted variable like `text-(color:--x)` → `text:color`) is a
    // single mutually-exclusive property, so it must last-wins even when it also
    // appears in the box-role map or contains `--` (the hinted-variable forms
    // do). Resolve that BEFORE the BEM `--` guard and the box-role under-merge
    // below, which would otherwise keep both. A BEM name under an ambiguous
    // prefix (`text-foo--active`) classifies to null and still falls through to
    // the guard. (Measured: only text-ellipsis and text-clip sit in both the
    // classifier and the box-role map; every other box-role token is null here.)
    if (AMBIGUOUS_PREFIXES.has(firstSegment)) {
        const value = norm === firstSegment ? '' : norm.slice(firstSegment.length + 1);
        const group = classifyAmbiguousValue(firstSegment, value);
        if (group !== null) {
            const key = `${variant} ${group}`;
            return { key, covers: [key] };
        }
    }
    // A BEM-style modifier (`tab-item-header--active`) is a DISTINCT class from its
    // base (`tab-item-header`), not a value-pair of the same utility — collapsing
    // them last-wins would drop the base (e.g. `tab-item-header` happens to start
    // with the real `tab` utility prefix). `--` never appears in a PLAIN Tailwind
    // utility class, so a token containing one — other than a leading CSS-variable
    // class or a classified hinted variable above — keys by itself and is never
    // merged away.
    if (base.indexOf('--') > 0) {
        return null;
    }
    // Exact value-keyed tokens (flex/block/italic/underline …) span several CSS
    // properties under one category, so under-merge to avoid dropping a sibling.
    if (BOX_ROLE_TOKENS.has(norm)) {
        return null;
    }
    const bucket = BOX_ROLE_PREFIXES_BY_FIRST_SEGMENT.get(firstSegment) ?? [];
    for (const [prefix] of bucket) {
        if (norm === prefix || norm.startsWith(`${prefix}-`)) {
            return classifyMatchedPrefix(norm, variant, prefix);
        }
    }
    return null;
}

/**
 * One memoized argument position. The memo is a TRIE over the input strings,
 * not a map keyed by their concatenation: building `${a} ${b}` produces a fresh
 * V8 cons-string on every call, and a cons-string carries no cached hash, so
 * each `Map` operation on it re-flattens and re-hashes the whole key —
 * measured at ~115 ns, an order of magnitude more than the merge lookup it was
 * meant to save. Walking one `Map.get` per argument instead hashes nothing: the
 * arguments are the caller's own string constants, already internalized with
 * their hash cached (measured ~7 ns for the two-argument layered-component
 * shape).
 */
interface MergeMemoNode {
    /** Merged output for the exact input path ending at this node. */
    result?: string;
    /** Children keyed by the next non-empty string input. */
    next?: Map<string, MergeMemoNode>;
}

/**
 * Memo for repeated merges. Layered components call szcn with IDENTICAL inputs
 * every render (component defaults are constants), so the trie turns the
 * per-render cost into one Map lookup per argument. The cache self-invalidates
 * when either classification input changes: the custom-group registration
 * generation, or the identity of the runtime decode bridge (both normally
 * settle at startup, before render loops, so steady-state renders never clear).
 *
 * Over the cap the trie STOPS ADMITTING new paths rather than evicting — the
 * same policy `splitBox`'s token memo uses. Per-entry LRU recency needs a
 * `delete` + `set` on every HIT (measured ~11% of the hit cost), and dropping
 * the whole trie at the cap flushed every hot entry each time a batch of
 * distinct inputs crossed it — `szcn(BASE, props.className)` in a list render
 * does exactly that. Admission-stop keeps the working set (the app's
 * component-count paths, captured early) hot at zero per-hit cost; overflow
 * traffic pays only its own uncached merge, which it paid under either policy.
 */
const MEMO_MAX_NODES = 500;
const memoRoot: MergeMemoNode = {};
let memoNodes = 0;
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
export function szcn(...inputs: ClassInput[]): string {
    const generation = getSzcnGroupsGeneration();
    // Compare the runtime OBJECT IDENTITY, not mere presence: a swapped bridge
    // (tests, or an exotic host replacing the inline script's object) must not
    // serve merges memoized under the previous map. The object carries both
    // the decode bridge and the encode map, so one identity check covers both
    // lookups. In production it is installed once for the page lifetime, so
    // this never clears.
    const runtimeRef = mangleBridge();
    if (generation !== memoGroupsGeneration || runtimeRef !== memoDecodeRef) {
        memoRoot.result = undefined;
        memoRoot.next = undefined;
        memoNodes = 0;
        memoGroupsGeneration = generation;
        memoDecodeRef = runtimeRef;
    }
    // Falsy inputs are skipped here exactly as `mergeUncached` skips them, so
    // `szcn('a', false, 'b')` and `szcn('a', 'b')` share one trie path.
    let node = memoRoot;
    for (const input of inputs) {
        if (!input || typeof input !== 'string') {
            continue;
        }
        let child = node.next?.get(input);
        if (child === undefined) {
            // Admission stop at the cap (see the memo note): the walk so far
            // stays byte-identical for cached paths, and a novel path past
            // the cap takes the uncached merge without disturbing the trie.
            if (memoNodes >= MEMO_MAX_NODES) {
                return mergeUncached(inputs, runtimeRef);
            }
            child = {};
            node.next ??= new Map();
            node.next.set(input, child);
            memoNodes++;
        }
        node = child;
    }
    let merged = node.result;
    if (merged === undefined) {
        merged = mergeUncached(inputs, runtimeRef);
        node.result = merged;
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
export function _szcn(...inputs: ClassInput[]): string {
    return mergeUncached(inputs, mangleBridge());
}

/**
 * The uncached merge — see {@link szcn} for the contract.
 *
 * @param inputs - Class strings; falsy inputs are skipped.
 * @param bridge - The runtime bridge, read once by the caller.
 * @returns The merged className string.
 */
function mergeUncached(inputs: readonly ClassInput[], bridge: MangleBridge | undefined): string {
    const order: string[] = [];
    const byKey = new Map<string, string>();

    for (const input of inputs) {
        if (!input || typeof input !== 'string') {
            continue;
        }
        for (const token of input.split(/\s+/)) {
            if (token) mergeClassToken(token, order, byKey, bridge);
        }
    }

    return order.map(key => byKey.get(key) as string).join(' ');
}

/**
 * Merge one class token into the ordered survivor map.
 * @param token - Encoded class token.
 * @param order - Ordered survivor keys.
 * @param byKey - Survivor token lookup.
 * @param bridge - The runtime bridge read once per merge.
 */
function mergeClassToken(
    token: string,
    order: string[],
    byKey: Map<string, string>,
    bridge: MangleBridge | undefined,
): void {
    const original = decodeToken(token, bridge);
    const info = mergeClassify(original);
    const key = info ? info.key : original;
    for (const covered of info ? info.covers : [key]) {
        if (!byKey.delete(covered)) continue;
        const index = order.indexOf(covered);
        if (index !== -1) order.splice(index, 1);
    }
    byKey.set(key, encodeToken(token, bridge));
    order.push(key);
}

/**
 * Resolve a class token to its original (un-mangled) name.
 *
 * For class introspection on production-mangled builds: code that inspects a
 * `className` for a utility by its original spelling (e.g. "does this element
 * carry a `w-*` width?") receives mangled tokens there, so decode each token
 * before matching. Identity on unmangled builds, in dev, and for any token the
 * map does not cover — safe to call unconditionally.
 *
 * @param token - A single class token, possibly mangled.
 * @returns The original class name, or the token itself when not mangled.
 * @example
 * className.split(/\s+/).some(t => szDecode(t).startsWith('w-'))
 */
export function szDecode(token: string): string {
    return decodeToken(token, mangleBridge());
}
