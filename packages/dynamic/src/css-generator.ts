/**
 * CSS Rule Generator for @csszyx/dynamic.
 *
 * Takes a Tailwind class name (e.g. "p-4", "hover:bg-blue-500", "sm:flex")
 * and generates the CSS rule string ready to inject into a CSSStyleSheet.
 *
 * Uses Tailwind v4 CSS custom property conventions:
 * - Spacing: calc(var(--spacing) * N)
 * - Colors:  var(--color-{name}-{shade})
 * - Text sizes: var(--text-{size})
 * - Border radii: var(--radius-{size})
 *
 * Returns empty string for unknown classes — graceful no-op, not a crash.
 */

import { isUtilityArbitrarySafe } from './css-sanitize.js';

/** Warn once (in dev) when an arbitrary value is dropped for being unsafe. */
let warnedUnsafeArbitrary = false;
/**
 * Warn once (in dev) that an arbitrary value was dropped for being unsafe.
 *
 * @param utility - the utility whose arbitrary value was dropped.
 */
function warnUnsafeArbitrary(utility: string): void {
    if (warnedUnsafeArbitrary) {
        return;
    }
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
        return;
    }
    warnedUnsafeArbitrary = true;
    console.warn(
        `[csszyx] dropped an arbitrary value that could inject CSS: "${utility}". ` +
            'Arbitrary values from untrusted data are not emitted at runtime.',
    );
}

// ── Variant metadata ──────────────────────────────────────────────────────────

/** Breakpoint tiers (min-width values, Tailwind v4 defaults). */
export const BREAKPOINTS: Record<string, string> = {
    sm: '40rem',
    md: '48rem',
    lg: '64rem',
    xl: '80rem',
    '2xl': '96rem',
    'max-sm': '40rem',
    'max-md': '48rem',
    'max-lg': '64rem',
    'max-xl': '80rem',
    'max-2xl': '96rem',
};

/** Pseudo-class suffixes for common state variants. */
const PSEUDO_CLASS_MAP: Record<string, string> = {
    hover: ':hover',
    focus: ':focus',
    'focus-visible': ':focus-visible',
    'focus-within': ':focus-within',
    active: ':active',
    visited: ':visited',
    disabled: ':disabled',
    checked: ':checked',
    required: ':required',
    optional: ':optional',
    valid: ':valid',
    invalid: ':invalid',
    placeholder: '::placeholder',
    before: '::before',
    after: '::after',
    first: ':first-child',
    last: ':last-child',
    odd: ':nth-child(odd)',
    even: ':nth-child(even)',
    empty: ':empty',
    open: '[open]',
};

// ── Spacing utilities ─────────────────────────────────────────────────────────

/**
 * Maps Tailwind spacing utility prefix → CSS logical/physical properties (Tailwind v4).
 * Tailwind v4 uses logical properties (padding-inline, margin-block, etc.).
 */
const SPACING_PROPS: Record<string, string[]> = {
    // Padding
    p: ['padding'],
    pt: ['padding-top'],
    pr: ['padding-right'],
    pb: ['padding-bottom'],
    pl: ['padding-left'],
    px: ['padding-inline'],
    py: ['padding-block'],
    ps: ['padding-inline-start'],
    pe: ['padding-inline-end'],
    pbs: ['padding-block-start'],
    pbe: ['padding-block-end'],
    // Margin
    m: ['margin'],
    mt: ['margin-top'],
    mr: ['margin-right'],
    mb: ['margin-bottom'],
    ml: ['margin-left'],
    mx: ['margin-inline'],
    my: ['margin-block'],
    ms: ['margin-inline-start'],
    me: ['margin-inline-end'],
    mbs: ['margin-block-start'],
    mbe: ['margin-block-end'],
    // Gap
    gap: ['gap'],
    'gap-x': ['column-gap'],
    'gap-y': ['row-gap'],
    // Sizing
    w: ['width'],
    h: ['height'],
    'min-w': ['min-width'],
    'max-w': ['max-width'],
    'min-h': ['min-height'],
    'max-h': ['max-height'],
    size: ['width', 'height'],
    // Position
    top: ['top'],
    right: ['right'],
    bottom: ['bottom'],
    left: ['left'],
    inset: ['inset'],
    'inset-x': ['inset-inline'],
    'inset-y': ['inset-block'],
    'inset-s': ['inset-inline-start'],
    'inset-e': ['inset-inline-end'],
    // Flex
    basis: ['flex-basis'],
    // Typography
    indent: ['text-indent'],
    'outline-offset': ['outline-offset'],
    'underline-offset': ['text-underline-offset'],
    // Scroll
    'scroll-m': ['scroll-margin'],
    'scroll-mt': ['scroll-margin-top'],
    'scroll-mr': ['scroll-margin-right'],
    'scroll-mb': ['scroll-margin-bottom'],
    'scroll-ml': ['scroll-margin-left'],
    'scroll-mx': ['scroll-margin-inline'],
    'scroll-my': ['scroll-margin-block'],
    'scroll-ms': ['scroll-margin-inline-start'],
    'scroll-me': ['scroll-margin-inline-end'],
    'scroll-p': ['scroll-padding'],
    'scroll-pt': ['scroll-padding-top'],
    'scroll-pr': ['scroll-padding-right'],
    'scroll-pb': ['scroll-padding-bottom'],
    'scroll-pl': ['scroll-padding-left'],
    'scroll-px': ['scroll-padding-inline'],
    'scroll-py': ['scroll-padding-block'],
    'scroll-ps': ['scroll-padding-inline-start'],
    'scroll-pe': ['scroll-padding-inline-end'],
    // Border spacing (CSS custom properties in Tailwind v4)
    'border-spacing-x': ['--tw-border-spacing-x'],
    'border-spacing-y': ['--tw-border-spacing-y'],
    // Ring offset (CSS custom property)
    'ring-offset': ['--tw-ring-offset-width'],
};

