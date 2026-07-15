/**
 * JSX Transform - Converts sz prop to className string.
 *
 * This module handles the transformation of csszyx object syntax into
 * Tailwind CSS class strings. It processes nested objects for variants
 * like hover, focus, etc.
 */

import { hasSlashOpacity, isValidColorString } from './color-validation.js';
import { PROPERTY_CATEGORY_MAP, PropertyCategory } from './property-types.js';
import { MAX_SZ_DEPTH, SzDepthError } from './sz-limits.js';

// Re-exported so the runtime (which imports from `@csszyx/compiler/browser`,
// i.e. this module) shares one SzDepthError type, depth limit, and key guard.
export { isForbiddenSzKey, MAX_SZ_DEPTH, SzDepthError } from './sz-limits.js';

/**
 * Represents a value in the sz object.
 * Can be a string, number, boolean, or nested object for variants.
 */
export type SzValue = string | number | boolean | SzObject;

/**
 * Represents the sz object structure.
 * Keys are CSS property abbreviations, values can be primitives or nested objects.
 */
export interface SzObject {
    [key: string]: SzValue;
}

/**
 * Deep-merge two sz objects for array composition (`sz={[a, b]}` = later
 * wins). Merging is DEEP per key path: a later leaf value replaces an earlier
 * one at the same path, while sibling keys survive — `[{ hover: { bg: 'red' } },
 * { hover: { p: 2 } }]` keeps `hover:bg-red` AND gains `hover:p-2`. This is the
 * build-time mirror of `szcn`'s class-level group merge (same property → later
 * wins, different properties co-exist), so the static and runtime lanes of
 * array composition agree. Deliberately NOT `{ ...a, ...b }`: a shallow merge
 * would drop every earlier declaration under a variant the later object also
 * touches, which no CSS mental model expects.
 *
 * @param target - Earlier element (lower precedence). Not mutated.
 * @param source - Later element (higher precedence). Not mutated.
 * @returns A new deep-merged sz object.
 */
export function deepMergeSzObjects(target: SzObject, source: SzObject): SzObject {
    const result: SzObject = { ...target };
    for (const [key, value] of Object.entries(source)) {
        const existing = result[key];
        result[key] =
            existing !== null &&
            typeof existing === 'object' &&
            value !== null &&
            typeof value === 'object'
                ? deepMergeSzObjects(existing, value)
                : value;
    }
    return result;
}

/**
 * Readonly variant of SzValue — accepts values from `as const` objects.
 */
export type ReadonlySzValue = string | number | boolean | ReadonlySzObject;

/**
 * Readonly variant of SzObject — accepts `as const` objects without requiring `as any`.
 * Use this as the parameter type for functions that accept but do not mutate sz objects.
 */
export interface ReadonlySzObject {
    readonly [key: string]: ReadonlySzValue;
}

// ============================================================================
// PROPERTY_MAP: Maps sz prop names to Tailwind utility prefixes
// ============================================================================
export const PROPERTY_MAP: Record<string, string> = {
    // Background
    bg: 'bg',
    bgAttach: 'bg',
    bgClip: 'bg-clip',
    bgImg: 'bg',
    bgOrigin: 'bg-origin',
    bgPos: 'bg',
    bgRepeat: 'bg',
    bgSize: 'bg',

    // Gradient color stops
    from: 'from',
    via: 'via',
    to: 'to',

    // Border Radius
    rounded: 'rounded',
    roundedT: 'rounded-t',
    roundedR: 'rounded-r',
    roundedB: 'rounded-b',
    roundedL: 'rounded-l',
    roundedTl: 'rounded-tl',
    roundedTr: 'rounded-tr',
    roundedBl: 'rounded-bl',
    roundedBr: 'rounded-br',
    roundedS: 'rounded-s',
    roundedE: 'rounded-e',
    roundedSs: 'rounded-ss',
    roundedSe: 'rounded-se',
    roundedEs: 'rounded-es',
    roundedEe: 'rounded-ee',

    // Border
    border: 'border',
    borderColor: 'border',
    borderStyle: 'border',
    borderT: 'border-t',
    borderTColor: 'border-t',
    borderR: 'border-r',
    borderRColor: 'border-r',
    borderB: 'border-b',
    borderBColor: 'border-b',
    borderL: 'border-l',
    borderLColor: 'border-l',
    borderX: 'border-x',
    borderXColor: 'border-x',
    borderY: 'border-y',
    borderYColor: 'border-y',
    borderS: 'border-s',
    borderE: 'border-e',
    borderBs: 'border-bs',
    borderBe: 'border-be',

    // Divide
    divideX: 'divide-x',
    divideY: 'divide-y',
    divideColor: 'divide',
    divideStyle: 'divide',

    // Outline
    outline: 'outline',
    outlineColor: 'outline',
    outlineOffset: 'outline-offset',
    outlineStyle: 'outline',

    // Ring (v4: outset ring + inset ring)
    ring: 'ring',
    ringColor: 'ring',
    ringOffset: 'ring-offset',
    ringOffsetColor: 'ring-offset',
    insetRing: 'inset-ring',
    insetRingColor: 'inset-ring',

    // Spacing (canonical shorthand only)
    p: 'p',
    pt: 'pt',
    pr: 'pr',
    pb: 'pb',
    pl: 'pl',
    px: 'px',
    py: 'py',
    ps: 'ps',
    pe: 'pe',
    pbs: 'pbs',
    pbe: 'pbe',

    m: 'm',
    mt: 'mt',
    mr: 'mr',
    mb: 'mb',
    ml: 'ml',
    mx: 'mx',
    my: 'my',
    ms: 'ms',
    me: 'me',
    mbs: 'mbs',
    mbe: 'mbe',

    // Space between
    spaceX: 'space-x',
    spaceY: 'space-y',

    // Sizing (canonical shorthand only)
    w: 'w',
    minW: 'min-w',
    maxW: 'max-w',
    h: 'h',
    minH: 'min-h',
    maxH: 'max-h',
    size: 'size',
    blockSize: 'block',
    minBlockSize: 'min-block',
    maxBlockSize: 'max-block',
    inlineSize: 'inline',
    minInlineSize: 'min-inline',
    maxInlineSize: 'max-inline',

    // Layout
    aspect: 'aspect',
    columns: 'columns',
    breakAfter: 'break-after',
    breakBefore: 'break-before',
    breakInside: 'break-inside',
    boxDecoration: 'box-decoration',
    box: 'box',
    float: 'float',
    clear: 'clear',
    isolation: 'isolation',
    objectFit: 'object',
    objectPos: 'object',
    overflowX: 'overflow-x',
    overflowY: 'overflow-y',
    overscroll: 'overscroll',
    overscrollX: 'overscroll-x',
    overscrollY: 'overscroll-y',
    z: 'z',
    position: 'position',
    display: 'display',

    // Inset
    inset: 'inset',
    insetX: 'inset-x',
    insetY: 'inset-y',
    top: 'top',
    right: 'right',
    bottom: 'bottom',
    left: 'left',
    // TW v4.2: start/end now emit inset-s-*/inset-e-* (same CSS, deprecated old class names)
    start: 'inset-s',
    end: 'inset-e',
    insetS: 'inset-s',
    insetE: 'inset-e',
    insetBs: 'inset-bs',
    insetBe: 'inset-be',

    // Visibility
    visibility: 'visibility',

    // Typography
    color: 'text',
    text: 'text',
    weight: 'font',
    fontFamily: 'font',
    fontStretch: 'font-stretch',
    // fontStyle/fontSmoothing are emitted by closed direct-output handlers; the
    // prefix here only marks them as known props (diagnostics, editor tooling).
    fontStyle: 'font-style',
    fontSmoothing: 'font-smoothing',
    textAlign: 'text',
    decoration: 'decoration',
    decorationColor: 'decoration',
    decorationStyle: 'decoration',
    decorationThickness: 'decoration',
    underlineOffset: 'underline-offset',
    textTransform: 'text',
    textOverflow: 'text',
    textWrap: 'text',
    wrap: 'wrap',
    indent: 'indent',
    align: 'align',
    whitespace: 'whitespace',
    break: 'break',
    hyphens: 'hyphens',
    content: 'content',
    leading: 'leading',
    tracking: 'tracking',
    lineClamp: 'line-clamp',
    fontFeatures: 'font-features',
    list: 'list',
    listPos: 'list',
    listImg: 'list-image',

    // Flex & Grid
    basis: 'basis',
    // `flex` is the flex shorthand (flex: 1 → flex-1, flex: 'auto' → flex-auto).
    // The `flex: true` display sugar was removed (use display: 'flex').
    flex: 'flex',
    flexDir: 'flex',
    flexWrap: 'flex',
    grow: 'grow',
    shrink: 'shrink',
    order: 'order',
    items: 'items',
    self: 'self',
    justify: 'justify',
    justifyItems: 'justify-items',
    justifySelf: 'justify-self',
    placeContent: 'place-content',
    placeItems: 'place-items',
    placeSelf: 'place-self',
    gap: 'gap',
    gapX: 'gap-x',
    gapY: 'gap-y',

    // Grid
    gridCols: 'grid-cols',
    gridRows: 'grid-rows',
    col: 'col',
    colSpan: 'col-span',
    colStart: 'col-start',
    colEnd: 'col-end',
    row: 'row',
    rowSpan: 'row-span',
    rowStart: 'row-start',
    rowEnd: 'row-end',
    gridFlow: 'grid-flow',
    autoCols: 'auto-cols',
    autoRows: 'auto-rows',

    // Effects
    shadow: 'shadow',
    shadowColor: 'shadow',
    insetShadow: 'inset-shadow',
    insetShadowColor: 'inset-shadow',
    textShadow: 'text-shadow',
    textShadowColor: 'text-shadow',
    opacity: 'opacity',
    mixBlend: 'mix-blend',
    bgBlend: 'bg-blend',

    // Filters
    filter: 'filter',
    backdropFilter: 'backdrop-filter',
    blur: 'blur',
    brightness: 'brightness',
    contrast: 'contrast',
    dropShadow: 'drop-shadow',
    dropShadowColor: 'drop-shadow',
    grayscale: 'grayscale',
    hueRotate: 'hue-rotate',
    invert: 'invert',
    saturate: 'saturate',
    sepia: 'sepia',
    backdropBlur: 'backdrop-blur',
    backdropBrightness: 'backdrop-brightness',
    backdropContrast: 'backdrop-contrast',
    backdropGrayscale: 'backdrop-grayscale',
    backdropHueRotate: 'backdrop-hue-rotate',
    backdropInvert: 'backdrop-invert',
    backdropOpacity: 'backdrop-opacity',
    backdropSaturate: 'backdrop-saturate',
    backdropSepia: 'backdrop-sepia',

    // Transforms
    scale: 'scale',
    scaleX: 'scale-x',
    scaleY: 'scale-y',
    scaleZ: 'scale-z',
    rotate: 'rotate',
    rotateX: 'rotate-x',
    rotateY: 'rotate-y',
    rotateZ: 'rotate-z',
    translate: 'translate',
    translateX: 'translate-x',
    translateY: 'translate-y',
    translateZ: 'translate-z',
    skewX: 'skew-x',
    skewY: 'skew-y',
    origin: 'origin',
    backface: 'backface',
    perspective: 'perspective',
    perspectiveOrigin: 'perspective-origin',
    transformStyle: 'transform',
    transform: 'transform',

    // Transitions & Animation
    transition: 'transition',
    transitionBehavior: 'transition',
    duration: 'duration',
    ease: 'ease',
    delay: 'delay',
    animate: 'animate',
    animationDelay: 'animation-delay', // animation-delay — distinct from transition delay

    // Masks
    mask: 'mask',
    maskSize: 'mask-size',
    maskPos: 'mask-position',
    maskRepeat: 'mask-repeat',
    maskShape: 'mask',
    maskClip: 'mask-clip',
    maskOrigin: 'mask-origin',

    // Interactivity
    cursor: 'cursor',
    caret: 'caret',
    pointerEvents: 'pointer-events',
    fieldSizing: 'field-sizing',
    scheme: 'scheme',
    resize: 'resize',
    scroll: 'scroll',
    scrollM: 'scroll-m',
    scrollMt: 'scroll-mt',
    scrollMr: 'scroll-mr',
    scrollMb: 'scroll-mb',
    scrollMl: 'scroll-ml',
    scrollMs: 'scroll-ms',
    scrollMe: 'scroll-me',
    scrollMx: 'scroll-mx',
    scrollMy: 'scroll-my',
    scrollP: 'scroll-p',
    scrollPt: 'scroll-pt',
    scrollPr: 'scroll-pr',
    scrollPb: 'scroll-pb',
    scrollPl: 'scroll-pl',
    scrollPs: 'scroll-ps',
    scrollPe: 'scroll-pe',
    scrollPx: 'scroll-px',
    scrollPy: 'scroll-py',
    scrollPbs: 'scroll-pbs',
    scrollPbe: 'scroll-pbe',
    scrollMbs: 'scroll-mbs',
    scrollMbe: 'scroll-mbe',
    snapAlign: 'snap',
    snapStop: 'snap',
    snapType: 'snap',
    touch: 'touch',
    select: 'select',
    willChange: 'will-change',
    appearance: 'appearance',
    accent: 'accent',
    forcedColorAdjust: 'forced-color-adjust',

    // SVG
    fill: 'fill',
    stroke: 'stroke',
    strokeWidth: 'stroke',

    // Tables
    borderCollapse: 'border',
    borderSpacing: 'border-spacing',
    borderSpacingX: 'border-spacing-x',
    borderSpacingY: 'border-spacing-y',
    tableLayout: 'table',
    caption: 'caption',

    // Overflow
    overflow: 'overflow',

    // Scrollbar (v4.3)
    scrollbar: 'scrollbar',
    scrollbarThumb: 'scrollbar-thumb',
    scrollbarTrack: 'scrollbar-track',
    scrollbarGutter: 'scrollbar-gutter',

    // Zoom (v4.3)
    zoom: 'zoom',

    // Tab Size (v4.3)
    tabSize: 'tab',

    // Mask gradient color stops (v4.1)
    maskFrom: 'mask-from',
    maskVia: 'mask-via',
    maskTo: 'mask-to',
};

// ============================================================================
// CSS_VAR_TYPE_HINTS: Type hints for ambiguous properties when using CSS vars
// Tailwind v4: `font-(family-name:--var)` disambiguates from `font-(--var)`
// ============================================================================
const CSS_VAR_TYPE_HINTS: Record<string, string> = {
    fontFamily: 'family-name',
    weight: 'weight',
    text: 'length',
};

