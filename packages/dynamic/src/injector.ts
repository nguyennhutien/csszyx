/**
 * CSSOM Injection with 21-tier CSSStyleSheet architecture.
 *
 * WHY 21 SHEETS:
 * Injecting all rules into a single sheet breaks cascade order.
 * If a linter sorts object keys alphabetically (lg, md, sm),
 * sm:p-4 could end up injected AFTER lg:p-8 — at 640px both @media
 * rules match and the later-injected sm rule incorrectly wins.
 *
 * Fix: One CSSStyleSheet per breakpoint tier. The `adoptedStyleSheets`
 * array ORDER determines cascade — not insertion time. Sheets are created
 * once in the correct ascending order and never reordered.
 *
 * CSS @layer collision note:
 * Tailwind v4 utilities are in `@layer utilities`. Rules injected via
 * CSSStyleSheet.insertRule() are unlayered — unlayered beats ALL layered
 * styles at equal specificity (CSS Cascade Level 5). This is intentional:
 * - Classes in manifest → delta check skips injection → no conflict
 * - Truly new classes → not in built CSS → no conflict
 * - Stale manifest → injected rule overrides built rule (same CSS value)
 */

import { BREAKPOINTS, type Tier } from './css-generator.js';

// ── Tier ordering ─────────────────────────────────────────────────────────────

/**
 * 21 tiers in cascade order (index = priority, higher = wins).
 *
 * max-* tiers are DESCENDING by breakpoint size (opposite of min-*).
 * At a small viewport (e.g. 400px), ALL max-* variants match.
 * The most restrictive (max-sm = ≤640px) must win → must appear LAST.
 * Example at 400px: max-2xl, max-xl, max-lg, max-md, max-sm all match.
 * max-sm should win → index(max-sm) > index(max-md) > ... > index(max-2xl).
 */
export const TIER_ORDER: readonly Tier[] = [
    'base',
    // viewport min-width (ascending — sm wins over base, lg wins over md)
    'sm',
    'md',
    'lg',
    'xl',
    '2xl',
    // viewport max-width (descending size — max-sm is most restrictive, must win)
    'max-2xl',
    'max-xl',
    'max-lg',
    'max-md',
    'max-sm',
    // container query min (ascending)
    '@sm',
    '@md',
    '@lg',
    '@xl',
    '@2xl',
    // container query max (descending)
    '@max-2xl',
    '@max-xl',
    '@max-lg',
    '@max-md',
    '@max-sm',
] as const;

const TIER_SET = new Set<string>(TIER_ORDER);

/**
 * Returns true if constructable stylesheets are available in the current environment.
 *
 * @returns true when CSSStyleSheet and adoptedStyleSheets are both supported
 */
function supportsConstructableSheets(): boolean {
    return (
        typeof document !== 'undefined' &&
        typeof CSSStyleSheet !== 'undefined' &&
        'adoptedStyleSheets' in document
    );
}

// ── Module state ──────────────────────────────────────────────────────────────

let sheets: Map<Tier, CSSStyleSheet> | null = null;

/** StyleElement fallback for environments without constructable stylesheets. */
let fallbackStyle: HTMLStyleElement | null = null;

/** Set of all class names injected this session (prevents double inject). */
const injected = new Set<string>();

/**
 * Dev-only growth nudge. Injected rules are never removed within a session, so
 * an app feeding continuously varying values (`w-[${x}px]` per animation frame
 * or drag tick) grows the CSSOM without bound — style recalc slows down and
 * memory climbs, with no error anywhere. Crossing this many UNIQUE classes in
 * one session almost always means unbounded dynamic values; warn once so the
 * developer moves the varying value into a CSS variable instead.
 */
const INJECTED_GROWTH_WARN_THRESHOLD = 5000;
let warnedInjectedGrowth = false;

// ── Sheet initialisation ──────────────────────────────────────────────────────

/**
 * Wraps a CSS rule in the appropriate @media or @container query for non-base tiers.
 * Base sheet holds all rules directly (no wrapper).
 *
 * @param cssRule - raw CSS rule string to wrap (e.g. ".p-4 { padding: 1rem }")
 * @param tier - breakpoint tier that determines the wrapping query type
 * @returns wrapped CSS string (e.g. "@media (min-width: 40rem) { .p-4 { padding: 1rem } }")
 */
function wrapForTier(cssRule: string, tier: Tier): string {
    if (tier === 'base') {
        return cssRule;
    }

    // Container query tiers: @sm, @md, @lg, @xl, @2xl, @max-*
    if (tier.startsWith('@')) {
        const bp = tier.slice(1); // '@sm' → 'sm', '@max-sm' → 'max-sm'
        const bpValue = BREAKPOINTS[bp];
        if (!bpValue) {
            return cssRule;
        }
        const query = bp.startsWith('max-') ? `(width <= ${bpValue})` : `(width >= ${bpValue})`;
        return `@container ${query} { ${cssRule} }`;
    }

    // Viewport tiers: sm, md, lg, xl, 2xl, max-sm, max-md, ...
    const bpValue = BREAKPOINTS[tier];
    if (!bpValue) {
        return cssRule;
    }

    const query = tier.startsWith('max-') ? `(max-width: ${bpValue})` : `(min-width: ${bpValue})`;
    return `@media ${query} { ${cssRule} }`;
}