/** CSS keyword values for size properties (non-numeric). */
const SIZE_KEYWORDS: Record<string, string> = {
    auto: 'auto',
    full: '100%',
    screen: '100vw', // width context; height context uses 100vh — see below
    svw: '100svw',
    dvw: '100dvw',
    lvw: '100lvw',
    svh: '100svh',
    dvh: '100dvh',
    lvh: '100lvh',
    fit: 'fit-content',
    min: 'min-content',
    max: 'max-content',
    none: 'none',
    px: '1px',
    '0': '0',
    xs: 'var(--container-xs)',
    sm: 'var(--container-sm)',
    md: 'var(--container-md)',
    lg: 'var(--container-lg)',
    xl: 'var(--container-xl)',
    '2xl': 'var(--container-2xl)',
    '3xl': 'var(--container-3xl)',
    '4xl': 'var(--container-4xl)',
    '5xl': 'var(--container-5xl)',
    '6xl': 'var(--container-6xl)',
    '7xl': 'var(--container-7xl)',
    prose: 'var(--container-prose)',
};

/**
 * Resolves a Tailwind spacing/size value to a CSS value string.
 * Handles: 0, px, auto, full, numeric, fraction, arbitrary.
 *
 * @param v - Tailwind spacing value token (e.g. "4", "px", "auto", "[13px]")
 * @param prop - CSS property name, used to disambiguate "screen" (100vh vs 100vw)
 * @returns CSS value string (e.g. "calc(var(--spacing) * 4)", "1px", "auto")
 */
function resolveSpacingValue(v: string, prop?: string): string {
    if (v === '0') {
        return '0';
    }
    if (v === 'px') {
        return '1px';
    }

    // Height screen → 100vh, width screen → 100vw
    if (v === 'screen') {
        if (prop && (prop === 'height' || prop === 'min-height' || prop === 'max-height')) {
            return '100vh';
        }
        return '100vw';
    }

    if (v in SIZE_KEYWORDS) {
        return SIZE_KEYWORDS[v];
    }

    // Arbitrary value: [13px], [calc(100%-2rem)], etc.
    if (v.startsWith('[') && v.endsWith(']')) {
        return v.slice(1, -1).replace(/_/g, ' ');
    }

    // CSS variable shorthand: (--my-var) → var(--my-var)
    if (v.startsWith('(') && v.endsWith(')') && v.includes('--')) {
        return `var(${v.slice(1, -1)})`;
    }

    // Fraction: 1/2 → 50%
    if (v.includes('/')) {
        const slash = v.indexOf('/');
        const num = parseFloat(v.slice(0, slash));
        const den = parseFloat(v.slice(slash + 1));
        if (!Number.isNaN(num) && !Number.isNaN(den) && den !== 0) {
            const pct = (num / den) * 100;
            return `${parseFloat(pct.toFixed(6))}%`;
        }
    }

    // Negative numeric: -4 → calc(var(--spacing) * -4)
    if (v.startsWith('-') && !Number.isNaN(parseFloat(v.slice(1)))) {
        return `calc(var(--spacing) * ${v})`;
    }

    // Numeric: 4 → calc(var(--spacing) * 4)
    if (!Number.isNaN(parseFloat(v))) {
        return `calc(var(--spacing) * ${v})`;
    }

    return v;
}

// ── Color utilities ───────────────────────────────────────────────────────────

/** Maps Tailwind color utility prefix → CSS property. */
const COLOR_PROPS: Record<string, string> = {
    bg: 'background-color',
    text: 'color',
    border: 'border-color',
    'border-t': 'border-top-color',
    'border-r': 'border-right-color',
    'border-b': 'border-bottom-color',
    'border-l': 'border-left-color',
    'border-x': 'border-inline-color',
    'border-y': 'border-block-color',
    'border-s': 'border-inline-start-color',
    'border-e': 'border-inline-end-color',
    divide: 'border-color',
    outline: 'outline-color',
    fill: 'fill',
    stroke: 'stroke',
    from: '--tw-gradient-from',
    via: '--tw-gradient-via',
    to: '--tw-gradient-to',
    decoration: 'text-decoration-color',
    accent: 'accent-color',
    caret: 'caret-color',
    shadow: '--tw-shadow-color',
    'inset-shadow': '--tw-inset-shadow-color',
    ring: '--tw-ring-color',
    'ring-offset': '--tw-ring-offset-color',
    'drop-shadow': '--tw-drop-shadow-color',
};

/** Colors that don't use CSS custom properties in Tailwind v4. */
const DIRECT_COLOR_KEYWORDS = new Set([
    'white',
    'black',
    'transparent',
    'inherit',
    'current',
    'currentColor',
]);

/**
 * Resolves a Tailwind color value to a CSS value string.
 * Handles: named scales (blue-500), keywords, arbitrary, opacity modifiers.
 *
 * @param v - Tailwind color value token (e.g. "blue-500", "white", "[#ff6b35]", "blue-500/50")
 * @returns CSS value string (e.g. "var(--color-blue-500)", "white", "color-mix(...)")
 */
