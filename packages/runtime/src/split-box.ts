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
    BOX_ROLE_PREFIXES,
    BOX_ROLE_TOKENS,
    type BoxRole,
} from './box-role-map.generated.js';

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

export interface SplitBoxOptions {
    /** Force these selectors onto the outer node, overriding the default map. */
    outer?: BoxSelector[];
    /** Force these selectors onto the inner node, overriding the default map. */
    inner?: BoxSelector[];
    /** Where an unrecognized token goes. Defaults to `'outer'`. */
    fallback?: BoxRole;
}

export interface SplitBoxResult {
    /** Classes for the outer (border-outward) element. */
    outer: string;
    /** Classes for the inner (border-inward) element. */
    inner: string;
}

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
 */
function stripVariant(token: string): string {
    let depth = 0;
    for (let i = token.length - 1; i >= 0; i--) {
        const ch = token[i];
        if (ch === ']' || ch === ')') depth++;
        else if (ch === '[' || ch === '(') depth--;
        else if (ch === ':' && depth === 0) return token.slice(i + 1);
    }
    return token;
}

/** Remove leading/trailing `!` (important) and a leading `-` (negative). */
function normalizeBase(base: string): string {
    let b = base;
    if (b.startsWith('!')) b = b.slice(1);
    if (b.endsWith('!')) b = b.slice(0, -1);
    if (b.startsWith('-')) b = b.slice(1);
    return b;
}

/** Classify a single class token, or `undefined` if csszyx does not own it. */
function inspect(token: string): TokenInfo | undefined {
    const base = normalizeBase(stripVariant(token));
    if (!base) return undefined;

    const exact = BOX_ROLE_TOKENS.get(base);
    if (exact) return { ...exact, base, value: base };

    for (const [prefix, entry] of BOX_ROLE_PREFIXES) {
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
 */
export function classify(token: string): Classification | undefined {
    const info = inspect(token);
    return info ? { role: info.role, category: info.category } : undefined;
}

/** Does `info` satisfy `selector`? `info === undefined` never matches. */
function matches(info: TokenInfo | undefined, selector: BoxSelector): boolean {
    if (!info) return false;
    if (typeof selector === 'object') {
        return Object.entries(selector).every(
            ([category, value]) =>
                info.category === category && info.value === value,
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

function anyMatch(
    info: TokenInfo | undefined,
    selectors: BoxSelector[],
): boolean {
    return selectors.some((s) => matches(info, s));
}

function tokenize(className: string): string[] {
    return className.split(/\s+/).filter(Boolean);
}

/**
 * Partition a className string into `{ outer, inner }` at the CSS box-model
 * border line. Every token lands in exactly one bucket (no loss, no duplication)
 * and keeps its variant prefix. Overrides in `options.inner` / `options.outer`
 * win over the default map; `inner` is checked first when a token matches both.
 *
 * @example splitBox('m-4 px-2 md:flex') // → { outer: 'm-4', inner: 'px-2 md:flex' }
 */
export function splitBox(
    className: string,
    options: SplitBoxOptions = {},
): SplitBoxResult {
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

/** Does any token in `classes` match `selector`? Variant- and mangle-robust. */
export function has(classes: string, selector: BoxSelector): boolean {
    return tokenize(classes).some((t) => matches(inspect(t), selector));
}

/** Keep only the tokens in `classes` that match `selector`. */
export function pick(classes: string, selector: BoxSelector): string {
    return tokenize(classes)
        .filter((t) => matches(inspect(t), selector))
        .join(' ');
}

/** Drop the tokens in `classes` that match `selector`, keeping the rest. */
export function omit(classes: string, selector: BoxSelector): string {
    return tokenize(classes)
        .filter((t) => !matches(inspect(t), selector))
        .join(' ');
}