/**
 * Initialises one CSSStyleSheet per tier and appends them to adoptedStyleSheets in cascade order.
 *
 * @returns map from each Tier to its dedicated CSSStyleSheet
 */
function initSheets(): Map<Tier, CSSStyleSheet> {
    const map = new Map<Tier, CSSStyleSheet>();
    const adopted: CSSStyleSheet[] = [];

    for (const tier of TIER_ORDER) {
        const sheet = new CSSStyleSheet();
        map.set(tier, sheet);
        adopted.push(sheet);
    }

    // Append to end — does NOT replace existing adoptedStyleSheets.
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, ...adopted];
    return map;
}

/**
 * Creates and appends a fallback <style> element for environments without constructable stylesheets.
 *
 * @returns the newly created and appended HTMLStyleElement
 */
function initFallbackStyle(): HTMLStyleElement {
    const el = document.createElement('style');
    el.id = '__csszyx_dynamic__';
    document.head.appendChild(el);
    return el;
}

// ── Tier resolution ───────────────────────────────────────────────────────────

/**
 * Resolves which tier a class name belongs to based on its first variant segment.
 * Stacked variants: sm:hover:bg-blue → first segment = 'sm' → tier = sm.
 * dark:sm:bg-blue is invalid (dark is not a breakpoint) → tier = base.
 *
 * @param className - full Tailwind class name (e.g. "sm:hover:bg-blue-500")
 * @returns the breakpoint tier for this class, or 'base' if no breakpoint prefix is found
 */
export function resolveTier(className: string): Tier {
    const colonIdx = className.indexOf(':');
    if (colonIdx === -1) {
        return 'base';
    }

    const prefix = className.slice(0, colonIdx);

    if (TIER_SET.has(prefix)) {
        return prefix as Tier;
    }
    return 'base';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Injects a CSS rule if the class has not already been injected this session.
 * No-op if the class is already known (delta check must be done by caller via manifest).
 *
 * @param className - original Tailwind class name (used as cache key)
 * @param cssRule   - CSS rule string returned by generateCSSRule()
 * @param tier      - which tier sheet to inject into
 */
export function injectRule(className: string, cssRule: string, tier: Tier = 'base'): void {
    if (injected.has(className)) {
        return;
    }
    injected.add(className);

    if (
        process.env.NODE_ENV !== 'production' &&
        !warnedInjectedGrowth &&
        injected.size >= INJECTED_GROWTH_WARN_THRESHOLD
    ) {
        warnedInjectedGrowth = true;
        console.warn(
            `[csszyx] dynamic() has injected ${INJECTED_GROWTH_WARN_THRESHOLD}+ unique classes this session. ` +
                'Injected CSS rules are never removed, so continuously varying values ' +
                '(e.g. w-[`${x}px`] per animation frame) grow the CSSOM and slow style recalc. ' +
                'Drive continuously changing values through a CSS variable instead.',
        );
    }

    if (!cssRule) {
        return;
    } // unknown class — still mark as "seen" to avoid repeat lookups

    if (supportsConstructableSheets()) {
        if (!sheets) {
            sheets = initSheets();
        }
        const resolved = sheets.get(tier) ?? sheets.get('base');
        if (!resolved) {
            return;
        }
        const sheet = resolved;
        const rule = wrapForTier(cssRule, tier);
        try {
            sheet.insertRule(rule, sheet.cssRules.length);
        } catch {
            // Malformed rule — silently ignore; class is still marked injected.
        }
    } else {
        // Fallback: append to a <style> element
        if (!fallbackStyle) {
            fallbackStyle = initFallbackStyle();
        }
        const rule = wrapForTier(cssRule, tier);
        fallbackStyle.sheet?.insertRule(rule, fallbackStyle.sheet.cssRules.length);
    }
}

/**
 * Checks whether a class name has already been injected this session.
 * Used to skip repeated calls for the same class within a render cycle.
 *
 * @param className - original Tailwind class name to check (e.g. "p-4")
 * @returns true if the class has already been injected in the current session
 */
export function isInjected(className: string): boolean {
    return injected.has(className);
}

/**
 * Releases all tier sheets and clears injected state.
 * Call on route unmount / component cleanup.
 */
export function cleanup(): void {
    if (sheets) {
        const tierSheets = new Set(sheets.values());
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => !tierSheets.has(s));
        sheets = null;
    }

    if (fallbackStyle) {
        fallbackStyle.remove();
        fallbackStyle = null;
    }

    injected.clear();
    warnedInjectedGrowth = false;
}