// ============================================================================
// SUGGESTION_MAP: Removed aliases → canonical key migration hints (dev only)
// This is exported for the MCP server so AI can guide users accurately.
// ============================================================================
export const SUGGESTION_MAP: Record<string, string> = {
    // Background
    backgroundColor: 'bg',
    backgroundImage: 'bgImg',
    backgroundSize: 'bgSize',
    backgroundPosition: 'bgPos',
    backgroundRepeat: 'bgRepeat',
    bgAttachment: 'bgAttach',
    bgImage: 'bgImg',
    // Border Radius
    borderRadius: 'rounded',
    borderTopLeftRadius: 'roundedTl',
    borderTopRightRadius: 'roundedTr',
    borderBottomLeftRadius: 'roundedBl',
    borderBottomRightRadius: 'roundedBr',
    // Border
    borderWidth: 'border',
    // Spacing
    padding: 'p',
    paddingTop: 'pt',
    paddingRight: 'pr',
    paddingBottom: 'pb',
    paddingLeft: 'pl',
    paddingX: 'px',
    paddingY: 'py',
    margin: 'm',
    marginTop: 'mt',
    marginRight: 'mr',
    marginBottom: 'mb',
    marginLeft: 'ml',
    marginX: 'mx',
    marginY: 'my',
    // Sizing
    width: 'w',
    height: 'h',
    minWidth: 'minW',
    maxWidth: 'maxW',
    minHeight: 'minH',
    maxHeight: 'maxH',
    // Layout
    aspectRatio: 'aspect',
    boxSizing: 'box',
    boxDecorationBreak: 'boxDecoration',
    objectPosition: 'objectPos',
    zIndex: 'z',
    // Typography
    font: 'weight (for font-weight) or fontFamily (for family)',
    fontWeight: 'weight',
    fontSize: 'text',
    textDecoration: 'decoration',
    textDecorationColor: 'decorationColor',
    textDecorationStyle: 'decorationStyle',
    textDecorationThickness: 'decorationThickness',
    textUnderlineOffset: 'underlineOffset',
    lineHeight: 'leading',
    letterSpacing: 'tracking',
    textIndent: 'indent',
    verticalAlign: 'align',
    wordBreak: 'break',
    overflowWrap: 'wrap',
    listStyleType: 'list',
    listStylePosition: 'listPos',
    listStyleImage: 'listImg',
    listStyle: 'list',
    listPosition: 'listPos',
    listImage: 'listImg',
    // Flex & Grid
    flexBasis: 'basis',
    flexDirection: 'flexDir',
    flexGrow: 'grow',
    flexShrink: 'shrink',
    alignItems: 'items',
    alignContent: 'content',
    alignSelf: 'self',
    justifyContent: 'justify',
    gridTemplateColumns: 'gridCols',
    gridTemplateRows: 'gridRows',
    gridColumn: 'col',
    gridRow: 'row',
    gridAutoFlow: 'gridFlow',
    gridAutoColumns: 'autoCols',
    gridAutoRows: 'autoRows',
    // Effects
    boxShadow: 'shadow',
    mixBlendMode: 'mixBlend',
    backgroundBlendMode: 'bgBlend',
    // Transitions
    transitionProperty: 'transition',
    transitionDuration: 'duration',
    transitionTimingFunction: 'ease',
    transitionDelay: 'delay',
    animation: 'animate',
    transformOrigin: 'origin',
    // Interactivity
    caretColor: 'caret',
    accentColor: 'accent',
    scrollBehavior: 'scroll',
    scrollMargin: 'scrollM',
    scrollPadding: 'scrollP',
    scrollSnapAlign: 'snapAlign',
    scrollSnapStop: 'snapStop',
    scrollSnapType: 'snapType',
    touchAction: 'touch',
    userSelect: 'select',
    captionSide: 'caption',
    // Scrollbar (v4.3)
    scrollbarColor: 'scrollbarThumb (thumb color) or scrollbarTrack (track color)',
    scrollbarWidth: 'scrollbar',
    // Boolean remaps
    flexWrapReverse: "flexWrap: 'wrap-reverse'",
    flexNowrap: "flexWrap: 'nowrap'",
};

// ============================================================================
// VARIANT_MAP: Maps camelCase variant names to kebab-case
// ============================================================================
export const VARIANT_MAP: Record<string, string> = {
    // Focus variants
    focusWithin: 'focus-within',
    focusVisible: 'focus-visible',

    // Structural variants
    firstOfType: 'first-of-type',
    lastOfType: 'last-of-type',
    onlyOfType: 'only-of-type',
    onlyChild: 'only',
    firstChild: 'first',
    lastChild: 'last',

    // Motion variants
    motionReduce: 'motion-reduce',
    motionSafe: 'motion-safe',

    // Contrast variants
    contrastMore: 'contrast-more',
    contrastLess: 'contrast-less',

    // Pseudo-element variants
    firstLine: 'first-line',
    firstLetter: 'first-letter',

    // Form variants
    placeholderShown: 'placeholder-shown',
    inRange: 'in-range',
    outOfRange: 'out-of-range',
    readOnly: 'read-only',

    // Pointer variants
    pointerFine: 'pointer-fine',
    pointerCoarse: 'pointer-coarse',
    pointerNone: 'pointer-none',

    // Any-pointer variants (v4.1)
    anyPointerFine: 'any-pointer-fine',
    anyPointerCoarse: 'any-pointer-coarse',
    anyPointerNone: 'any-pointer-none',

    // Form validation variants (v4.1)
    userValid: 'user-valid',
    userInvalid: 'user-invalid',

    // Details / inverted-colors variants (v4.1)
    detailsContent: 'details-content',
    invertedColors: 'inverted-colors',

    // Forced-colors media variant
    forcedColors: 'forced-colors',

    // Screen orientation
    screenPortrait: 'portrait',
    screenLandscape: 'landscape',

    // Container query max variants
    '@maxSm': '@max-sm',
    '@maxMd': '@max-md',
    '@maxLg': '@max-lg',
    '@maxXl': '@max-xl',
    '@max2xl': '@max-2xl',
};

// ============================================================================
// SPECIAL_VARIANTS: Parametric/scope variants that take a nested target and
// combine with `-`/bracket syntax instead of a plain `:` (e.g. group-hover,
// has-[:checked], supports-[display:grid]). Kept separate from KNOWN_VARIANTS
// because they are not standalone variant names.
// ============================================================================
export const SPECIAL_VARIANTS: Set<string> = new Set([
    'group',
    'peer',
    'has',
    'not',
    'data',
    'aria',
    'supports',
]);

// ============================================================================
// KNOWN_VARIANTS: All known variant names for disambiguation
// ============================================================================
export const KNOWN_VARIANTS: Set<string> = new Set([
    // Responsive
    'sm',
    'md',
    'lg',
    'xl',
    '2xl',
    // Container queries
    '@sm',
    '@md',
    '@lg',
    '@xl',
    '@2xl',
    // Dark mode
    'dark',
    'light',
    // Print/Media
    'print',
    'portrait',
    'landscape',
    // Motion
    'motion-reduce',
    'motion-safe',
    'motionReduce',
    'motionSafe',
    // Contrast
    'contrast-more',
    'contrast-less',
    'contrastMore',
    'contrastLess',
    // States
    'hover',
    'focus',
    'focus-within',
    'focus-visible',
    'focusWithin',
    'focusVisible',
    'active',
    'visited',
    'target',
    'disabled',
    'enabled',
    'checked',
    'indeterminate',
    'default',
    'required',
    'valid',
    'invalid',
    'in-range',
    'out-of-range',
    'inRange',
    'outOfRange',
    'placeholder-shown',
    'placeholderShown',
    'autofill',
    'read-only',
    'readOnly',
    // Structure
    'first',
    'last',
    'only',
    'odd',
    'even',
    'empty',
    'first-of-type',
    'last-of-type',
    'only-of-type',
    'firstOfType',
    'lastOfType',
    'onlyOfType',
    'first-child',
    'last-child',
    'only-child',
    'firstChild',
    'lastChild',
    'onlyChild',
    // Pseudo-elements
    'before',
    'after',
    'placeholder',
    'file',
    'marker',
    'selection',
    'first-line',
    'first-letter',
    'firstLine',
    'firstLetter',
    'backdrop',
    // Pointer
    'pointer-fine',
    'pointer-coarse',
    'pointer-none',
    'pointerFine',
    'pointerCoarse',
    'pointerNone',
    // Any-pointer (v4.1)
    'any-pointer-fine',
    'any-pointer-coarse',
    'any-pointer-none',
    'anyPointerFine',
    'anyPointerCoarse',
    'anyPointerNone',
    // Form validation (v4.1)
    'user-valid',
    'user-invalid',
    'userValid',
    'userInvalid',
    // Details / inverted-colors (v4.1)
    'details-content',
    'detailsContent',
    'inverted-colors',
    'invertedColors',
    // Noscript (v4.1)
    'noscript',
    // Forced-colors media variant
    'forced-colors',
    'forcedColors',
    // Starting-style + inert state variants
    'starting',
    'inert',
    // Open
    'open',
    // RTL/LTR
    'ltr',
    'rtl',
]);

// ============================================================================
// ARIA_STATES: Standard aria boolean states (vs arbitrary aria-[*] syntax)
// ============================================================================
const ARIA_STATES = new Set([
    'checked',
    'disabled',
    'expanded',
    'hidden',
    'pressed',
    'readonly',
    'required',
    'selected',
    'busy',
    'current',
    'invalid',
    'live',
    'atomic',
    'modal',
]);

// ============================================================================
// BOOLEAN_SHORTHANDS: Properties that map directly when value is true
// ============================================================================
// Boolean shorthands kept on purpose. A key stays boolean only when it is NOT a
// value-alias of a single mutually-exclusive CSS property: composite utilities
// (truncate, srOnly), additive/stackable flags (font-variant-numeric, which
// combine), default-or-value toggles (grow/ring/blur — true means the default,
// a value means a specific one), plugin components (container/prose), and
// directional reverse flags. Value-alias sugar for display/position/visibility/
// isolation/text-transform/font-style/text-decoration-line/font-smoothing was
// removed — those are written with their canonical key (see REMOVED_BOOLEAN_SUGAR).
export const BOOLEAN_SHORTHANDS: Set<string> = new Set([
    // Typography (composite — no single-property canonical form)
    'truncate',
    // Flexbox (grow/shrink only — flexWrap uses string values)
    'grow',
    'shrink',
    // Filters (default values)
    'blur',
    'grayscale',
    'invert',
    'sepia',
    'backdropBlur',
    'backdropGrayscale',
    'backdropInvert',
    'backdropSepia',
    // Misc
    'container',
    'prose',
    'proseInvert',
    'srOnly',
    'notSrOnly',
    'ordinal',
    'slashedZero',
    // Font variant numeric (additive — these combine, so they stay boolean flags)
    'liningNums',
    'oldstyleNums',
    'proportionalNums',
    'tabularNums',
    'diagonalFractions',
    'stackedFractions',
    // Divide/Space reverse
    'divideXReverse',
    'divideYReverse',
    'spaceXReverse',
    'spaceYReverse',
    // Ring (v3 future)
    'ring',
    // Outline
    'outline',
]);

// Removed boolean-sugar keys → the canonical { key, value } they map to. Used
// both for the dev-mode deprecation warning and the `csszyx migrate` codemod.
// Setting any of these at build/runtime now emits no class and warns; authors
// write the canonical form, which is a single key per CSS property so the same
// property cannot be set twice in one object.
export const REMOVED_BOOLEAN_SUGAR: Record<string, { key: string; value: string }> = {
    // display
    block: { key: 'display', value: 'block' },
    inline: { key: 'display', value: 'inline' },
    inlineBlock: { key: 'display', value: 'inline-block' },
    flex: { key: 'display', value: 'flex' },
    inlineFlex: { key: 'display', value: 'inline-flex' },
    grid: { key: 'display', value: 'grid' },
    inlineGrid: { key: 'display', value: 'inline-grid' },
    hidden: { key: 'display', value: 'none' },
    contents: { key: 'display', value: 'contents' },
    table: { key: 'display', value: 'table' },
    tableRow: { key: 'display', value: 'table-row' },
    tableCell: { key: 'display', value: 'table-cell' },
    flowRoot: { key: 'display', value: 'flow-root' },
    listItem: { key: 'display', value: 'list-item' },
    // position
    static: { key: 'position', value: 'static' },
    fixed: { key: 'position', value: 'fixed' },
    absolute: { key: 'position', value: 'absolute' },
    relative: { key: 'position', value: 'relative' },
    sticky: { key: 'position', value: 'sticky' },
    // visibility
    visible: { key: 'visibility', value: 'visible' },
    invisible: { key: 'visibility', value: 'hidden' },
    collapse: { key: 'visibility', value: 'collapse' },
    // isolation
    isolate: { key: 'isolation', value: 'isolate' },
    // text-transform
    uppercase: { key: 'textTransform', value: 'uppercase' },
    lowercase: { key: 'textTransform', value: 'lowercase' },
    capitalize: { key: 'textTransform', value: 'capitalize' },
    normalCase: { key: 'textTransform', value: 'none' },
    // font-style
    italic: { key: 'fontStyle', value: 'italic' },
    notItalic: { key: 'fontStyle', value: 'normal' },
    // text-decoration-line
    underline: { key: 'decoration', value: 'underline' },
    overline: { key: 'decoration', value: 'overline' },
    lineThrough: { key: 'decoration', value: 'line-through' },
    noUnderline: { key: 'decoration', value: 'none' },
    // font-smoothing
    antialiased: { key: 'fontSmoothing', value: 'grayscale' },
    subpixelAntialiased: { key: 'fontSmoothing', value: 'subpixel' },
};

// Alignment sz-keys take csszyx's short value form (start/end/between/around/
// evenly), NOT the CSS-spec longhand (flex-start/space-between/...). A longhand
// value produces a DEAD class — `justify-flex-start` / `content-space-between`
// have no Tailwind utility and render nothing — so warn (dev only) with the fix.
// `content` is intentionally excluded: it is the pseudo-element content property,
// which legitimately accepts arbitrary strings (use `alignContent` for alignment).
const ALIGNMENT_KEYS: ReadonlySet<string> = new Set([
    'justify',
    'items',
    'self',
    'alignContent',
    'placeItems',
    'placeContent',
    'justifyItems',
    'justifySelf',
]);

const ALIGNMENT_CSS_VALUE_HINT: Readonly<Record<string, string>> = {
    'flex-start': 'start',
    'flex-end': 'end',
    'space-between': 'between',
    'space-around': 'around',
    'space-evenly': 'evenly',
};

// Dev-only de-dup so a prop-API component rendering the same mistake every frame
// (via `_sz`) does not spam the console.
const warnedAlignmentValues = new Set<string>();