function resolveColorValue(v: string): string {
    if (DIRECT_COLOR_KEYWORDS.has(v)) {
        if (v === 'current') {
            return 'currentColor';
        }
        return v;
    }

    // Arbitrary: [#ff6b35], [color:var(--my)]
    if (v.startsWith('[') && v.endsWith(']')) {
        const inner = v.slice(1, -1).replace(/_/g, ' ');
        if (inner.startsWith('color:')) {
            return inner.slice(6);
        }
        return inner;
    }

    // CSS variable shorthand: (--my-color) → var(--my-color)
    if (v.startsWith('(') && v.endsWith(')') && v.includes('--')) {
        return `var(${v.slice(1, -1)})`;
    }

    // Opacity modifier: blue-500/50 → color-mix(...)
    const slashIdx = v.lastIndexOf('/');
    if (slashIdx > 0) {
        const colorPart = v.slice(0, slashIdx);
        const opacity = v.slice(slashIdx + 1);
        const colorVar = DIRECT_COLOR_KEYWORDS.has(colorPart)
            ? colorPart
            : `var(--color-${colorPart})`;
        const opacityPct = v.includes('.') ? `${parseFloat(opacity) * 100}%` : `${opacity}%`;
        return `color-mix(in srgb, ${colorVar} ${opacityPct}, transparent)`;
    }

    return `var(--color-${v})`;
}

// ── Text size utilities ───────────────────────────────────────────────────────

/** Named Tailwind v4 text sizes → CSS var. */
const TEXT_SIZES = new Set([
    'xs',
    'sm',
    'base',
    'lg',
    'xl',
    '2xl',
    '3xl',
    '4xl',
    '5xl',
    '6xl',
    '7xl',
    '8xl',
    '9xl',
]);

// ── Keyword class lookup ──────────────────────────────────────────────────────

/**
 * Static keyword classes with known CSS output.
 * Only covers classes commonly needed at runtime (form renderers, layout).
 * Build-time classes are always in the manifest → never reach the generator.
 */
