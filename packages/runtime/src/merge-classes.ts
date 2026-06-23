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
 * v1 scope: merges by the box-role-map utility prefix for single-property
 * prefixes (gap, p, m, w, h, rounded, …). Prefixes that span multiple CSS
 * properties (`flex` covers flex-grow AND flex-direction; `text` covers
 * font-size AND text-color; `bg` covers color AND position AND size) are treated
 * as AMBIGUOUS and under-merged. TODO(v2): full tailwind-merge-style conflict
 * groups would let these override precisely (flex-1 vs flex-none) while keeping
 * distinct properties (flex-1 vs flex-row).
 *
 * @module
 */
import { BOX_ROLE_PREFIXES, BOX_ROLE_TOKENS } from './box-role-map.generated.js';
import { normalizeBase, stripVariant } from './split-box.js';

/**
 * Utility prefixes that map to more than one CSS property, so merging by the
 * prefix would drop a class for a DIFFERENT property. Under-merge these.
 */
const AMBIGUOUS_PREFIXES: ReadonlySet<string> = new Set([
    'flex', // flex-1 (flex shorthand) vs flex-row (flex-direction)
    'text', // text-sm (font-size) vs text-red-500 (color)
    'bg', // bg-red-500 (color) vs bg-cover (size) vs bg-center (position)
    'border', // border-2 (width) vs border-red-500 (color) vs border-solid (style)
    'divide', // divide-x (width) vs divide-red-500 (color)
    'ring', // ring-2 (width) vs ring-red-500 (color)
    'outline', // outline-2 (width) vs outline-red-500 (color)
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
        return decode(token) ?? token;
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
    // Exact value-keyed tokens (flex/block/italic/underline …) span several CSS
    // properties under one category, so under-merge to avoid dropping a sibling.
    if (BOX_ROLE_TOKENS.has(norm)) {
        return null;
    }
    for (const [prefix] of BOX_ROLE_PREFIXES) {
        if (norm === prefix || norm.startsWith(`${prefix}-`)) {
            if (AMBIGUOUS_PREFIXES.has(prefix)) {
                return null;
            }
            // Key = variant + utility prefix. The space separator can't appear in
            // a class token, so distinct (variant, prefix) pairs never collide.
            const coveredPrefixes = SHORTHAND_COVERAGE[prefix] ?? [prefix];
            return {
                key: `${variant} ${prefix}`,
                covers: coveredPrefixes.map(p => `${variant} ${p}`),
            };
        }
    }
    return null;
}

/**
 * Merge className strings with last-wins override per utility, mangle-aware.
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
    const order: string[] = [];
    const byKey = new Map<string, string>();

    for (const input of inputs) {
        if (!input || typeof input !== 'string') {
            continue;
        }
        for (const token of input.split(/\s+/)) {
            if (!token) {
                continue;
            }
            const original = decodeToken(token);
            const info = mergeClassify(original);
            // An ungroupable token keys by itself (never merged away); a single
            // class has no space so it can't collide with a `variant prefix` key.
            const key = info ? info.key : original;
            // A later token removes the earlier survivors it covers — its own key
            // plus, for a spacing shorthand, the longhand keys it subsumes.
            for (const covered of info ? info.covers : [key]) {
                if (byKey.delete(covered)) {
                    const at = order.indexOf(covered);
                    if (at !== -1) {
                        order.splice(at, 1);
                    }
                }
            }
            byKey.set(key, token);
            order.push(key);
        }
    }

    return order.map(key => byKey.get(key) as string).join(' ');
}