/**
 * Warn (dev only) when an alignment sz-key receives a CSS-spec longhand value
 * that lowers to a dead class. No-op in production (dead-code-eliminated). Unlike
 * the other dev warnings here, this is NOT gated on a non-browser env: the
 * alignment props are most often resolved at runtime via `_sz` in a prop-API
 * component, where `window` is defined — so it must fire in browser dev too.
 *
 * @param rawKey - The sz key being lowered.
 * @param value - Its value.
 */
function warnAlignmentValue(rawKey: string, value: unknown): void {
    if (process.env.NODE_ENV === 'production' || typeof value !== 'string') {
        return;
    }
    const hint = ALIGNMENT_CSS_VALUE_HINT[value];
    if (!hint || !ALIGNMENT_KEYS.has(rawKey)) {
        return;
    }
    const sig = `${rawKey}:${value}`;
    if (warnedAlignmentValues.has(sig)) {
        return;
    }
    warnedAlignmentValues.add(sig);
    console.warn(
        `[csszyx] ${rawKey}: '${value}' is a CSS value — use the short form '${hint}' ` +
            `(e.g. { ${rawKey}: '${hint}' }). '${rawKey}-${value}' has no Tailwind utility ` +
            'and renders nothing.',
    );
}

// ============================================================================
// BOOLEAN_TO_CLASS: Maps camelCase boolean props to their class names
// ============================================================================
const BOOLEAN_TO_CLASS: Record<string, string> = {
    backdropBlur: 'backdrop-blur',
    backdropGrayscale: 'backdrop-grayscale',
    backdropInvert: 'backdrop-invert',
    backdropSepia: 'backdrop-sepia',
    srOnly: 'sr-only',
    notSrOnly: 'not-sr-only',
    divideXReverse: 'divide-x-reverse',
    divideYReverse: 'divide-y-reverse',
    spaceXReverse: 'space-x-reverse',
    spaceYReverse: 'space-y-reverse',
    // Font variant numeric
    liningNums: 'lining-nums',
    oldstyleNums: 'oldstyle-nums',
    proportionalNums: 'proportional-nums',
    tabularNums: 'tabular-nums',
    diagonalFractions: 'diagonal-fractions',
    stackedFractions: 'stacked-fractions',
    // Transforms
    transformGpu: 'transform-gpu',
    transformCpu: 'transform-cpu',
    // Misc
    proseInvert: 'prose-invert',
};

// ============================================================================
// SNAP_DIRECT_MAP: Snap property direct mappings (no prefix-value pattern)
// ============================================================================
const SNAP_DIRECT_MAP: Record<string, Record<string, string>> = {
    snapAlign: {
        start: 'snap-start',
        end: 'snap-end',
        center: 'snap-center',
        none: 'snap-align-none',
    },
    snapStop: {
        normal: 'snap-normal',
        always: 'snap-always',
    },
    snapType: {
        none: 'snap-none',
        x: 'snap-x',
        y: 'snap-y',
        both: 'snap-both',
    },
    snapStrictness: {
        mandatory: 'snap-mandatory',
        proximity: 'snap-proximity',
    },
};

// ============================================================================
// NEGATIVE_ALLOWED: Properties that support negative values
// ============================================================================
const NEGATIVE_ALLOWED = new Set([
    'm',
    'mt',
    'mr',
    'mb',
    'ml',
    'mx',
    'my',
    'ms',
    'me',
    'mbs',
    'mbe',
    'top',
    'right',
    'bottom',
    'left',
    'inset',
    'inset-x',
    'inset-y',
    // TW v4.2: start/end now map to inset-s/inset-e
    'inset-s',
    'inset-e',
    'inset-bs',
    'inset-be',
    'z',
    'order',
    'col',
    'col-start',
    'col-end',
    'row',
    'row-start',
    'row-end',
    'rotate',
    'rotate-x',
    'rotate-y',
    'rotate-z',
    'scale-z',
    'skew-x',
    'skew-y',
    'translate',
    'translate-x',
    'translate-y',
    'translate-z',
    'mask',
    'space-x',
    'space-y',
    'tracking',
    'indent',
    'scroll-m',
    'scroll-mx',
    'scroll-my',
    'scroll-mt',
    'scroll-mr',
    'scroll-mb',
    'scroll-ml',
    'hue-rotate',
    'backdrop-hue-rotate',
]);

// ============================================================================
// COLOR_KEYWORDS & COLOR_SCALE_PATTERN: For color value detection
// ============================================================================
/*
const COLOR_KEYWORDS = new Set(['inherit', 'current', 'transparent', 'black', 'white']);
const COLOR_SCALE_PATTERN = /^(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+/;

// function isColorValue(value: string): boolean {
//     return COLOR_KEYWORDS.has(value) ||
//            COLOR_SCALE_PATTERN.test(value) ||
//            value.startsWith('#') ||
//            value.includes('/');
// }
*/

// Tailwind v4: opacity modifiers after / accept any integer or 0.5-step decimal bare.
// Everything else (%, leading dot, non-0.5 decimals) goes in brackets.

/**
 * Represents the result of a transformation.
 */