const KEYWORD_RULES: Record<string, string> = {
    // Display
    flex: 'display: flex',
    'inline-flex': 'display: inline-flex',
    block: 'display: block',
    'inline-block': 'display: inline-block',
    inline: 'display: inline',
    grid: 'display: grid',
    'inline-grid': 'display: inline-grid',
    hidden: 'display: none',
    contents: 'display: contents',
    'flow-root': 'display: flow-root',
    table: 'display: table',
    'table-row': 'display: table-row',
    'table-cell': 'display: table-cell',
    'list-item': 'display: list-item',
    // Position
    static: 'position: static',
    fixed: 'position: fixed',
    absolute: 'position: absolute',
    relative: 'position: relative',
    sticky: 'position: sticky',
    // Visibility
    visible: 'visibility: visible',
    invisible: 'visibility: hidden',
    collapse: 'visibility: collapse',
    // Overflow
    'overflow-auto': 'overflow: auto',
    'overflow-hidden': 'overflow: hidden',
    'overflow-visible': 'overflow: visible',
    'overflow-scroll': 'overflow: scroll',
    'overflow-clip': 'overflow: clip',
    'overflow-x-auto': 'overflow-x: auto',
    'overflow-x-hidden': 'overflow-x: hidden',
    'overflow-y-auto': 'overflow-y: auto',
    'overflow-y-hidden': 'overflow-y: hidden',
    'overflow-y-scroll': 'overflow-y: scroll',
    'overflow-x-scroll': 'overflow-x: scroll',
    // Flex direction
    'flex-row': 'flex-direction: row',
    'flex-col': 'flex-direction: column',
    'flex-row-reverse': 'flex-direction: row-reverse',
    'flex-col-reverse': 'flex-direction: column-reverse',
    // Flex wrap
    'flex-wrap': 'flex-wrap: wrap',
    'flex-nowrap': 'flex-wrap: nowrap',
    'flex-wrap-reverse': 'flex-wrap: wrap-reverse',
    // Flex sizing
    'flex-1': 'flex: 1 1 0%',
    'flex-auto': 'flex: 1 1 auto',
    'flex-none': 'flex: none',
    // Align
    'items-start': 'align-items: flex-start',
    'items-center': 'align-items: center',
    'items-end': 'align-items: flex-end',
    'items-stretch': 'align-items: stretch',
    'items-baseline': 'align-items: baseline',
    'self-start': 'align-self: flex-start',
    'self-center': 'align-self: center',
    'self-end': 'align-self: flex-end',
    'self-stretch': 'align-self: stretch',
    'self-auto': 'align-self: auto',
    // Justify
    'justify-start': 'justify-content: flex-start',
    'justify-center': 'justify-content: center',
    'justify-end': 'justify-content: flex-end',
    'justify-between': 'justify-content: space-between',
    'justify-around': 'justify-content: space-around',
    'justify-evenly': 'justify-content: space-evenly',
    'justify-stretch': 'justify-content: stretch',
    'justify-items-start': 'justify-items: start',
    'justify-items-center': 'justify-items: center',
    'justify-items-end': 'justify-items: end',
    'justify-items-stretch': 'justify-items: stretch',
    // Place
    'place-content-center': 'place-content: center',
    'place-content-start': 'place-content: start',
    'place-content-end': 'place-content: end',
    'place-content-between': 'place-content: space-between',
    'place-content-around': 'place-content: space-around',
    'place-content-evenly': 'place-content: space-evenly',
    'place-items-center': 'place-items: center',
    'place-items-start': 'place-items: start',
    'place-items-end': 'place-items: end',
    'place-items-stretch': 'place-items: stretch',
    // Width / Height special
    'w-auto': 'width: auto',
    'w-full': 'width: 100%',
    'w-screen': 'width: 100vw',
    'w-svw': 'width: 100svw',
    'w-dvw': 'width: 100dvw',
    'w-min': 'width: min-content',
    'w-max': 'width: max-content',
    'w-fit': 'width: fit-content',
    'h-auto': 'height: auto',
    'h-full': 'height: 100%',
    'h-screen': 'height: 100vh',
    'h-svh': 'height: 100svh',
    'h-dvh': 'height: 100dvh',
    'h-min': 'height: min-content',
    'h-max': 'height: max-content',
    'h-fit': 'height: fit-content',
    'min-h-0': 'min-height: 0',
    'min-h-full': 'min-height: 100%',
    'min-h-screen': 'min-height: 100vh',
    'max-h-full': 'max-height: 100%',
    'max-h-screen': 'max-height: 100vh',
    'max-h-none': 'max-height: none',
    'min-w-0': 'min-width: 0',
    'min-w-full': 'min-width: 100%',
    'max-w-full': 'max-width: 100%',
    'max-w-none': 'max-width: none',
    'max-w-screen': 'max-width: 100vw',
    // Font weight keywords
    'font-thin': 'font-weight: 100',
    'font-extralight': 'font-weight: 200',
    'font-light': 'font-weight: 300',
    'font-normal': 'font-weight: 400',
    'font-medium': 'font-weight: 500',
    'font-semibold': 'font-weight: 600',
    'font-bold': 'font-weight: 700',
    'font-extrabold': 'font-weight: 800',
    'font-black': 'font-weight: 900',
    // Font style
    italic: 'font-style: italic',
    'not-italic': 'font-style: normal',
    // Text align
    'text-left': 'text-align: left',
    'text-center': 'text-align: center',
    'text-right': 'text-align: right',
    'text-justify': 'text-align: justify',
    'text-start': 'text-align: start',
    'text-end': 'text-align: end',
    // Text transform
    uppercase: 'text-transform: uppercase',
    lowercase: 'text-transform: lowercase',
    capitalize: 'text-transform: capitalize',
    'normal-case': 'text-transform: none',
    // Text decoration
    underline: 'text-decoration-line: underline',
    overline: 'text-decoration-line: overline',
    'line-through': 'text-decoration-line: line-through',
    'no-underline': 'text-decoration-line: none',
    // Text wrap
    'text-wrap': 'text-wrap: wrap',
    'text-nowrap': 'text-wrap: nowrap',
    'text-balance': 'text-wrap: balance',
    'text-pretty': 'text-wrap: pretty',
    // Whitespace
    'whitespace-normal': 'white-space: normal',
    'whitespace-nowrap': 'white-space: nowrap',
    'whitespace-pre': 'white-space: pre',
    'whitespace-pre-line': 'white-space: pre-line',
    'whitespace-pre-wrap': 'white-space: pre-wrap',
    'whitespace-break-spaces': 'white-space: break-spaces',
    // Border style
    'border-solid': 'border-style: solid',
    'border-dashed': 'border-style: dashed',
    'border-dotted': 'border-style: dotted',
    'border-double': 'border-style: double',
    'border-none': 'border-style: none',
    // Rounded special values
    'rounded-none': 'border-radius: 0',
    'rounded-full': 'border-radius: calc(infinity * 1px)',
    // Cursor
    'cursor-auto': 'cursor: auto',
    'cursor-default': 'cursor: default',
    'cursor-pointer': 'cursor: pointer',
    'cursor-wait': 'cursor: wait',
    'cursor-text': 'cursor: text',
    'cursor-move': 'cursor: move',
    'cursor-not-allowed': 'cursor: not-allowed',
    'cursor-crosshair': 'cursor: crosshair',
    'cursor-grab': 'cursor: grab',
    'cursor-grabbing': 'cursor: grabbing',
    // Pointer events
    'pointer-events-none': 'pointer-events: none',
    'pointer-events-auto': 'pointer-events: auto',
    // User select
    'select-none': 'user-select: none',
    'select-text': 'user-select: text',
    'select-all': 'user-select: all',
    'select-auto': 'user-select: auto',
    // Object fit
    'object-contain': 'object-fit: contain',
    'object-cover': 'object-fit: cover',
    'object-fill': 'object-fit: fill',
    'object-none': 'object-fit: none',
    'object-scale-down': 'object-fit: scale-down',
    // Truncate
    truncate: 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap',
    'text-ellipsis': 'text-overflow: ellipsis',
    'text-clip': 'text-overflow: clip',
    // Grow / shrink
    grow: 'flex-grow: 1',
    'grow-0': 'flex-grow: 0',
    shrink: 'flex-shrink: 1',
    'shrink-0': 'flex-shrink: 0',
    // Appearance
    'appearance-none': 'appearance: none',
    'appearance-auto': 'appearance: auto',
    // Isolate
    isolate: 'isolation: isolate',
    'isolation-auto': 'isolation: auto',
    // List style
    'list-none': 'list-style-type: none',
    'list-disc': 'list-style-type: disc',
    'list-decimal': 'list-style-type: decimal',
    // Box sizing
    'box-border': 'box-sizing: border-box',
    'box-content': 'box-sizing: content-box',
    // Float
    'float-left': 'float: left',
    'float-right': 'float: right',
    'float-none': 'float: none',
    'float-start': 'float: inline-start',
    'float-end': 'float: inline-end',
    'clear-left': 'clear: left',
    'clear-right': 'clear: right',
    'clear-both': 'clear: both',
    'clear-none': 'clear: none',
    // SR only
    'sr-only':
        'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border-width: 0',
    'not-sr-only':
        'position: static; width: auto; height: auto; padding: 0; margin: 0; overflow: visible; clip: auto; white-space: normal',
};

// ── Opacity utilities ─────────────────────────────────────────────────────────