export interface TransformResult {
    className: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Handles the important modifier (!)
 * @param value - the value to check for trailing !
 * @returns parsed value and whether it was marked important
 */
function handleImportant(value: string): { value: string; important: boolean } {
    if (typeof value === 'string' && value.endsWith('!')) {
        return { value: value.slice(0, -1), important: true };
    }
    return { value, important: false };
}

/** Named colors whose slash-opacity always works (alpha-capable by definition). */
const ALPHA_SAFE_NAMED_COLORS = new Set(['white', 'black', 'transparent', 'current', 'inherit']);

/** Custom theme tokens already nudged about slash-opacity (once per token). */
const _warnedOpacityTokens = new Set<string>();

/**
 * Formats an opacity value for Tailwind class output.
 * Handles numbers, CSS variables, and arbitrary values.
 * @param op - the opacity value (number or string)
 * @returns formatted opacity string for Tailwind class
 */
function formatOpacity(op: number | string): string {
    if (typeof op === 'number') {
        // Integers and half-step decimals (×2 is integer: 0, 0.5, 1, 50, 75.5, …) → plain "/50", "/0.5"
        // Other decimals (e.g. 0.05, 0.02) are fraction-scale → arbitrary "/[0.05]"
        if (Number.isInteger(op * 2)) {
            return String(op);
        }
        return `[${op}]`;
    }
    if (typeof op === 'string') {
        if (op.startsWith('--')) {
            return `(${op})`;
        }
        return `[${op}]`;
    }
    return String(op);
}

/**
 * Checks if a key is an arbitrary variant (e.g., "[&>span]")
 * @param key - the key to check
 * @returns whether the key is an arbitrary variant
 */
function isArbitraryVariant(key: string): boolean {
    return key.startsWith('[') && key.endsWith(']');
}

/**
 * Normalizes arbitrary variant selectors (removes extra whitespace)
 * @param key - the arbitrary variant key to normalize
 * @returns normalized variant string with whitespace removed
 */
export function normalizeArbitraryVariant(key: string): string {
    // "[& > span]" → "[&>span]"
    return key.replace(/\s+/g, '');
}

/**
 * Normalizes arbitrary values for Tailwind
 * @param value - the arbitrary value to normalize
 * @returns normalized value with spaces replaced by underscores
 */
export function normalizeArbitraryValue(value: string): string {
    // Strip user-provided outer brackets — sz auto-wraps arbitrary values;
    // users must never pre-wrap (e.g. '[100px]' → '100px', then re-wrapped as needed).
    const stripped = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
    return stripped.trim().replace(/\s+/g, '_');
}

// Properties that support native fraction values (e.g. w-1/2) without brackets
const FRACTION_SUPPORTED_PROPS = new Set([
    // Sizing (both rawKey and resolved key forms)
    'w',
    'width',
    'min-w',
    'minW',
    'minWidth',
    'max-w',
    'maxW',
    'maxWidth',
    'h',
    'height',
    'min-h',
    'minH',
    'minHeight',
    'max-h',
    'maxH',
    'maxHeight',
    'size',
    // Flex
    'basis',
    'flexBasis',
    'flex',
    // Inset
    'inset',
    'inset-x',
    'insetX',
    'inset-y',
    'insetY',
    'top',
    'right',
    'bottom',
    'left',
    'start',
    'end',
    // Translate
    'translate',
    'translate-x',
    'translateX',
    'translate-y',
    'translateY',
    // Aspect
    'aspect',
]);

/**
 * Checks if a value needs arbitrary brackets
 * @param value - the CSS value to check
 * @returns whether the value requires wrapping in brackets
 */
function needsArbitraryBrackets(value: string): boolean {
    // Strip user-provided outer brackets before detection so '[100px]' is treated as '100px'
    const v = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
    return (
        /^\d+(\.\d+)?(px|rem|em|%|vh|vw|ch|dvh|dvw|svh|svw|lvh|lvw|cqw|cqh|deg|rad|turn|grad|ms|s|fr)$/.test(
            v,
        ) || // Positive units
        /^-\d+(\.\d+)?(px|rem|em|%|vh|vw|ch|dvh|dvw|svh|svw|lvh|lvw|cqw|cqh|deg|rad|turn|grad|ms|s|fr)$/.test(
            v,
        ) || // Negative units like -1px, -2rem
        /^\.\d+(px|rem|em|%|vh|vw|ch)?$/.test(v) || // Values starting with . like .25em
        /^-\.\d+(px|rem|em|%|vh|vw|ch)?$/.test(v) || // Negative values starting with -. like -.25em
        v.startsWith('#') || // Hex colors
        v.startsWith('rgb') || // RGB colors
        v.startsWith('hsl') || // HSL colors
        v.includes('calc(') || // Calculations
        v.includes('var(') || // CSS variables (old syntax)
        v.includes('attr(') || // attr() function
        v.includes('url(') || // URLs
        v.includes('clamp(') || // Clamp
        v.includes('min(') || // Min
        v.includes('max(') || // Max
        v.includes(' ') // Values with spaces need brackets
    );
}

/**
 * Returns whether a character can occur in the ASCII identifier used by
 * Tailwind build-time functions such as `--spacing(4)`.
 *
 * @param code - UTF-16 code unit to classify
 * @returns Whether the code unit is an ASCII identifier character
 */
function isAsciiIdentifierCode(code: number): boolean {
    return (
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        code === 95 ||
        (code >= 97 && code <= 122) ||
        code === 45
    );
}

/**
 * @param code - UTF-16 code unit to classify
 * @returns Whether the code unit can start an ASCII Tailwind function name
 */
function isAsciiIdentifierStartCode(code: number): boolean {
    return (code >= 65 && code <= 90) || code === 95 || (code >= 97 && code <= 122);
}

/**
 * Distinguishes Tailwind build-time function calls (`--spacing(4)`) from CSS
 * custom-property names (`--spacing`). The scanner is deliberately linear and
 * allocation-free so malformed or adversarial arbitrary values cannot trigger
 * regex backtracking or input-proportional temporary allocations.
 *
 * @param value - Candidate sz string value
 * @returns Whether the complete value is one balanced build-time function call
 */
function isTailwindBuildFunction(value: string): boolean {
    const length = value.length;
    if (length < 5 || value.charCodeAt(0) !== 45 || value.charCodeAt(1) !== 45) {
        return false;
    }

    if (!isAsciiIdentifierStartCode(value.charCodeAt(2))) return false;

    let index = 3;
    while (index < length && isAsciiIdentifierCode(value.charCodeAt(index))) {
        index += 1;
    }
    if (index === 2 || index >= length || value.charCodeAt(index) !== 40) {
        return false;
    }

    return scanTailwindFunctionBody(value, index);
}

/**
 * Scan a Tailwind build-function body from its opening parenthesis.
 * @param value - Complete candidate value.
 * @param start - Opening-parenthesis offset.
 * @returns Whether the parentheses and quotes close at the end of the value.
 */
function scanTailwindFunctionBody(value: string, start: number): boolean {
    const state = { depth: 0, quote: 0, escaped: false };
    for (let index = start; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (consumeTailwindQuotedCode(code, state)) continue;
        if (code === 40) state.depth += 1;
        if (code === 41) {
            state.depth -= 1;
            if (state.depth === 0) return index === value.length - 1;
            if (state.depth < 0) return false;
        }
    }
    return false;
}

/** Mutable quote state for the build-function scanner. */
interface TailwindFunctionScanState {
    depth: number;
    quote: number;
    escaped: boolean;
}

/**
 * Consume escape and quote codes before parenthesis handling.
 * @param code - Current character code.
 * @param state - Mutable scanner state.
 * @returns Whether parenthesis handling should skip this code.
 */
function consumeTailwindQuotedCode(code: number, state: TailwindFunctionScanState): boolean {
    if (state.escaped) {
        state.escaped = false;
        return true;
    }
    if (code === 92) {
        state.escaped = true;
        return true;
    }
    if (state.quote !== 0) {
        if (code === state.quote) state.quote = 0;
        return true;
    }
    if (code === 34 || code === 39) {
        state.quote = code;
        return true;
    }
    return false;
}

// Tailwind v4: <number> values are fully dynamic (no static limits)
// z-index, font-weight, order, grid-span, grid-start/end, line-clamp all accept ANY integer
const LIST_STYLE_STANDARD = new Set(['none', 'disc', 'decimal']);
// Tailwind v4: gradient positions are fully dynamic for integer %, no static scale needed
const FONT_STRETCH_KEYWORDS = new Set([
    'ultra-condensed',
    'extra-condensed',
    'condensed',
    'semi-condensed',
    'normal',
    'semi-expanded',
    'expanded',
    'extra-expanded',
    'ultra-expanded',
]);

// Known Tailwind utility properties - these should use standard utility syntax
/*
// const KNOWN_UTILITY_PROPS = new Set([
    // All keys from PROPERTY_MAP values
    'bg', 'rounded', 'border', 'divide', 'outline', 'ring', 'ring-offset',
    'p', 'pt', 'pr', 'pb', 'pl', 'px', 'py', 'ps', 'pe',
    'm', 'mt', 'mr', 'mb', 'ml', 'mx', 'my', 'ms', 'me',
    'space-x', 'space-y', 'w', 'min-w', 'max-w', 'h', 'min-h', 'max-h', 'size',
    'aspect', 'columns', 'break-after', 'break-before', 'break-inside',
    'box-decoration', 'box', 'float', 'clear', 'isolation', 'object',
    'overflow', 'overflow-x', 'overflow-y', 'overscroll', 'overscroll-x', 'overscroll-y',
    'z', 'position', 'display', 'visibility', 'inset', 'inset-x', 'inset-y',
    'top', 'right', 'bottom', 'left', 'start', 'end',
    'text', 'font', 'decoration', 'underline-offset', 'indent', 'align', 'whitespace',
    'break', 'hyphens', 'content', 'leading', 'tracking', 'list', 'list-image',
    'basis', 'flex', 'grow', 'shrink', 'order', 'items', 'content', 'self',
    'justify', 'justify-items', 'justify-self', 'place-content', 'place-items', 'place-self',
    'gap', 'gap-x', 'gap-y', 'grid-cols', 'grid-rows', 'col', 'col-span', 'col-start', 'col-end',
    'row', 'row-span', 'row-start', 'row-end', 'grid-flow', 'auto-cols', 'auto-rows',
    'shadow', 'opacity', 'mix-blend', 'bg-blend',
    'blur', 'brightness', 'contrast', 'drop-shadow', 'grayscale', 'hue-rotate', 'invert', 'saturate', 'sepia',
    'backdrop-blur', 'backdrop-brightness', 'backdrop-contrast', 'backdrop-grayscale',
    'backdrop-hue-rotate', 'backdrop-invert', 'backdrop-opacity', 'backdrop-saturate', 'backdrop-sepia',
    'scale', 'scale-x', 'scale-y', 'rotate', 'translate-x', 'translate-y', 'skew-x', 'skew-y', 'origin',
    'transition', 'duration', 'ease', 'delay', 'animate',
    'cursor', 'caret', 'pointer-events', 'resize', 'scroll', 'scroll-m', 'scroll-mt', 'scroll-mr',
    'scroll-mb', 'scroll-ml', 'scroll-ms', 'scroll-me', 'scroll-mx', 'scroll-my',
    'scroll-p', 'scroll-pt', 'scroll-pr', 'scroll-pb', 'scroll-pl', 'scroll-ps', 'scroll-pe',
    'scroll-px', 'scroll-py', 'snap', 'touch', 'select', 'will-change', 'appearance', 'accent',
    'fill', 'stroke', 'border-spacing', 'table', 'caption',
    // Additional common utilities
    'bg-linear-to', 'from', 'via', 'to', 'rounded-t', 'rounded-r', 'rounded-b', 'rounded-l',
    'rounded-tl', 'rounded-tr', 'rounded-bl', 'rounded-br', 'rounded-s', 'rounded-e',
    'rounded-ss', 'rounded-se', 'rounded-es', 'rounded-ee',
    'border-t', 'border-r', 'border-b', 'border-l', 'border-x', 'border-y', 'border-s', 'border-e',
    // Masks
    'mask', 'mask-image', 'mask-size', 'mask-position', 'mask-repeat',
    // Accessibility
    'forced-color-adjust',
    // Transforms
    'perspective', 'perspective-origin', 'transform', 'transform-style', 'backface',
    // Gradients
    'gradient',
]);
*/

/**
 * Converts a camelCase CSS property name to kebab-case.
 * CSS custom properties (--*) are returned unchanged.
 * @param prop - camelCase property name (e.g. "writingMode", "touchAction")
 * @returns kebab-case string (e.g. "writing-mode", "touch-action")
 */
function camelToKebab(prop: string): string {
    if (prop.startsWith('--')) {
        return prop;
    }
    return prop.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Gets the variant prefix from a camelCase key
 * @param key - the camelCase variant key
 * @returns the mapped or kebab-cased variant prefix
 */
export function getVariantPrefix(key: string): string {
    // Check VARIANT_MAP first
    if (VARIANT_MAP[key]) {
        return VARIANT_MAP[key];
    }
    // Fallback: convert camelCase to kebab-case
    return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Handles group/peer variants with special syntax
 * { group: { hover: { ... }}} → group-hover:
 * { group: { name: { hover: { ... }}}} → group-hover/name:
 * { group: { has: { a: { ... }}}} → group-has-[a]:
 * @param type - either 'group' or 'peer'
 * @param nestedObj - the nested sz object with variant definitions
 * @param prefix - the current class name prefix
 * @returns array of generated class names
 */
function handleGroupPeer(type: 'group' | 'peer', nestedObj: SzObject, prefix: string): string[] {
    const classes: string[] = [];
    for (const [nestedKey, nestedValue] of Object.entries(nestedObj)) {
        collectGroupPeerEntry(type, nestedKey, nestedValue, prefix, classes);
    }
    return classes;
}

/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- Internal variant stages share the handleGroupPeer contract. */

/** Collects one direct or named group/peer entry. */
function collectGroupPeerEntry(
    type: 'group' | 'peer',
    key: string,
    value: SzValue,
    prefix: string,
    classes: string[],
): void {
    if (isInactiveVariantValue(value)) return;
    if (key === 'has' && typeof value === 'object') {
        collectGroupPeerAttributes(type, 'has', value as SzObject, prefix, '', classes);
    } else if (key === 'data' && typeof value === 'object') {
        collectGroupPeerAttributes(type, 'data', value as SzObject, prefix, '', classes);
    } else if (key === 'aria' && typeof value === 'object') {
        collectGroupPeerAttributes(type, 'aria', value as SzObject, prefix, '', classes);
    } else if (isArbitraryGroupPeerKey(key)) {
        appendVariantClasses(value, `${prefix}${type}-[${key}]:`, classes);
    } else if (isKnownVariantKey(key)) {
        appendVariantClasses(value, `${prefix}${type}-${getVariantPrefix(key)}:`, classes);
    } else if (typeof value === 'object') {
        collectNamedGroupPeer(type, key, value as SzObject, prefix, classes);
    }
}

/** Collects has/data/aria attribute variants with an optional group name. */
function collectGroupPeerAttributes(
    type: 'group' | 'peer',
    kind: 'has' | 'data' | 'aria',
    values: SzObject,
    prefix: string,
    name: string,
    classes: string[],
): void {
    for (const [attribute, value] of Object.entries(values)) {
        if (isInactiveVariantValue(value)) continue;
        const segment = groupPeerAttributeSegment(kind, attribute);
        const suffix = name ? `/${name}` : '';
        appendVariantClasses(value, `${prefix}${type}-${segment}${suffix}:`, classes);
    }
}

/** Builds the Tailwind segment for a group/peer attribute variant. */
function groupPeerAttributeSegment(kind: 'has' | 'data' | 'aria', attribute: string): string {
    if (kind === 'has') return `has-[${attribute}]`;
    if (kind === 'data') return `data-[${attribute}]`;
    return ARIA_STATES.has(attribute) ? `aria-${attribute}` : `aria-[${attribute}]`;
}

/** Collects states nested under a named group or peer. */
function collectNamedGroupPeer(
    type: 'group' | 'peer',
    name: string,
    states: SzObject,
    prefix: string,
    classes: string[],
): void {
    for (const [state, value] of Object.entries(states)) {
        if (isInactiveVariantValue(value)) continue;
        if ((state === 'data' || state === 'aria') && typeof value === 'object') {
            collectGroupPeerAttributes(type, state, value as SzObject, prefix, name, classes);
        } else {
            appendVariantClasses(
                value,
                `${prefix}${type}-${getVariantPrefix(state)}/${name}:`,
                classes,
            );
        }
    }
}

/** Appends transformed classes for one variant value. */
function appendVariantClasses(value: SzValue, prefix: string, classes: string[]): void {
    const result = transform(value as SzObject, prefix);
    if (result.className) classes.push(result.className);
}

/** Returns whether a variant value is intentionally absent. */
function isInactiveVariantValue(value: SzValue): boolean {
    return value === null || value === undefined || value === false;
}

/** Returns whether a group/peer key uses arbitrary selector syntax. */
function isArbitraryGroupPeerKey(key: string): boolean {
    return key.startsWith('.') || key.startsWith('#') || key.startsWith('[') || key.startsWith(':');
}

/** Returns whether a key names a supported variant. */
function isKnownVariantKey(key: string): boolean {
    return KNOWN_VARIANTS.has(key) || KNOWN_VARIANTS.has(getVariantPrefix(key));
}

/* eslint-enable jsdoc/require-param, jsdoc/require-returns */

/**
 * Handles has variant with special syntax
 * { has: { img: { bg: "blue" }}} → has-[img]:bg-blue
 * { has: { checked: { bg: "blue" }}} → has-[:checked]:bg-blue
 * @param hasObj - the has variant object with selector-value pairs
 * @param prefix - the current class name prefix
 * @returns array of generated class names
 */
function handleHas(hasObj: SzObject, prefix: string): string[] {
    const classes: string[] = [];

    for (const [selector, value] of Object.entries(hasObj)) {
        if (value === null || value === undefined || value === false) {
            continue;
        }

        // Determine the selector format
        let selectorStr: string;
        // Check if it's a state (needs colon prefix)
        if (KNOWN_VARIANTS.has(selector) || selector.startsWith(':')) {
            selectorStr = selector.startsWith(':') ? selector : `:${selector}`;
        } else {
            selectorStr = selector;
        }

        const variantPrefix = `${prefix}has-[${selectorStr}]:`;
        const result = transform(value as SzObject, variantPrefix);
        if (result.className) {
            classes.push(result.className);
        }
    }

    return classes;
}

/**
 * Transform one supported `not` variant entry.
 *
 * @param key Variant or nested condition name.
 * @param value Variant body.
 * @param prefix Current class-name prefix.
 * @returns Generated class names for the entry.
 */
function transformNotEntry(key: string, value: SzValue, prefix: string): string[] {
    if (key === 'supports' && typeof value === 'object') {
        return Object.entries(value as SzObject).flatMap(([condition, condValue]) => {
            const result = transform(
                condValue as SzObject,
                `${prefix}not-supports-[${condition}]:`,
            );
            return result.className ? [result.className] : [];
        });
    }

    const result = transform(value as SzObject, `${prefix}not-${getVariantPrefix(key)}:`);
    return result.className ? [result.className] : [];
}

/**
 * Handles not variant with special syntax
 * { not: { hover: { opacity: 75 }}} → not-hover:opacity-75
 * { not: { supports: { "display:grid": { block: true }}}} → not-supports-[display:grid]:block
 * @param notObj - the not variant object with condition-value pairs
 * @param prefix - the current class name prefix
 * @returns array of generated class names
 */
function handleNot(notObj: SzObject, prefix: string): string[] {
    const classes: string[] = [];

    for (const [key, value] of Object.entries(notObj)) {
        if (value === null || value === undefined || value === false) {
            continue;
        }
        classes.push(...transformNotEntry(key, value, prefix));
    }

    return classes;
}

/**
 * Handles data attribute variant
 * { data: { active: { text: "blue" }}} → data-[active]:text-blue
 * @param dataObj - the data variant object with attribute-value pairs
 * @param prefix - the current class name prefix
 * @returns array of generated class names
 */
function handleData(dataObj: SzObject, prefix: string): string[] {
    const classes: string[] = [];

    for (const [key, value] of Object.entries(dataObj)) {
        if (value === null || value === undefined || value === false) {
            continue;
        }

        const variantPrefix = `${prefix}data-[${key}]:`;
        const result = transform(value as SzObject, variantPrefix);
        if (result.className) {
            classes.push(result.className);
        }
    }

    return classes;
}

/**
 * Handles aria attribute variant
 * { aria: { expanded: { text: "blue" }}} → aria-expanded:text-blue
 * { aria: { "busy=true": { text: "blue" }}} → aria-[busy=true]:text-blue
 * @param ariaObj - the aria variant object with attribute-value pairs
 * @param prefix - the current class name prefix
 * @returns array of generated class names
 */
function handleAria(ariaObj: SzObject, prefix: string): string[] {
    const classes: string[] = [];

    for (const [key, value] of Object.entries(ariaObj)) {
        if (value === null || value === undefined || value === false) {
            continue;
        }

        let variantPrefix: string;
        if (ARIA_STATES.has(key)) {
            // Standard aria state
            variantPrefix = `${prefix}aria-${key}:`;
        } else {
            // Arbitrary aria attribute
            variantPrefix = `${prefix}aria-[${key}]:`;
        }

        const result = transform(value as SzObject, variantPrefix);
        if (result.className) {
            classes.push(result.className);
        }
    }

    return classes;
}

/**
 * Handles supports variant
 * { supports: { "display:grid": { grid: true }}} → supports-[display:grid]:grid
 * @param supportsObj - the supports variant object with condition-value pairs
 * @param prefix - the current class name prefix
 * @returns array of generated class names
 */
function handleSupports(supportsObj: SzObject, prefix: string): string[] {
    const classes: string[] = [];

    for (const [condition, value] of Object.entries(supportsObj)) {
        if (value === null || value === undefined || value === false) {
            continue;
        }

        const variantPrefix = `${prefix}supports-[${condition}]:`;
        const result = transform(value as SzObject, variantPrefix);
        if (result.className) {
            classes.push(result.className);
        }
    }

    return classes;
}

// ============================================================================
// MAIN TRANSFORM FUNCTION
// ============================================================================

/**
 * Transforms a csszyx sz object into a Tailwind CSS className string.
 *
 * @param {SzObject} szProp - The sz object from JSX
 * @param {string} prefix - Variant prefix for nested properties
 * @param {Record<string, string>} [mangleMap] - Optional map for property name mangling
 * @returns {TransformResult} The transformation result
 */
/**
 * Current sz recursion depth. Incremented on every {@link transform} entry and
 * decremented on exit (single-threaded, balanced by the `finally`), so a chain
 * of nested variant objects is bounded without threading a depth argument
 * through ~24 recursive call sites.
 */
let szTransformDepth = 0;

/**
 * Build-time-only source location for the sz object currently being lowered, so
 * the dev-mode "Unknown property" warning can point at the offending file
 * (relative to the project root) and line instead of being un-locatable in a
 * large codebase. A build engine sets this around its per-attribute lowering and
 * clears it afterwards; the runtime/browser path never sets it (and keeps the
 * location-free message). Single-threaded JS, same pattern as {@link szTransformDepth}.
 */
let szWarnLocation: string | undefined;

/**
 * Whether dev-mode sz diagnostics should be printed. True in development, in a
 * Node/SSR context only (never the browser client — the warnings would double a
 * server-side render), and unless `CSSZYX_QUIET_SZ_WARNINGS=1` mutes them. The
 * opt-out lets a team that prefers a quiet dev loop rely on `csszyx check`
 * instead; the default stays ON because an unknown/aliased key is a
 * dropped-class correctness signal, not a style nudge.
 *
 * @returns Whether a dev-mode sz warning should be printed.
 */
function szDevWarningsEnabled(): boolean {
    return (
        process.env.NODE_ENV !== 'production' &&
        typeof window === 'undefined' &&
        process.env.CSSZYX_QUIET_SZ_WARNINGS !== '1'
    );
}

/**
 * Whether the one-time "run a full project scan" hint has been shown. Build-time
 * unknown-key warnings are lazy (a file warns only when its route is requested),
 * so the first one points the developer at `csszyx check` for a complete pass.
 * Suppressed when `CSSZYX_NO_PROJECT_SCAN_HINT` is set — `csszyx check` itself is
 * the scan and sets it so it doesn't advertise itself.
 */
let szHintedProjectScan = false;

/**
 * Emits the project-scan hint at most once per process, alongside the first
 * unknown/aliased sz key warning.
 *
 * Fires whether or not the warning carries a source location. A location-less
 * warning comes from the runtime/browser path (an sz built from a variable, a
 * spread, an `szv()`/`dynamic()` result) — exactly the case a developer cannot
 * trace by eye, so the "here is the command to find it" tip matters MOST there.
 * Previously the hint was gated on having a location and so never printed for
 * those warnings.
 *
 * @param location - the `at <file>:<line>` suffix, present only on the build path.
 */
function hintProjectScanOnce(location: string | undefined): void {
    if (szHintedProjectScan || process.env.CSSZYX_NO_PROJECT_SCAN_HINT === '1') {
        return;
    }
    szHintedProjectScan = true;
    // A located warning already names its file; a location-less one (runtime
    // path) does not, so it needs the scan command to find which file to fix.
    const why = location
        ? 'dev warnings only surface files as you open them'
        : 'this warning has no source location — the scan reports which file and key triggered it';
    // stderr (console.warn), not stdout: this can fire during a transform run inside
    // a stdio JSON-RPC consumer (@csszyx/mcp-server), where stray stdout corrupts it.
    console.warn(
        `[csszyx] Tip: run \`npx @csszyx/cli check\` to scan every file for sz key issues at once (${why}).`,
    );
}

/**
 * Frames belonging to csszyx/runtime/host internals, never the user's code.
 * Matches by PATH and by internal function NAME so it catches every internal
 * frame whether csszyx is loaded from a package (`node_modules/@csszyx`, or this
 * monorepo's `packages/<pkg>/dist`) or from source (a test/dev run resolves
 * `packages/<pkg>/src`, where a path filter alone would miss `transformImpl`).
 * `@csszyx` (scoped) rather than bare `csszyx` so a user app whose own path
 * contains "csszyx" is not filtered; internal names are lowerCamel, so a
 * PascalCase component (`Transform`) is never matched.
 */
const INTERNAL_STACK_FRAME =
    /node_modules|node:internal|@csszyx|packages\/(?:compiler|runtime|dynamic|core|vars)\/(?:dist|src)|\btransform|\bszJoin\b|\b_sz\w*|\bdynamic\b|runtimeSzWarnContext|firstUserStackFrame/;

/**
 * The first stack frame outside csszyx/runtime/node internals — the user's
 * component or module that passed the offending sz object. Derived from a
 * captured stack (dev-only, called only when a warning fires) rather than React
 * internals, so it works in the browser and SSR without a framework coupling.
 * Returns the `Component (file:line)` text a console renders click-to-source, or
 * undefined when the stack is unavailable or every frame is internal.
 *
 * @returns The first user frame, or undefined.
 */
function firstUserStackFrame(): string | undefined {
    const stack = new Error().stack;
    if (!stack) {
        return undefined;
    }
    // Line 0 is "Error"; frames follow as "    at <fn> (<loc>)".
    for (const line of stack.split('\n').slice(1)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('at ') || INTERNAL_STACK_FRAME.test(trimmed)) {
            continue;
        }
        return trimmed.slice(3).trim();
    }
    return undefined;
}

/**
 * Traceability suffix for a location-less (runtime) unknown-key warning: the
 * offending object's shallow shape plus the first user stack frame. Best-effort
 * — never throws, caps the serialized shape, and omits either part it cannot
 * produce.
 *
 * @param szProp - The sz object being transformed.
 * @returns A leading-space suffix, or empty string when nothing is available.
 */
function runtimeSzWarnContext(szProp: SzObject): string {
    let shape = '';
    try {
        // Shallow top-level keys only, capped — never dump a large or cyclic
        // object into the console.
        const serialized = JSON.stringify(szProp);
        if (serialized) {
            shape = serialized.length > 200 ? `${serialized.slice(0, 197)}...` : serialized;
        }
    } catch {
        shape = '';
    }
    const frame = firstUserStackFrame();
    if (!shape && !frame) {
        return '';
    }
    const parts: string[] = [];
    if (shape) {
        parts.push(`sz object was ${shape}`);
    }
    if (frame) {
        parts.push(`from ${frame}`);
    }
    return `\n  ${parts.join('  ·  ')}`;
}

/**
 * Set (or clear, with `undefined`) the source location appended to the dev-mode
 * unknown-property warning. Called by the build engines (oxc/babel) around each
 * sz attribute; a balanced clear MUST follow so the location never leaks to an
 * unrelated later transform.
 *
 * @param location - `relativePath:line` (or `relativePath`) to attribute the
 *   warning to, or `undefined` to clear.
 */
export function setSzWarnLocation(location: string | undefined): void {
    szWarnLocation = location;
}

/**
 * Render a `relativePath:line` location string for the unknown-property warning,
 * relative to the project root when one is known. Avoids a `node:path` dependency
 * (this module is also browser-bundled) with a plain prefix strip — good enough
 * for a human-facing diagnostic.
 *
 * @param file - the source filename (typically absolute, as the bundler gives it).
 * @param line - 1-based line of the sz prop, or undefined to omit it.
 * @param rootDir - project root to relativize against, or undefined to keep `file`.
 * @returns `relativePath:line`, `relativePath`, or the raw filename.
 */
export function formatSzWarnLocation(
    file: string,
    line: number | undefined,
    rootDir: string | undefined,
): string {
    let rel = file;
    if (rootDir) {
        // Strip trailing slashes WITHOUT a regex: `/[/\\]+$/` is a polynomial-ReDoS
        // shape (CodeQL js/polynomial-redos) on a path with many trailing slashes.
        // This linear scan is O(n) and intent-identical.
        let end = rootDir.length;
        while (end > 0 && (rootDir[end - 1] === '/' || rootDir[end - 1] === '\\')) {
            end--;
        }
        const root = rootDir.slice(0, end);
        if (file === root) {
            rel = file;
        } else if (file.startsWith(`${root}/`) || file.startsWith(`${root}\\`)) {
            rel = file.slice(root.length + 1);
        }
    }
    return line === undefined ? rel : `${rel}:${line}`;
}

/**
 * Transform an sz object into a className string, bounding recursion depth
 * via {@link szTransformDepth}.
 *
 * @param szProp - the sz object to transform.
 * @param prefix - variant prefix to prepend to emitted classes.
 * @param mangleMap - optional original→mangled class-name map.
 * @returns the emitted className.
 */
export function transform(
    szProp: SzObject,
    prefix = '',
    mangleMap?: Record<string, string>,
): TransformResult {
    // Input validation
    if (!szProp || typeof szProp !== 'object') {
        return { className: '' };
    }
    if (szTransformDepth >= MAX_SZ_DEPTH) {
        throw new SzDepthError();
    }
    szTransformDepth++;
    try {
        return transformImpl(szProp, prefix, mangleMap);
    } finally {
        szTransformDepth--;
    }
}

/** Structured background-gradient sz value. */
interface BackgroundGradientValue {
    gradient?: string;
    dir?: string | number;
    in?: string;
}

/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- Internal gradient stages share the object-syntax contract. */

/** Builds one background-gradient utility from object syntax. */
function buildBackgroundGradientClass(gradient: BackgroundGradientValue): string {
    let className = '';
    if (gradient.gradient === 'linear') {
        className = buildLinearGradientClass(gradient.dir ?? 'to-r');
    } else if (gradient.gradient === 'radial') {
        className = buildRadialGradientClass(gradient.dir);
    } else if (gradient.gradient === 'conic') {
        className = buildConicGradientClass(gradient.dir);
    }
    return className && gradient.in ? `${className}/${gradient.in}` : className;
}

/** Builds a linear background-gradient utility. */
function buildLinearGradientClass(direction: string | number): string {
    if (typeof direction === 'number') {
        return direction < 0 ? `-bg-linear-${Math.abs(direction)}` : `bg-linear-${direction}`;
    }
    if (direction.startsWith('--')) return `bg-linear-(${direction})`;
    if (direction.startsWith('to-')) return `bg-linear-${direction}`;
    return `bg-linear-[${normalizeArbitraryValue(direction)}]`;
}

/** Builds a radial background-gradient utility. */
function buildRadialGradientClass(direction: string | number | undefined): string {
    if (direction === undefined || direction === null) return 'bg-radial';
    if (typeof direction !== 'string') return '';
    return direction.startsWith('--')
        ? `bg-radial-(${direction})`
        : `bg-radial-[${normalizeArbitraryValue(direction)}]`;
}

/** Builds a conic background-gradient utility. */
function buildConicGradientClass(direction: string | number | undefined): string {
    if (direction === undefined || direction === null) return 'bg-conic';
    if (typeof direction === 'number') {
        return direction < 0 ? `-bg-conic-${Math.abs(direction)}` : `bg-conic-${direction}`;
    }
    return direction.startsWith('--')
        ? `bg-conic-(${direction})`
        : `bg-conic-[${normalizeArbitraryValue(direction)}]`;
}

/** Builds a color utility from the `{ color, op }` object syntax. */
function buildColorObjectClass(
    key: string,
    color: { color: string; op?: number | string },
    prefix: string,
): string {
    const utilityPrefix =
        PROPERTY_MAP[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const rawColor = String(color.color);
    const colorValue = formatColorObjectBase(rawColor);
    if (color.op === undefined) return `${prefix}${utilityPrefix}-${colorValue}`;
    const opacity = formatOpacity(color.op);
    warnCustomOpacityToken(rawColor, `${prefix}${utilityPrefix}-${colorValue}/${opacity}`, opacity);
    return `${prefix}${utilityPrefix}-${colorValue}/${opacity}`;
}

/** Formats a color-object base using Tailwind variable and arbitrary syntax. */
function formatColorObjectBase(color: string): string {
    if (isTailwindBuildFunction(color) || (color.startsWith('--') && color.includes('('))) {
        return `[${normalizeArbitraryValue(color)}]`;
    }
    if (color.startsWith('--')) return `(${color})`;
    return needsArbitraryBrackets(color)
        ? `[${normalizeArbitraryValue(color)}]`
        : normalizeArbitraryValue(color);
}

/** Warns when a custom theme token may ignore an opacity modifier. */
function warnCustomOpacityToken(color: string, className: string, opacity: string): void {
    if (
        !szDevWarningsEnabled() ||
        color.startsWith('--') ||
        needsArbitraryBrackets(color) ||
        /-\d{2,3}$/.test(color) ||
        ALPHA_SAFE_NAMED_COLORS.has(color) ||
        _warnedOpacityTokens.has(color)
    ) {
        return;
    }
    _warnedOpacityTokens.add(color);
    const at = szWarnLocation ? ` at ${szWarnLocation}` : '';
    console.warn(
        `[csszyx] "${className}"${at}: the /${opacity} opacity applies only if the ` +
            `"${color}" theme token is alpha-capable (oklch or space-separated RGB). ` +
            'A comma-separated RGB triplet, or a token that resolves through its own alpha ' +
            'variable, silently ignores the modifier — verify the emitted rule.',
    );
}

/** Dispatches nested variants that use custom Tailwind syntax. */
function collectSpecialNestedVariant(
    key: string,
    value: SzObject,
    prefix: string,
): string[] | null {
    switch (key) {
        case 'group':
            return handleGroupPeer('group', value, prefix);
        case 'peer':
            return handleGroupPeer('peer', value, prefix);
        case 'has':
            return handleHas(value, prefix);
        case 'not':
            return handleNot(value, prefix);
        case 'data':
            return handleData(value, prefix);
        case 'aria':
            return handleAria(value, prefix);
        case 'supports':
            return handleSupports(value, prefix);
        default:
            return null;
    }
}

const KNOWN_BREAKPOINTS = new Set(['sm', 'md', 'lg', 'xl', '2xl']);

/** Collects named and arbitrary min/max breakpoint variants. */
function collectMinMaxVariants(
    kind: 'min' | 'max',
    breakpoints: SzObject,
    prefix: string,
    classes: string[],
): void {
    for (const [breakpoint, value] of Object.entries(breakpoints)) {
        if (isInactiveVariantValue(value)) continue;
        const direct = isArbitraryVariant(breakpoint) || KNOWN_BREAKPOINTS.has(breakpoint);
        const segment = direct ? `${kind}-${breakpoint}` : `${kind}-[${breakpoint}]`;
        appendVariantClasses(value, `${prefix}${segment}:`, classes);
    }
}

/** Validates and diagnoses one string-valued color property. */
function validateColorPropertyString(key: string, value: string): boolean {
    if (hasSlashOpacity(value)) {
        warnStringColorOpacity(key, value);
        return false;
    }
    if (isValidColorString(value)) return true;
    if (szDevWarningsEnabled()) {
        console.warn(
            `[csszyx] "${key}: '${value}'" is not a recognized color value and will be ignored. ` +
                'Use a Tailwind color ("blue-500"), CSS variable ("--my-color"), ' +
                'hex/rgb/hsl ("#ff0000"), or object form ({ color: "blue-500", op: 50 }).',
        );
    }
    return false;
}

/** Warns that slash opacity requires color-object syntax. */
function warnStringColorOpacity(key: string, value: string): void {
    if (!szDevWarningsEnabled()) return;
    const slash = value.indexOf('/');
    console.warn(
        `[csszyx] "${key}: '${value}'" — string slash opacity is not supported. ` +
            `Use object form: { color: '${value.slice(0, slash)}', op: ${value.slice(slash + 1)} }.`,
    );
}

/** Collects direct, named, and arbitrary container-query variants. */
function collectContainerQueryVariants(
    key: string,
    values: SzObject,
    prefix: string,
    classes: string[],
): void {
    const mappedKey = VARIANT_MAP[key] || key;
    for (const [nestedKey, value] of Object.entries(values)) {
        if (isInactiveVariantValue(value)) continue;
        const target = resolveContainerQueryTarget(mappedKey, nestedKey, value);
        if (target.wrapProperty) {
            appendVariantClasses({ [nestedKey]: value }, `${prefix}${target.segment}:`, classes);
        } else {
            appendVariantClasses(value, `${prefix}${target.segment}:`, classes);
        }
    }
}

/** Container-query prefix plus whether the nested key remains a property. */
interface ContainerQueryTarget {
    segment: string;
    wrapProperty: boolean;
}

/** Classifies one nested container-query key. */
function resolveContainerQueryTarget(
    mappedKey: string,
    nestedKey: string,
    value: SzValue,
): ContainerQueryTarget {
    if (isArbitraryVariant(nestedKey)) {
        return { segment: `${mappedKey}-${nestedKey}`, wrapProperty: false };
    }
    if (isArbitraryContainerBreakpoint(mappedKey, nestedKey, value)) {
        return { segment: `${mappedKey}-[${nestedKey}]`, wrapProperty: false };
    }
    const direct =
        PROPERTY_MAP[nestedKey] ||
        BOOLEAN_SHORTHANDS.has(nestedKey) ||
        nestedKey.startsWith('@') ||
        typeof value !== 'object';
    return direct
        ? { segment: mappedKey, wrapProperty: true }
        : { segment: `${mappedKey}/${nestedKey}`, wrapProperty: false };
}

/** Returns whether @min/@max should bracket a custom breakpoint key. */
function isArbitraryContainerBreakpoint(
    mappedKey: string,
    nestedKey: string,
    value: SzValue,
): boolean {
    return (
        (mappedKey === '@min' || mappedKey === '@max') &&
        typeof value === 'object' &&
        !KNOWN_BREAKPOINTS.has(nestedKey) &&
        !PROPERTY_MAP[nestedKey] &&
        !BOOLEAN_SHORTHANDS.has(nestedKey)
    );
}

/* eslint-enable jsdoc/require-param, jsdoc/require-returns */

/**
 * Depth-unchecked transform body. Called by {@link transform} once the depth
 * guard has been applied.
 *
 * @param szProp - the sz object to transform.
 * @param prefix - variant prefix to prepend to emitted classes.
 * @param mangleMap - optional original→mangled class-name map.
 * @returns the emitted className.
 */
function transformImpl(
    szProp: SzObject,
    prefix: string,
    mangleMap?: Record<string, string>,
): TransformResult {
    const classes: string[] = [];

    for (const [rawKey, value] of Object.entries(szProp)) {
        // Skip false/null/undefined values (a false toggle emits nothing).
        if (value === false || value === null || value === undefined) {
            continue;
        }

        // Dev: flag an alignment prop given a CSS-longhand value (dead class).
        warnAlignmentValue(rawKey, value);

        // Removed boolean-sugar keys (flex/absolute/italic/...): emit nothing and,
        // in dev, point to the canonical form. Only the boolean `true` form was sugar;
        // `flex` also names the flex-grow shorthand (`flex: 1`, `flex: 'auto'`), which is
        // NOT sugar and must pass through, so the intercept is guarded on `value === true`.
        // The canonical key is one-per-property, so duplicates like
        // { position:'absolute', relative:true } can no longer occur.
        if (value === true) {
            const removed = REMOVED_BOOLEAN_SUGAR[rawKey];
            if (removed) {
                if (szDevWarningsEnabled()) {
                    console.warn(
                        `[csszyx] "${rawKey}" boolean sugar was removed. Use ` +
                            `{ ${removed.key}: '${removed.value}' } instead, or run \`csszyx migrate\`.`,
                    );
                }
                continue;
            }
        }

        // ================================================================
        // css: {} — Arbitrary CSS sub-prop
        // Escape hatch for CSS properties with no sz/Tailwind equivalent.
        // { css: { writingMode: 'vertical-lr' } } → [writing-mode:vertical-lr]
        // { css: { '--my-color': 'red' } } → [--my-color:red]
        // Works inside variants via recursion (hover: { css: { cursor: 'crosshair' } })
        // ================================================================
        if (rawKey === 'css') {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                for (const [cssProp, cssVal] of Object.entries(value as Record<string, unknown>)) {
                    if (cssVal === null || cssVal === undefined) {
                        continue;
                    }
                    const kebab = camelToKebab(cssProp);
                    classes.push(`${prefix}[${kebab}:${normalizeArbitraryValue(String(cssVal))}]`);
                }
            }
            continue;
        }

        // { @container: "sidebar" } → @container/sidebar (string value with @ prefix)
        if (rawKey.startsWith('@') && typeof value === 'string') {
            const mappedKey = VARIANT_MAP[rawKey] || rawKey;
            classes.push(`${prefix}${mappedKey}/${value}`);
            continue;
        }

        // ================================================================
        // HANDLE bgImg OBJECT SYNTAX (before variant nesting)
        // { bgImg: { gradient: 'linear', dir: 'to-r', in: 'hsl' } } → bg-linear-to-r/hsl
        // ================================================================
        if (
            rawKey === 'bgImg' &&
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value)
        ) {
            const gradient = buildBackgroundGradientClass(
                value as { gradient?: string; dir?: string | number; in?: string },
            );
            if (gradient) classes.push(`${prefix}${gradient}`);
            continue;
        }

        // ================================================================
        // HANDLE NAMED GROUP/PEER (string value → group/name, peer/name)
        // ================================================================
        if ((rawKey === 'group' || rawKey === 'peer') && typeof value === 'string') {
            classes.push(`${prefix}${rawKey}/${value}`);
            continue;
        }

        // ================================================================
        // HANDLE COLOR OBJECT SYNTAX (before variant nesting)
        // { bg: { color: 'red-500', op: 40 } } → bg-red-500/40
        // ================================================================
        if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            rawKey in PROPERTY_MAP &&
            'color' in (value as Record<string, unknown>)
        ) {
            classes.push(
                buildColorObjectClass(
                    rawKey,
                    value as { color: string; op?: number | string },
                    prefix,
                ),
            );
            continue;
        }

        // ================================================================
        // VALIDATE STRING VALUES FOR COLOR PROPERTIES
        // Slash opacity → warn + suppress (use object form instead)
        // Unrecognized pattern → warn + suppress
        // This runs before all specific property handlers, covering all
        // 18 COLOR-category properties uniformly via PROPERTY_CATEGORY_MAP.
        // ================================================================
        if (typeof value === 'string' && PROPERTY_CATEGORY_MAP[rawKey] === PropertyCategory.COLOR) {
            if (!validateColorPropertyString(rawKey, value.replace(/!$/, ''))) continue;
        }

        // ================================================================
        // HANDLE NESTED OBJECTS (VARIANTS)
        // ================================================================
        if (typeof value === 'object' && !Array.isArray(value)) {
            const specialClasses = collectSpecialNestedVariant(rawKey, value as SzObject, prefix);
            if (specialClasses !== null) {
                classes.push(...specialClasses);
                continue;
            }

            // Handle min/max breakpoints with arbitrary values
            // { min: { '320px': { ... }}} → min-[320px]:...
            // { min: { md: { ... }}} → min-md:...
            // { min: { '[320px]': { ... }}} → min-[320px]:... (legacy bracket keys still work)
            if (rawKey === 'min' || rawKey === 'max') {
                collectMinMaxVariants(rawKey, value as SzObject, prefix, classes);
                continue;
            }

            // Handle container queries with @ prefix
            // { @md: { flex: true }} → @md:flex (direct property)
            // { @md: { sidebar: { ... }}} → @md/sidebar:... (named container)
            // { @min: { "[475px]": { ... }}} → @min-[475px]:...
            if (rawKey.startsWith('@')) {
                collectContainerQueryVariants(rawKey, value as SzObject, prefix, classes);
                continue;
            }

            // Handle arbitrary variants (Fix #5)
            if (isArbitraryVariant(rawKey)) {
                const normalizedKey = normalizeArbitraryVariant(rawKey);
                const nestedPrefix = `${prefix}${normalizedKey}:`;
                const nestedResult = transform(value as SzObject, nestedPrefix);
                if (nestedResult.className) {
                    classes.push(nestedResult.className);
                }
                continue;
            }

            // Standard variant handling
            const variantName = getVariantPrefix(rawKey);
            const nestedPrefix = `${prefix}${variantName}:`;
            const nestedResult = transform(value as SzObject, nestedPrefix);
            if (nestedResult.className) {
                classes.push(nestedResult.className);
            }
            continue;
        }

        // Check snap direct mappings
        if (SNAP_DIRECT_MAP[rawKey] && typeof value === 'string') {
            const mapped = SNAP_DIRECT_MAP[rawKey][value as string];
            if (mapped) {
                classes.push(`${prefix}${mapped}`);
                continue;
            }
        }

        // ================================================================
        // HANDLE STRING VALUES THAT ARE ACTUALLY VARIANT SHORTCUTS
        // ================================================================
        // e.g., { hover: "bg-sky-700" } → hover:bg-sky-700
        if (typeof value === 'string' && KNOWN_VARIANTS.has(rawKey)) {
            const variantName = getVariantPrefix(rawKey);
            classes.push(`${prefix}${variantName}:${value}`);
            continue;
        }

        // ================================================================
        // HANDLE CSS CUSTOM PROPERTY DECLARATIONS
        // ================================================================
        // { "--my-var": "10px" } → [--my-var:10px]
        if (rawKey.startsWith('--')) {
            classes.push(`${prefix}[${rawKey}:${value}]`);
            continue;
        }

        // ================================================================
        // HANDLE CONTAINER PROPERTY
        // ================================================================
        // { container: true } → container (the utility class)
        // { container: "sidebar" } → @container/sidebar (named container)
        if (rawKey === 'container') {
            if (value === true) {
                classes.push(`${prefix}container`);
            } else if (typeof value === 'string') {
                classes.push(`${prefix}@container/${value}`);
            }
            continue;
        }

        // ================================================================
        // RESOLVE PROPERTY NAME
        // ================================================================
        let key = rawKey;
        if (PROPERTY_MAP[key]) {
            key = PROPERTY_MAP[key];
        } else {
            // Fallback: Convert camelCase to kebab-case
            key = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        }

        let className = prefix;

        // ================================================================
        // HANDLE SPECIAL PROPERTIES
        // ================================================================

        // Handle will-change (opt-in mapping)
        if (rawKey === 'willChange' && typeof value === 'string') {
            const WILL_CHANGE_KEYWORDS = new Set(['auto', 'scroll', 'contents', 'transform']);
            if (WILL_CHANGE_KEYWORDS.has(value)) {
                classes.push(`${prefix}will-change-${value}`);
            } else if (value.startsWith('--')) {
                classes.push(`${prefix}will-change-(${value})`);
            } else {
                classes.push(`${prefix}will-change-[${normalizeArbitraryValue(value)}]`);
            }
            continue;
        }

        // Handle display property (special mapping)
        if (key === 'display') {
            if (typeof value === 'string') {
                if (value === 'none') {
                    className += 'hidden';
                } else {
                    className += value;
                }
                classes.push(className);
                continue;
            }
        }

        // Handle position property (direct value)
        if (key === 'position') {
            if (typeof value === 'string') {
                className += value;
                classes.push(className);
                continue;
            }
        }

        // Handle visibility property (direct value mapping)
        // { visibility: "visible" } → visible
        // { visibility: "hidden" } → invisible
        // { visibility: "collapse" } → collapse
        if (key === 'visibility') {
            if (typeof value === 'string') {
                if (value === 'hidden') {
                    className += 'invisible';
                } else {
                    className += value; // visible, collapse
                }
                classes.push(className);
                continue;
            }
        }

        // Handle isolation property (direct value only for "isolate")
        // { isolation: "isolate" } → isolate
        // { isolation: "auto" } → isolation-auto
        if (key === 'isolation') {
            if (typeof value === 'string') {
                if (value === 'isolate') {
                    className += 'isolate';
                } else {
                    className += `isolation-${value}`;
                }
                classes.push(className);
                continue;
            }
        }

        // ================================================================
        // HANDLE fromPos/viaPos/toPos NUMBER VALUES
        // { fromPos: 50 } → from-50%, { viaPos: 30 } → via-30%, { toPos: 100 } → to-100%
        // ================================================================
        if (
            (rawKey === 'fromPos' || rawKey === 'viaPos' || rawKey === 'toPos') &&
            typeof value === 'number'
        ) {
            const gradPrefix = rawKey.replace('Pos', '');
            classes.push(`${prefix}${gradPrefix}-${value}%`);
            continue;
        }

        // ================================================================
        // HANDLE DIRECT OUTPUT PROPERTIES (shorthands)
        // ================================================================
        if (typeof value === 'string') {
            // decoration: 'underline' | 'overline' | 'line-through' | 'no-underline' → direct output
            if (rawKey === 'decoration') {
                if (
                    ['underline', 'overline', 'line-through', 'no-underline', 'none'].includes(
                        value,
                    )
                ) {
                    className += value === 'none' ? 'no-underline' : value;
                    classes.push(className);
                    continue;
                }
            }

            // textTransform: 'uppercase' | 'lowercase' | 'capitalize' | 'normal-case' → direct
            // output. The CSS off-value `none` is accepted as an alias for normal-case (its
            // Tailwind class), since text-transform: none is what normal-case emits.
            if (rawKey === 'textTransform') {
                if (['uppercase', 'lowercase', 'capitalize'].includes(value)) {
                    className += value;
                    classes.push(className);
                    continue;
                }
                if (value === 'normal-case' || value === 'none') {
                    className += 'normal-case';
                    classes.push(className);
                    continue;
                }
            }

            // fontStyle: 'italic' → italic, 'normal' → not-italic. Tailwind only models these
            // two; oblique has no class. The handler is closed — an unsupported value warns and
            // emits nothing rather than falling through to a broken `font-style-*` class.
            if (rawKey === 'fontStyle') {
                if (value === 'italic') {
                    className += 'italic';
                    classes.push(className);
                    continue;
                }
                if (value === 'normal') {
                    className += 'not-italic';
                    classes.push(className);
                    continue;
                }
                if (szDevWarningsEnabled()) {
                    console.warn(
                        `[csszyx] fontStyle: '${value}' is not supported — Tailwind only models ` +
                            `'italic' and 'normal'. For oblique, use css: { fontStyle: '${value}' }.`,
                    );
                }
                continue;
            }

            // fontSmoothing: 'grayscale' → antialiased, 'subpixel' → subpixel-antialiased.
            // Both set -webkit-/-moz- font-smoothing; the values name the rendering technique
            // (grayscale vs subpixel/RGB) rather than Tailwind's misleading "antialiased" name.
            // Closed handler — an unsupported value warns and emits nothing.
            if (rawKey === 'fontSmoothing') {
                if (value === 'grayscale') {
                    className += 'antialiased';
                    classes.push(className);
                    continue;
                }
                if (value === 'subpixel') {
                    className += 'subpixel-antialiased';
                    classes.push(className);
                    continue;
                }
                if (szDevWarningsEnabled()) {
                    console.warn(
                        `[csszyx] fontSmoothing: '${value}' is not supported — use ` +
                            `'grayscale' or 'subpixel'.`,
                    );
                }
                continue;
            }

            // fontVariant: 'normal-nums' | 'ordinal' | etc → direct output
            if (rawKey === 'fontVariant') {
                const FONT_VARIANT_CLASSES = new Set([
                    'normal-nums',
                    'ordinal',
                    'slashed-zero',
                    'lining-nums',
                    'oldstyle-nums',
                    'proportional-nums',
                    'tabular-nums',
                    'diagonal-fractions',
                    'stacked-fractions',
                ]);
                if (FONT_VARIANT_CLASSES.has(value)) {
                    className += value;
                    classes.push(className);
                    continue;
                }
            }

            // textWrap: 'wrap' | 'nowrap' | 'balance' | 'pretty' → text-wrap, text-nowrap, etc.
            if (rawKey === 'textWrap') {
                className += `text-${value}`;
                classes.push(className);
                continue;
            }

            // break: 'normal' | 'all' | 'keep' → break-normal, break-all, break-keep
            if (rawKey === 'break') {
                const wbMap: Record<string, string> = {
                    normal: 'break-normal',
                    all: 'break-all',
                    keep: 'break-keep',
                    'break-normal': 'break-normal',
                    'break-all': 'break-all',
                    'break-keep': 'break-keep',
                };
                className += wbMap[value] || `break-${value}`;
                classes.push(className);
                continue;
            }

            // wrap: 'normal' | 'break-word' | 'anywhere' → wrap-normal, wrap-break-word, wrap-anywhere
            if (rawKey === 'wrap') {
                const owMap: Record<string, string> = {
                    normal: 'wrap-normal',
                    'break-word': 'wrap-break-word',
                    anywhere: 'wrap-anywhere',
                    'wrap-normal': 'wrap-normal',
                    'wrap-break-word': 'wrap-break-word',
                    'wrap-anywhere': 'wrap-anywhere',
                };
                className += owMap[value] || `wrap-${value}`;
                classes.push(className);
                continue;
            }

            // textOverflow: 'ellipsis' → text-ellipsis, 'clip' → text-clip
            if (rawKey === 'textOverflow') {
                if (value === 'ellipsis' || value === 'clip') {
                    classes.push(`${prefix}text-${value}`);
                } else {
                    classes.push(`${prefix}text-[${value}]`);
                }
                continue;
            }

            // Fix 4: Line Clamp 7+ Arbitrary
            if (rawKey === 'lineClamp') {
                const sValue = String(value);
                if (sValue === 'none') {
                    className += 'line-clamp-none';
                } else if (sValue.startsWith('--')) {
                    className += `line-clamp-(${sValue})`;
                } else {
                    // Tailwind v4: line-clamp accepts any number dynamically
                    const numVal = Number(sValue);
                    if (!Number.isNaN(numVal) && Number.isInteger(numVal)) {
                        className += `line-clamp-${sValue}`;
                    } else {
                        className += `line-clamp-[${sValue}]`;
                    }
                }
                classes.push(className);
                continue;
            }

            // Fix 5: List Style Arbitrary
            if (rawKey === 'list' || rawKey === 'listStyle') {
                const sValue = String(value);
                if (sValue.startsWith('--')) {
                    className += `list-(${sValue})`;
                } else if (LIST_STYLE_STANDARD.has(sValue)) {
                    className += `list-${sValue}`;
                } else {
                    className += `list-[${sValue}]`;
                }
                classes.push(className);
                continue;
            }

            // listPosition: 'inside' | 'outside' → list-inside, list-outside
            if (rawKey === 'listPos') {
                className += `list-${value}`;
                classes.push(className);
                continue;
            }

            // divideStyle: 'solid' | 'dashed' | etc → divide-solid, divide-dashed
            if (rawKey === 'divideStyle') {
                className += `divide-${value}`;
                classes.push(className);
                continue;
            }

            // decorationStyle: 'solid' | 'dashed' | etc → decoration-solid, decoration-dashed
            if (rawKey === 'decorationStyle' || rawKey === 'textDecorationStyle') {
                className += `decoration-${value}`;
                classes.push(className);
                continue;
            }

            // decorationColor: 'red-500' → decoration-red-500
            if (rawKey === 'decorationColor' || rawKey === 'textDecorationColor') {
                className += `decoration-${value}`;
                classes.push(className);
                continue;
            }

            // decorationThickness: '2' | '3px' → decoration-2, decoration-[3px]
            if (rawKey === 'decorationThickness' || rawKey === 'textDecorationThickness') {
                if (needsArbitraryBrackets(value)) {
                    className += `decoration-[${normalizeArbitraryValue(value)}]`;
                } else if (value.startsWith('--')) {
                    className += `decoration-(${value})`;
                } else {
                    className += `decoration-${value}`;
                }
                classes.push(className);
                continue;
            }

            // fontStretch: '50%' | '125%' → font-stretch-50%, font-stretch-[125%]
            // fontStretch: '50%' | '125%' → font-stretch-50%, font-stretch-[125%]
            // Fix 6: Font Stretch Keywords
            if (rawKey === 'fontStretch') {
                const sValue = String(value);
                if (FONT_STRETCH_KEYWORDS.has(sValue)) {
                    // Keywords use font- prefix: font-ultra-condensed
                    className += `font-${sValue}`;
                } else if (sValue.startsWith('--')) {
                    className += `font-stretch-(${sValue})`;
                } else if (/^\d+(\.\d+)?%$/.test(sValue)) {
                    // Percentage values: font-stretch-50%, font-stretch-[110%]
                    const valNum = parseFloat(sValue);
                    // Standard tailwind v4 values don't need brackets
                    if (sValue.includes('.') || !Number.isInteger(valNum)) {
                        className += `font-stretch-[${sValue}]`;
                    } else {
                        className += `font-stretch-${sValue}`;
                    }
                } else {
                    className += `font-stretch-[${sValue}]`;
                }
                classes.push(className);
                continue;
            }

            // Fix 12: maxW: 'container' Sugar
            if (rawKey === 'maxW' && value === 'container') {
                classes.push('container');
                continue;
            }

            // Fix 8: Shadow Color
            if (rawKey === 'shadowColor') {
                if (String(value).startsWith('--')) {
                    classes.push(`shadow-(color:${value})`);
                } else {
                    classes.push(`shadow-${value}`);
                }
                continue;
            }

            // insetShadowColor: 'red-500' → inset-shadow-red-500
            if (rawKey === 'insetShadowColor') {
                if (String(value).startsWith('--')) {
                    classes.push(`${prefix}inset-shadow-(color:${value})`);
                } else {
                    classes.push(`${prefix}inset-shadow-${value}`);
                }
                continue;
            }

            // Fix 2: Brightness/Contrast/Saturate/Scale — strings are NEVER parsed as numbers
            if (
                rawKey === 'brightness' ||
                rawKey === 'contrast' ||
                rawKey === 'saturate' ||
                rawKey === 'scale' ||
                rawKey === 'backdropBrightness' ||
                rawKey === 'backdropContrast' ||
                rawKey === 'backdropSaturate'
            ) {
                const prop = rawKey.startsWith('backdrop')
                    ? `backdrop-${rawKey.slice(8).toLowerCase()}`
                    : rawKey;
                const sValue = String(value);
                if (sValue === '3d' && rawKey === 'scale') {
                    classes.push(`${prefix}scale-3d`);
                } else if (sValue.startsWith('--')) {
                    classes.push(`${prop}-(${sValue})`);
                } else {
                    // String values always go to arbitrary []
                    classes.push(`${prop}-[${sValue}]`);
                }
                continue;
            }
            // textShadow: 'sm' | 'md' → text-shadow (default), text-shadow-sm, etc.
            if (rawKey === 'textShadow') {
                if (value === 'none') {
                    className += 'text-shadow-none';
                } else if (value === '') {
                    className += 'text-shadow';
                } else if (needsArbitraryBrackets(value)) {
                    className += `text-shadow-[${normalizeArbitraryValue(value)}]`;
                } else {
                    className += `text-shadow-${value}`;
                }
                classes.push(className);
                continue;
            }

            // textShadowColor: 'blue-500' → text-shadow-blue-500
            if (rawKey === 'textShadowColor') {
                className += `text-shadow-${value}`;
                classes.push(className);
                continue;
            }

            // fromPos/viaPos/toPos: '10%' → from-10%, to-50%, etc.
            // Tailwind v4: any integer % is dynamic (bare), decimals need brackets
            if (rawKey === 'fromPos' || rawKey === 'viaPos' || rawKey === 'toPos') {
                const gradPrefix = rawKey.replace('Pos', '');
                const sValue = String(value);
                if (value.startsWith('--')) {
                    classes.push(`${gradPrefix}-(${value})`);
                } else if (/^\d+%$/.test(sValue)) {
                    // Integer percentage: bare (e.g. from-15%, to-88%)
                    classes.push(`${gradPrefix}-${sValue}`);
                } else {
                    // Decimal percentage or other: brackets (e.g. from-[13.5%])
                    classes.push(`${gradPrefix}-[${sValue}]`);
                }
                continue;
            }

            // bgImg handler
            if (rawKey === 'bgImg') {
                const v = String(value).trim();
                // Keywords
                if (v === 'none') {
                    classes.push(`${prefix}bg-none`);
                    continue;
                }
                // Gradient prefixes: linear-*, radial*, conic* (with optional negative)
                // v3 compat: gradient-to-* → linear-to-* (v4 renamed bg-gradient-to-* to bg-linear-to-*)
                // repeating-*-gradient → arbitrary bg-[repeating-*-gradient(...)] (no Tailwind utility)
                const vNorm = v.startsWith('-') ? v.slice(1) : v;
                if (vNorm.startsWith('repeating-')) {
                    classes.push(`${prefix}bg-[${normalizeArbitraryValue(v)}]`);
                    continue;
                }
                if (
                    vNorm.startsWith('linear-') ||
                    vNorm.startsWith('radial') ||
                    vNorm.startsWith('conic') ||
                    vNorm.startsWith('gradient-to-')
                ) {
                    const vMapped = vNorm.startsWith('gradient-to-')
                        ? vNorm.replace('gradient-to-', 'linear-to-')
                        : vNorm;
                    if (v.startsWith('-')) {
                        classes.push(`${prefix}-bg-${vMapped}`);
                    } else {
                        classes.push(`${prefix}bg-${vMapped}`);
                    }
                    continue;
                }
                // CSS variable
                if (v.startsWith('--')) {
                    classes.push(`${prefix}bg-(image:${v})`);
                    continue;
                }
                // Already has url()
                if (v.startsWith('url(')) {
                    classes.push(`${prefix}bg-[${v}]`);
                    continue;
                }
                // Arbitrary URL
                classes.push(`${prefix}bg-[url(${v})]`);
                continue;
            }

            // bgPos: 'center' → bg-center, 'center_top_1rem' → bg-[center_top_1rem]
            if (rawKey === 'bgPos') {
                const sVal = String(value);
                if (sVal.startsWith('--')) {
                    classes.push(`${prefix}bg-(${sVal})`);
                } else if (sVal.includes('_') || needsArbitraryBrackets(sVal)) {
                    classes.push(`${prefix}bg-[${normalizeArbitraryValue(sVal)}]`);
                } else {
                    classes.push(`${prefix}bg-${sVal}`);
                }
                continue;
            }

            // bgSize: Tailwind v4 uses bg-size-[<value>] for arbitrary background-size.
            // Keywords (auto/cover/contain) stay as bg-auto/bg-cover/bg-contain via generic map.
            if (rawKey === 'bgSize') {
                const sVal = String(value);
                if (sVal === 'auto' || sVal === 'cover' || sVal === 'contain') {
                    classes.push(`${prefix}bg-${sVal}`);
                } else if (sVal.startsWith('--')) {
                    classes.push(`${prefix}bg-size-(${sVal})`);
                } else {
                    classes.push(`${prefix}bg-size-[${normalizeArbitraryValue(sVal)}]`);
                }
                continue;
            }

            // maskPos: 'center' → mask-center
            if (rawKey === 'maskPos') {
                className += `mask-${value}`;
                classes.push(className);
                continue;
            }

            // maskRepeat: 'repeat' → mask-repeat (not mask-repeat-repeat)
            if (rawKey === 'maskRepeat') {
                if (value === 'repeat') {
                    className += 'mask-repeat';
                } else if (value === 'no-repeat') {
                    className += 'mask-no-repeat';
                } else {
                    className += `mask-${value}`;
                }
                classes.push(className);
                continue;
            }

            // bgRepeat: 'repeat' → bg-repeat
            if (rawKey === 'bgRepeat' || rawKey === 'backgroundRepeat') {
                if (value === 'repeat') {
                    className += 'bg-repeat';
                } else if (value === 'no-repeat') {
                    className += 'bg-no-repeat';
                } else {
                    // Strip optional 'repeat-' prefix so both 'x' and 'repeat-x' produce bg-repeat-x.
                    // Canonical sz form is the TW suffix ('x', 'y', 'space', 'round') for consistency.
                    const suffix = value.startsWith('repeat-') ? value.slice(7) : value;
                    className += `bg-repeat-${suffix}`;
                }
                classes.push(className);
                continue;
            }

            // maskSize: 'cover' | 'contain' | 'auto' → mask-auto, mask-cover, mask-contain
            if (rawKey === 'maskSize') {
                className += `mask-${value}`;
                classes.push(className);
                continue;
            }

            // maskShape: 'circle' | 'ellipse' → mask-circle, mask-ellipse
            if (rawKey === 'maskShape') {
                className += `mask-${value}`;
                classes.push(className);
                continue;
            }

            // maskComposite: 'add' | 'subtract' | etc → mask-add, mask-subtract
            if (rawKey === 'maskComposite') {
                className += `mask-${value}`;
                classes.push(className);
                continue;
            }

            // maskMode: 'alpha' | 'luminance' | 'match-source' → mask-alpha, mask-luminance
            if (rawKey === 'maskMode') {
                className += `mask-${value}`;
                classes.push(className);
                continue;
            }

            // maskType: 'alpha' | 'luminance' → mask-type-alpha, mask-type-luminance
            if (rawKey === 'maskType') {
                className += `mask-type-${value}`;
                classes.push(className);
                continue;
            }

            // alignContent → align-content via Tailwind content-* classes.
            if (rawKey === 'alignContent') {
                className += `content-${value}`;
                classes.push(className);
                continue;
            }

            // content → CSS content property (for ::before / ::after).
            // Values are arbitrary strings so must be wrapped: content-['hello'].
            // Keeping separate from alignContent eliminates the naming collision:
            // { alignContent: 'between', content: "''" } now works on one element.
            if (rawKey === 'content') {
                if (value === 'none') {
                    className += 'content-none';
                } else if (value.startsWith('--')) {
                    className += `content-(${value})`;
                } else {
                    // Tailwind convention: content arbitrary values use single quotes → content-['hello'].
                    // Normalize double-quote CSS strings to single-quote so both forms produce a
                    // consistent class name that Tailwind JIT actually generates CSS for.
                    const inner =
                        value.startsWith('"') && value.endsWith('"') && value.length >= 2
                            ? `'${value.slice(1, -1)}'`
                            : value;
                    className += `content-[${inner}]`;
                }
                classes.push(className);
                continue;
            }

            // Border side colors: borderTColor → border-t-{color}
            if (rawKey === 'borderTColor') {
                className += `border-t-${value}`;
                classes.push(className);
                continue;
            }
            if (rawKey === 'borderRColor') {
                className += `border-r-${value}`;
                classes.push(className);
                continue;
            }
            if (rawKey === 'borderBColor') {
                className += `border-b-${value}`;
                classes.push(className);
                continue;
            }
            if (rawKey === 'borderLColor') {
                className += `border-l-${value}`;
                classes.push(className);
                continue;
            }
            if (rawKey === 'borderXColor') {
                className += `border-x-${value}`;
                classes.push(className);
                continue;
            }
            if (rawKey === 'borderYColor') {
                className += `border-y-${value}`;
                classes.push(className);
                continue;
            }

            // transitionBehavior: 'discrete' | 'normal' → transition-discrete, transition-normal
            if (rawKey === 'transitionBehavior') {
                className += `transition-${value}`;
                classes.push(className);
                continue;
            }

            // dropShadowColor: 'red-500' → drop-shadow-red-500
            if (rawKey === 'dropShadowColor') {
                if (value.startsWith('--')) {
                    className += `drop-shadow-(color:${value})`;
                } else {
                    className += `drop-shadow-${value}`;
                }
                classes.push(className);
                continue;
            }

            // Fix 10: Properties that need arbitrary brackets for complex values
            // (contains parens, underscores, % in multi-part values, etc.)
            if (
                rawKey === 'origin' ||
                rawKey === 'ease' ||
                rawKey === 'animate' ||
                rawKey === 'filter' ||
                rawKey === 'backdropFilter' ||
                rawKey === 'dropShadow'
            ) {
                const sVal = String(value);
                const prop = PROPERTY_MAP[rawKey] || rawKey;
                if (
                    needsArbitraryBrackets(sVal) ||
                    sVal.includes('(') ||
                    sVal.includes('_') ||
                    sVal.includes('%')
                ) {
                    classes.push(`${className}${prop}-[${normalizeArbitraryValue(sVal)}]`);
                    continue;
                }
            }

            // transformStyle: 'flat' | '3d' → transform-flat, transform-3d
            if (rawKey === 'transformStyle') {
                className += `transform-${value}`;
                classes.push(className);
                continue;
            }

            // perspective: keywords → perspective-*, values → perspective-[value]
            if (rawKey === 'perspective') {
                const STANDARD_PERSPECTIVE = new Set(['none', 'normal', 'dramatic', 'midrange']);
                if (STANDARD_PERSPECTIVE.has(value)) {
                    className += `perspective-${value}`;
                } else if (value.startsWith('--')) {
                    className += `perspective-(${value})`;
                } else if (needsArbitraryBrackets(value)) {
                    className += `perspective-[${normalizeArbitraryValue(value)}]`;
                } else {
                    className += `perspective-${value}`;
                }
                classes.push(className);
                continue;
            }

            // perspectiveOrigin: 'center' | '33%_75%' → perspective-origin-center, perspective-origin-[33%_75%]
            if (rawKey === 'perspectiveOrigin') {
                const STANDARD_ORIGINS = new Set([
                    'center',
                    'top',
                    'right',
                    'bottom',
                    'left',
                    'top-left',
                    'top-right',
                    'bottom-left',
                    'bottom-right',
                ]);
                if (STANDARD_ORIGINS.has(value)) {
                    className += `perspective-origin-${value}`;
                } else {
                    className += `perspective-origin-[${normalizeArbitraryValue(value)}]`;
                }
                classes.push(className);
                continue;
            }

            // backfaceVisibility: 'hidden' | 'visible' → backface-hidden, backface-visible
            if (rawKey === 'backface') {
                className += `backface-${value}`;
                classes.push(className);
                continue;
            }
        }

        // ================================================================
        // GENERIC / FALLBACK HANDLERS
        // ================================================================

        // Dev-mode warning for unknown properties
        if (szDevWarningsEnabled()) {
            // Check if key is known
            // We use 'key' (resolved kebab-case) for some checks, 'rawKey' for others
            const isKnown =
                PROPERTY_MAP[rawKey] ||
                BOOLEAN_SHORTHANDS.has(rawKey) ||
                SNAP_DIRECT_MAP[rawKey] ||
                rawKey === 'fromPos' ||
                rawKey === 'viaPos' ||
                rawKey === 'toPos' ||
                rawKey.startsWith('--') ||
                rawKey.startsWith('[') ||
                rawKey.startsWith('@') ||
                // Variants that fell through (e.g. empty object)
                KNOWN_VARIANTS.has(rawKey) ||
                // Parametric/scope variants (group, peer, has, not, data, aria, supports)
                SPECIAL_VARIANTS.has(rawKey) ||
                rawKey === 'min' ||
                rawKey === 'max';

            if (!isKnown) {
                // ` at <relativePath>:<line>` when a build engine set the location;
                // empty on the runtime/browser path (no source file to point at).
                const at = szWarnLocation ? ` at ${szWarnLocation}` : '';
                const suggestion = SUGGESTION_MAP[rawKey];
                let message: string;
                if (suggestion) {
                    message = `[csszyx] Use the canonical key "${suggestion}" instead of "${rawKey}"${at}.`;
                } else if (/^\d+(?:\.\d+)?$/.test(rawKey)) {
                    // A numeric (or sequential 0,1,2…) key is almost never a typo:
                    // it means an array or a spread reached `sz` where an object of
                    // sz keys was expected (`sz={{ ...someArray }}`, or a value that
                    // leaked into key position). "Check for typos" points the wrong
                    // way, so name the actual cause.
                    message =
                        `[csszyx] sz received a numeric key "${rawKey}"${at}. This usually ` +
                        'means an array or a spread was passed where an object of sz ' +
                        'keys was expected. The value is ignored.';
                } else {
                    message =
                        `[csszyx] Unknown property "${rawKey}" in sz prop${at}. ` +
                        'This will be ignored. Check for typos.';
                }
                // A build warning already carries `at file:line`. A runtime one
                // (an sz built from a variable / spread / szv()/dynamic() result)
                // has no static span, so attach what makes it traceable in the
                // browser/SSR console: the offending object's shape and the first
                // user stack frame (which the console renders click-to-source).
                if (!szWarnLocation) {
                    message += runtimeSzWarnContext(szProp);
                }
                console.warn(message);
                hintProjectScanOnce(szWarnLocation);
            }
        }

        // A purely numeric key can never be a CSS property or Tailwind utility —
        // it is almost always a numeric lookup table (`{ 50: 100 }`) swallowed by
        // extraction, and the generic fallbacks below would mint garbage classes
        // like `50-100` straight into the safelist. Skip it (the unknown-property
        // dev warning above already fired).
        if (/^\d+(?:\.\d+)?$/.test(rawKey)) {
            continue;
        }

        // ================================================================
        // HANDLE BOOLEAN TRUE VALUES
        // ================================================================
        if (value === true) {
            // Check if it's a known boolean shorthand
            if (BOOLEAN_SHORTHANDS.has(rawKey)) {
                // Use the mapped class name if available
                const mappedClass = BOOLEAN_TO_CLASS[rawKey] || key;
                className += mappedClass;
            } else {
                className += key;
            }
            classes.push(className);
            continue;
        }

        // ================================================================
        // HANDLE animationDelay — no Tailwind utility, always arbitrary property
        // 150 → [animation-delay:150ms],  '0.5s' → [animation-delay:0.5s]
        // Placed before numeric/string blocks because it must intercept both types.
        // ================================================================
        if (rawKey === 'animationDelay') {
            const ms = typeof value === 'number' ? `${value}ms` : String(value);
            classes.push(`${className}[animation-delay:${ms}]`);
            continue;
        }

        // ================================================================
        // HANDLE NUMERIC VALUES
        // ================================================================
        if (typeof value === 'number') {
            // Handle negative values
            if (value < 0 && NEGATIVE_ALLOWED.has(key)) {
                className += `-${key}-${Math.abs(value)}`;
            } else {
                // Tailwind v4: all <number> values are dynamic — no brackets needed
                className += `${key}-${value}`;
            }
            classes.push(className);
            continue;
        }

        // ================================================================
        // HANDLE STRING VALUES
        // ================================================================
        if (typeof value === 'string') {
            // Check for important modifier (Fix #4)
            const { value: cleanValue, important } = handleImportant(value);
            let finalValue = cleanValue;

            // Tailwind build-time functions are arbitrary values, not CSS custom
            // properties. Classify them before the `--var` sugar so
            // `--spacing(4)` becomes `[--spacing(4)]`, never `(--spacing(4))`.
            if (isTailwindBuildFunction(finalValue)) {
                finalValue = `[${normalizeArbitraryValue(finalValue)}]`;
            } else if (finalValue.startsWith('--') && finalValue.includes('(')) {
                // Function-shaped but malformed/unsupported values remain
                // arbitrary; they must never be mislabeled as CSS variables.
                finalValue = `[${normalizeArbitraryValue(finalValue)}]`;
            } else if (finalValue.startsWith('--')) {
                // v4 Variable Syntax: '--color' → '(--color)'
                // Ambiguous properties get type hints: fontFamily → 'font-(family-name:--var)'
                const typeHint = CSS_VAR_TYPE_HINTS[rawKey];
                if (typeHint) {
                    finalValue = `(${typeHint}:${finalValue})`;
                } else {
                    finalValue = `(${finalValue})`;
                }
            } else if (finalValue.startsWith('var(')) {
                // var(--x) should be wrapped in brackets for arbitrary value syntax
                finalValue = `[${normalizeArbitraryValue(finalValue)}]`;
            } else if (/^\d+\/\d+$/.test(finalValue)) {
                // Check if it's a bare fraction (e.g. 3/4, 1/2)
                if (!FRACTION_SUPPORTED_PROPS.has(rawKey)) {
                    // Not in whitelist — wrap in brackets (col-[3/4])
                    finalValue = `[${finalValue}]`;
                }
                // else: allowed bare fraction (w-1/2, basis-1/3)
            } else if (key === 'aspect' && /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(finalValue)) {
                if (
                    finalValue === 'auto' ||
                    finalValue === 'square' ||
                    finalValue === 'video' ||
                    /^\d+\/\d+$/.test(finalValue)
                ) {
                    // standard
                } else {
                    finalValue = `[${finalValue}]`;
                }
            } else if (needsArbitraryBrackets(finalValue) || /^\d+\.\d+%$/.test(finalValue)) {
                // Check if needs arbitrary brackets (aspect ratio, percentages with decimals, numbers passed to stroke-width, etc.)
                finalValue = `[${normalizeArbitraryValue(finalValue)}]`;
            }

            // check negative string values (-px, -1/2)
            if (finalValue.startsWith('-') && NEGATIVE_ALLOWED.has(key)) {
                className = `-${prefix}${key}-${finalValue.substring(1)}`;
            } else {
                // Build final class name
                className += `${key}-${finalValue}`;
            }

            // Add important modifier
            if (important) {
                className += '!';
            }

            classes.push(className);
        }
    }

    // Post-processing: merge text-{size} + leading-{value} → text-{size}/{value}
    //
    // WHY restricted pattern: text-(.+) is too broad — it also matches color classes
    // like text-emerald-300 (from `color` prop). Those must NOT be merged with leading.
    // Only font-size suffixes are valid merge targets: xs, sm, base, lg, [2-9]?xl,
    // arbitrary [...], or CSS variable (...).
    let mergedClasses = classes;
    const textSizeBaseRe = /^text-(xs|sm|base|lg|[2-9]?xl|\[[^\]]+\]|\([^)]+\))$/;
    const leadingBaseRe = /^leading-(.+)$/;
    const textEntries: Array<{ index: number; prefix: string; size: string }> = [];
    const leadingEntries: Array<{ index: number; prefix: string; value: string }> = [];
    for (let i = 0; i < classes.length; i++) {
        const cls = classes[i];
        const lastColon = cls.lastIndexOf(':');
        const prefix = lastColon === -1 ? '' : cls.slice(0, lastColon + 1);
        const base = lastColon === -1 ? cls : cls.slice(lastColon + 1);
        const tm = textSizeBaseRe.exec(base);
        if (tm) {
            textEntries.push({ index: i, prefix, size: tm[1] });
        }
        const lm = leadingBaseRe.exec(base);
        if (lm) {
            leadingEntries.push({ index: i, prefix, value: lm[1] });
        }
    }
    if (textEntries.length > 0 && leadingEntries.length > 0) {
        const removeIndices = new Set<number>();
        // Track consumed leading entries so one leading cannot merge with multiple text-size classes.
        const consumedLeading = new Set<number>();
        for (const te of textEntries) {
            const matchingLeading = leadingEntries.find(
                le => le.prefix === te.prefix && !consumedLeading.has(le.index),
            );
            if (matchingLeading) {
                // Merge: text-lg + leading-7 → text-lg/7
                mergedClasses[te.index] = `${te.prefix}text-${te.size}/${matchingLeading.value}`;
                removeIndices.add(matchingLeading.index);
                consumedLeading.add(matchingLeading.index);
            }
        }
        if (removeIndices.size > 0) {
            mergedClasses = mergedClasses.filter((_, i) => !removeIndices.has(i));
        }
    }

    const finalClasses = mergedClasses.filter(Boolean);

    // Apply mangling if map is provided
    if (mangleMap) {
        const mangledClasses = finalClasses.map(cls => mangleMap[cls] || cls);
        return { className: mangledClasses.join(' ') };
    }

    return { className: finalClasses.join(' ') };
}

/**
 * Validates that an sz prop object is valid.
 *
 * @param {unknown} szProp - The value to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function isValidSzProp(szProp: unknown): szProp is SzObject {
    return (
        szProp !== null &&
        szProp !== undefined &&
        typeof szProp === 'object' &&
        !Array.isArray(szProp)
    );
}

/**
 * Normalizes a className string by removing extra whitespace.
 *
 * @param {string} className - The className string to normalize
 * @returns {string} The normalized className string
 */
export function normalizeClassName(className: string): string {
    return className.split(/\s+/).filter(Boolean).join(' ');
}