/** Named opacity values (Tailwind uses 0-100 scale). */
const OPACITY_NAMED: Record<string, string> = {
    0: '0',
    5: '0.05',
    10: '0.1',
    15: '0.15',
    20: '0.2',
    25: '0.25',
    30: '0.3',
    35: '0.35',
    40: '0.4',
    45: '0.45',
    50: '0.5',
    55: '0.55',
    60: '0.6',
    65: '0.65',
    70: '0.7',
    75: '0.75',
    80: '0.8',
    85: '0.85',
    90: '0.9',
    95: '0.95',
    100: '1',
};

// ── Border radius utilities ───────────────────────────────────────────────────

const RADIUS_SIZES = new Set(['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl']);

// ── CSS escaping ──────────────────────────────────────────────────────────────

/**
 * Escapes a Tailwind class name for use as a CSS selector.
 * @param cls - Tailwind class name to escape
 * @returns escaped CSS selector string safe to use in a rule
 */
function escapeCSSSelector(cls: string): string {
    // Escape: : / [ ] . # @ ( ) % + ~ = | ^ $ * ,
    return cls.replace(/[^\w-]/g, c => `\\${c}`);
}

// ── Variant parsing ───────────────────────────────────────────────────────────

const MIN_BREAKPOINTS = new Set(['sm', 'md', 'lg', 'xl', '2xl']);
const MAX_BREAKPOINTS = new Set(['max-sm', 'max-md', 'max-lg', 'max-xl', 'max-2xl']);
const CONTAINER_MIN = new Set(['@sm', '@md', '@lg', '@xl', '@2xl']);
const CONTAINER_MAX = new Set(['@max-sm', '@max-md', '@max-lg', '@max-xl', '@max-2xl']);

/**
 *
 */
export type Tier =
    | 'base'
    | 'sm'
    | 'md'
    | 'lg'
    | 'xl'
    | '2xl'
    | 'max-2xl'
    | 'max-xl'
    | 'max-lg'
    | 'max-md'
    | 'max-sm'
    | '@sm'
    | '@md'
    | '@lg'
    | '@xl'
    | '@2xl'
    | '@max-2xl'
    | '@max-xl'
    | '@max-lg'
    | '@max-md'
    | '@max-sm';

/**
 *
 */
export interface ParsedVariants {
    tier: Tier;
    /** Pseudo-class suffix to append to selector (e.g. ":hover"). */
    pseudoSuffix: string;
    /** For dark: variant — selector prefix (e.g. ".dark "). */
    selectorPrefix: string;
    /** The base utility class name (e.g. "p-4", "bg-blue-500"). */
    utility: string;
}

/**
 * Parses variant prefixes from a Tailwind class name.
 * Handles stacked variants: sm:hover:bg-blue-600 → tier=sm, pseudo=:hover, utility=bg-blue-600
 *
 * Tailwind stacking convention: breakpoint FIRST, then state variant.
 * e.g. sm:hover: → @media(min-width: 40rem) { :hover { ... } }
 *
 * @param cls - full Tailwind class name including variant prefixes (e.g. "sm:hover:bg-blue-600")
 * @returns parsed variant metadata including tier, pseudoSuffix, selectorPrefix, and utility
 */
export function parseVariants(cls: string): ParsedVariants {
    const parts = cls.split(':');
    let tier: Tier = 'base';
    let pseudoSuffix = '';
    let selectorPrefix = '';
    let utilityIdx = 0;

    for (let i = 0; i < parts.length - 1; i++) {
        const variant = parts[i];

        if (MIN_BREAKPOINTS.has(variant)) {
            tier = variant as Tier;
            utilityIdx = i + 1;
        } else if (MAX_BREAKPOINTS.has(variant)) {
            tier = variant as Tier;
            utilityIdx = i + 1;
        } else if (CONTAINER_MIN.has(variant)) {
            tier = variant as Tier;
            utilityIdx = i + 1;
        } else if (CONTAINER_MAX.has(variant)) {
            tier = variant as Tier;
            utilityIdx = i + 1;
        } else if (variant === 'dark') {
            selectorPrefix = '.dark ';
            utilityIdx = i + 1;
        } else if (variant === 'light') {
            selectorPrefix = '.light ';
            utilityIdx = i + 1;
        } else if (variant in PSEUDO_CLASS_MAP) {
            pseudoSuffix += PSEUDO_CLASS_MAP[variant];
            utilityIdx = i + 1;
        } else {
            // Unknown variant (e.g. group-hover, aria-*, data-*) — keep as tier=base
            utilityIdx = i + 1;
        }
    }

    const utility = parts.slice(utilityIdx).join(':');
    return { tier, pseudoSuffix, selectorPrefix, utility };
}

// ── Main generator ────────────────────────────────────────────────────────────

/**
 * Generates a CSS rule body (without selector) for a utility class.
 * Returns empty string for unknown/unsupported classes.
 *
 * @param utility - the base Tailwind utility (e.g. "p-4", "bg-blue-500", "flex")
 * @returns CSS declarations string (e.g. "padding: calc(var(--spacing) * 4)")
 */
export function generateDeclarations(utility: string): string {
    // ── 0. Security: reject any arbitrary [...] segment that could inject a
    // second declaration into this rule. Only attacker-controllable arbitrary
    // values hit this; csszyx-generated numeric/keyword utilities always pass.
    // Fail safe (emit nothing) rather than throw — a per-render throw is itself
    // a DoS.
    if (!isUtilityArbitrarySafe(utility)) {
        warnUnsafeArbitrary(utility);
        return '';
    }

    // ── 1. Keyword lookup (fastest path) ───────────────────────────────────
    if (utility in KEYWORD_RULES) {
        return KEYWORD_RULES[utility];
    }

    // ── 2. Opacity ──────────────────────────────────────────────────────────
    if (utility.startsWith('opacity-')) {
        const val = utility.slice(8);
        if (val.startsWith('[') && val.endsWith(']')) {
            return `opacity: ${val.slice(1, -1)}`;
        }
        const n = parseInt(val, 10);
        if (!Number.isNaN(n)) {
            const v = OPACITY_NAMED[n] ?? String(n / 100);
            return `opacity: ${v}`;
        }
    }

    // ── 3. Z-index ──────────────────────────────────────────────────────────
    if (utility.startsWith('z-')) {
        const val = utility.slice(2);
        if (val === 'auto') {
            return 'z-index: auto';
        }
        if (val.startsWith('[') && val.endsWith(']')) {
            return `z-index: ${val.slice(1, -1)}`;
        }
        if (!Number.isNaN(parseInt(val, 10))) {
            return `z-index: ${val}`;
        }
    }

    // ── 4. Border width ──────────────────────────────────────────────────────
    if (utility === 'border') {
        return 'border-width: 1px';
    }
    if (/^border-[trblxyse]$/.test(utility)) {
        const side = utility.slice(7);
        const cssSide: Record<string, string> = {
            t: 'border-top-width',
            r: 'border-right-width',
            b: 'border-bottom-width',
            l: 'border-left-width',
            x: 'border-inline-width',
            y: 'border-block-width',
            s: 'border-inline-start-width',
            e: 'border-inline-end-width',
        };
        if (side in cssSide) {
            return `${cssSide[side]}: 1px`;
        }
    }
    if (/^border-\d+$/.test(utility)) {
        const n = utility.slice(7);
        return `border-width: ${n}px`;
    }
    // border-t-2, border-r-4, etc.
    const borderSideWidth = utility.match(/^border-([trblxse])-(\d+)$/);
    if (borderSideWidth) {
        const [, side, n] = borderSideWidth;
        const cssSide: Record<string, string> = {
            t: 'border-top-width',
            r: 'border-right-width',
            b: 'border-bottom-width',
            l: 'border-left-width',
            x: 'border-inline-width',
            y: 'border-block-width',
            s: 'border-inline-start-width',
            e: 'border-inline-end-width',
        };
        if (side in cssSide) {
            return `${cssSide[side]}: ${n}px`;
        }
    }

    // ── 5. Border radius ────────────────────────────────────────────────────
    if (utility === 'rounded') {
        return 'border-radius: var(--radius)';
    }
    if (utility.startsWith('rounded-')) {
        const val = utility.slice(8);
        if (val === 'none') {
            return 'border-radius: 0';
        }
        if (val === 'full') {
            return 'border-radius: calc(infinity * 1px)';
        }
        if (RADIUS_SIZES.has(val)) {
            return `border-radius: var(--radius-${val})`;
        }
        // Directional: rounded-t, rounded-b, etc.
        const roundedDir: Record<string, string> = {
            t: 'border-top-left-radius: var(--radius); border-top-right-radius: var(--radius)',
            r: 'border-top-right-radius: var(--radius); border-bottom-right-radius: var(--radius)',
            b: 'border-bottom-left-radius: var(--radius); border-bottom-right-radius: var(--radius)',
            l: 'border-top-left-radius: var(--radius); border-bottom-left-radius: var(--radius)',
            tl: 'border-top-left-radius: var(--radius)',
            tr: 'border-top-right-radius: var(--radius)',
            bl: 'border-bottom-left-radius: var(--radius)',
            br: 'border-bottom-right-radius: var(--radius)',
        };
        if (val in roundedDir) {
            return roundedDir[val];
        }
        // rounded-t-lg, rounded-tr-sm, etc.
        const m = val.match(/^([trblse]+)-(.+)$/);
        if (m) {
            const [, dir, size] = m;
            const sizeVal = RADIUS_SIZES.has(size)
                ? `var(--radius-${size})`
                : size === 'full'
                  ? 'calc(infinity * 1px)'
                  : size === 'none'
                    ? '0'
                    : size;
            if (dir in roundedDir) {
                return roundedDir[dir].replace(/var\(--radius\)/g, sizeVal);
            }
        }
        if (val.startsWith('[') && val.endsWith(']')) {
            return `border-radius: ${val.slice(1, -1)}`;
        }
        if (RADIUS_SIZES.has(val)) {
            return `border-radius: var(--radius-${val})`;
        }
    }

    // ── 6. Text size ────────────────────────────────────────────────────────
    if (utility.startsWith('text-') && !utility.startsWith('text-opacity')) {
        const val = utility.slice(5);
        // Text color: handled by color utilities below
        // Text size: xs, sm, base, lg, xl, 2xl, ...
        if (TEXT_SIZES.has(val)) {
            return `font-size: var(--text-${val}); line-height: var(--tw-leading, var(--text-${val}--line-height))`;
        }
        // Arbitrary text size
        if (val.startsWith('[') && val.endsWith(']')) {
            return `font-size: ${val.slice(1, -1).replace(/_/g, ' ')}`;
        }
        // Color (text-blue-500, text-white, etc.) — falls through to color section
    }

    // ── 7. Leading (line-height) ────────────────────────────────────────────
    if (utility.startsWith('leading-')) {
        const val = utility.slice(8);
        const named: Record<string, string> = {
            none: '1',
            tight: '1.25',
            snug: '1.375',
            normal: '1.5',
            relaxed: '1.625',
            loose: '2',
        };
        if (val in named) {
            return `line-height: ${named[val]}`;
        }
        if (val.startsWith('[') && val.endsWith(']')) {
            return `line-height: ${val.slice(1, -1)}`;
        }
        if (!Number.isNaN(parseFloat(val))) {
            return `line-height: calc(var(--spacing) * ${val})`;
        }
    }

    // ── 8. Tracking (letter-spacing) ───────────────────────────────────────
    if (utility.startsWith('tracking-')) {
        const val = utility.slice(9);
        const named: Record<string, string> = {
            tighter: 'var(--tracking-tighter)',
            tight: 'var(--tracking-tight)',
            normal: 'var(--tracking-normal)',
            wide: 'var(--tracking-wide)',
            wider: 'var(--tracking-wider)',
            widest: 'var(--tracking-widest)',
        };
        if (val in named) {
            return `letter-spacing: ${named[val]}`;
        }
        if (val.startsWith('[') && val.endsWith(']')) {
            return `letter-spacing: ${val.slice(1, -1)}`;
        }
    }

    // ── 9. Font family ──────────────────────────────────────────────────────
    if (utility.startsWith('font-') && !KEYWORD_RULES[utility]) {
        const val = utility.slice(5);
        const familyNames: Record<string, string> = {
            sans: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
            serif: 'var(--font-serif, ui-serif, Georgia, serif)',
            mono: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
        };
        if (val in familyNames) {
            return `font-family: ${familyNames[val]}`;
        }
        if (val.startsWith('[') && val.endsWith(']')) {
            return `font-family: ${val.slice(1, -1).replace(/_/g, ' ')}`;
        }
    }

    // ── 10. Shadow ──────────────────────────────────────────────────────────
    if (utility === 'shadow') {
        return 'box-shadow: var(--shadow)';
    }
    if (utility.startsWith('shadow-')) {
        const val = utility.slice(7);
        if (val.startsWith('[') && val.endsWith(']')) {
            return `box-shadow: ${val.slice(1, -1).replace(/_/g, ' ')}`;
        }
        const shadows = new Set(['xs', 'sm', 'md', 'lg', 'xl', '2xl', 'none', 'inner']);
        if (shadows.has(val)) {
            return val === 'none' ? 'box-shadow: none' : `box-shadow: var(--shadow-${val})`;
        }
    }

    // ── 11. Outline ─────────────────────────────────────────────────────────
    if (utility === 'outline-none') {
        return 'outline: 2px solid transparent; outline-offset: 2px';
    }
    if (utility.startsWith('outline-')) {
        const val = utility.slice(8);
        if (/^\d+$/.test(val)) {
            return `outline-width: ${val}px`;
        }
    }

    // ── 12. Ring ────────────────────────────────────────────────────────────
    if (utility === 'ring') {
        return '--tw-ring-shadow: 0 0 0 3px var(--tw-ring-color, #3b82f680)';
    }
    if (utility.startsWith('ring-')) {
        const val = utility.slice(5);
        if (/^\d+$/.test(val)) {
            return `--tw-ring-shadow: 0 0 0 ${val}px var(--tw-ring-color, #3b82f680)`;
        }
    }

    // ── 13. Grow / shrink numbers ───────────────────────────────────────────
    if (utility.startsWith('grow-')) {
        return `flex-grow: ${utility.slice(5)}`;
    }
    if (utility.startsWith('shrink-')) {
        return `flex-shrink: ${utility.slice(7)}`;
    }

    // ── 14. Order ───────────────────────────────────────────────────────────
    if (utility.startsWith('order-')) {
        const val = utility.slice(6);
        if (val === 'first') {
            return 'order: -9999';
        }
        if (val === 'last') {
            return 'order: 9999';
        }
        if (val === 'none') {
            return 'order: 0';
        }
        return `order: ${val}`;
    }

    // ── 15. Columns ─────────────────────────────────────────────────────────
    if (utility.startsWith('columns-')) {
        const val = utility.slice(8);
        if (!Number.isNaN(parseInt(val, 10))) {
            return `columns: ${val}`;
        }
        return `columns: var(--container-${val})`;
    }

    // ── 16. Grid cols/rows ──────────────────────────────────────────────────
    if (utility.startsWith('grid-cols-')) {
        const val = utility.slice(10);
        if (val === 'none') {
            return 'grid-template-columns: none';
        }
        if (val === 'subgrid') {
            return 'grid-template-columns: subgrid';
        }
        if (val.startsWith('[')) {
            return `grid-template-columns: ${val.slice(1, -1).replace(/_/g, ' ')}`;
        }
        return `grid-template-columns: repeat(${val}, minmax(0, 1fr))`;
    }
    if (utility.startsWith('grid-rows-')) {
        const val = utility.slice(10);
        if (val === 'none') {
            return 'grid-template-rows: none';
        }
        if (val === 'subgrid') {
            return 'grid-template-rows: subgrid';
        }
        if (val.startsWith('[')) {
            return `grid-template-rows: ${val.slice(1, -1).replace(/_/g, ' ')}`;
        }
        return `grid-template-rows: repeat(${val}, minmax(0, 1fr))`;
    }

    // ── 17. Col/row span ────────────────────────────────────────────────────
    if (utility.startsWith('col-span-')) {
        const val = utility.slice(9);
        return val === 'full' ? 'grid-column: 1 / -1' : `grid-column: span ${val} / span ${val}`;
    }
    if (utility.startsWith('row-span-')) {
        const val = utility.slice(9);
        return val === 'full' ? 'grid-row: 1 / -1' : `grid-row: span ${val} / span ${val}`;
    }

    // ── 18. Scale / rotate / translate (CSS transforms in v4) ───────────────
    if (utility.startsWith('scale-x-')) {
        const val = utility.slice(8);
        return `--tw-scale-x: ${parseFloat(val) / 100}; scale: var(--tw-scale-x) var(--tw-scale-y, 1)`;
    }
    if (utility.startsWith('scale-y-')) {
        const val = utility.slice(8);
        return `--tw-scale-y: ${parseFloat(val) / 100}; scale: var(--tw-scale-x, 1) var(--tw-scale-y)`;
    }
    if (utility.startsWith('scale-')) {
        const val = utility.slice(6);
        const n = parseFloat(val) / 100;
        return `scale: ${n}`;
    }
    if (utility.startsWith('rotate-')) {
        const val = utility.slice(7);
        if (val.startsWith('[')) {
            return `rotate: ${val.slice(1, -1)}`;
        }
        return `rotate: ${val}deg`;
    }
    if (utility.startsWith('translate-x-')) {
        const val = utility.slice(12);
        const v = resolveSpacingValue(val, 'width');
        return `translate: ${v} var(--tw-translate-y, 0)`;
    }
    if (utility.startsWith('translate-y-')) {
        const val = utility.slice(12);
        const v = resolveSpacingValue(val, 'height');
        return `translate: var(--tw-translate-x, 0) ${v}`;
    }

    // ── 19. Transitions ─────────────────────────────────────────────────────
    if (utility === 'transition') {
        return 'transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter; transition-timing-function: var(--tw-ease, ease); transition-duration: var(--tw-duration, 150ms)';
    }
    if (utility === 'transition-all') {
        return 'transition-property: all; transition-timing-function: var(--tw-ease, ease); transition-duration: var(--tw-duration, 150ms)';
    }
    if (utility === 'transition-none') {
        return 'transition-property: none';
    }
    if (utility.startsWith('duration-')) {
        const val = utility.slice(9);
        if (val.startsWith('[')) {
            return `transition-duration: ${val.slice(1, -1)}`;
        }
        return `transition-duration: ${val}ms`;
    }
    if (utility.startsWith('ease-')) {
        const eases: Record<string, string> = {
            linear: 'linear',
            in: 'cubic-bezier(0.4, 0, 1, 1)',
            out: 'cubic-bezier(0, 0, 0.2, 1)',
            'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
        };
        const val = utility.slice(5);
        if (val in eases) {
            return `transition-timing-function: ${eases[val]}`;
        }
        return `transition-timing-function: var(--ease-${val})`;
    }
    if (utility.startsWith('delay-')) {
        const val = utility.slice(6);
        if (val.startsWith('[')) {
            return `transition-delay: ${val.slice(1, -1)}`;
        }
        return `transition-delay: ${val}ms`;
    }

    // ── 20. Color utilities (color properties) ──────────────────────────────
    // Try all color prefixes, longest match first to avoid partial matches
    const colorPrefixes = Object.keys(COLOR_PROPS).sort((a, b) => b.length - a.length);
    for (const prefix of colorPrefixes) {
        if (utility === prefix || utility.startsWith(`${prefix}-`)) {
            const rest = utility.slice(prefix.length + 1);
            if (!rest && utility !== prefix) {
                continue;
            } // prefix without value
            if (!rest && utility === prefix) {
                continue;
            } // bare prefix, no color value
            const cssProp = COLOR_PROPS[prefix];
            const colorVal = resolveColorValue(rest);
            return `${cssProp}: ${colorVal}`;
        }
    }

    // ── 21. Spacing utilities ────────────────────────────────────────────────
    // Try all spacing prefixes, longest match first
    const spacingPrefixes = Object.keys(SPACING_PROPS).sort((a, b) => b.length - a.length);
    for (const prefix of spacingPrefixes) {
        const dashPrefix = `${prefix}-`;
        if (utility.startsWith(dashPrefix)) {
            const val = utility.slice(dashPrefix.length);
            // Handle negative: -m-4 → the class name would be "-m-4"
            const negative = val.startsWith('-');
            const rawVal = negative ? val.slice(1) : val;
            const props = SPACING_PROPS[prefix];

            const resolved = resolveSpacingValue(negative ? `-${rawVal}` : rawVal, props[0]);
            if (!resolved) {
                continue;
            }

            return props.map(p => `${p}: ${resolved}`).join('; ');
        }
    }

    // ── 22. Arbitrary property: [property:value] ────────────────────────────
    if (utility.startsWith('[') && utility.endsWith(']') && utility.includes(':')) {
        const inner = utility.slice(1, -1).replace(/_/g, ' ');
        const colonIdx = inner.indexOf(':');
        const prop = inner.slice(0, colonIdx);
        const val = inner.slice(colonIdx + 1);
        return `${prop}: ${val}`;
    }

    // Unknown class — return empty (graceful no-op)
    return '';
}

/**
 * Generates a complete CSS rule string for a Tailwind class name.
 *
 * @param className - full Tailwind class (e.g. "hover:bg-blue-500", "sm:p-4", "p-4")
 * @returns CSS rule string (e.g. ".hover\\:bg-blue-500:hover { background-color: var(--color-blue-500) }")
 *          or empty string for unknown classes
 */
export function generateCSSRule(className: string): string {
    const { utility, pseudoSuffix, selectorPrefix } = parseVariants(className);
    const declarations = generateDeclarations(utility);

    if (!declarations) {
        return '';
    }

    const escapedClass = escapeCSSSelector(className);
    const selector = `${selectorPrefix}.${escapedClass}${pseudoSuffix}`;
    return `${selector} { ${declarations} }`;
}
