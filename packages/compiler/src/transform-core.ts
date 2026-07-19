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
// Object-valued keys lowered by dedicated branches rather than PROPERTY_MAP.
// This table also feeds native known-key generation so diagnostics cannot drift.
const KNOWN_SPECIAL_PROPERTIES = new Set(['css']);

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
    // Public text-overflow boolean spellings retained alongside textOverflow.
    'textEllipsis',
    'textClip',
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
    textEllipsis: 'text-ellipsis',
    textClip: 'text-clip',
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

/** Spacing-scale values already nudged about dead quarter steps (once each). */
const _warnedSpacingSteps = new Set<string>();

/**
 * Warns when a numeric spacing value is not a quarter step. Tailwind's bare
 * spacing syntax only accepts multiples of 0.25 — `p-1.4` generates no CSS —
 * and a unitless bracket is no escape here (`padding: 1.4` is invalid CSS),
 * so the only fix is a real step or a unit value.
 * @param key - The sz property key.
 * @param value - The numeric value about to be emitted bare.
 */
function warnDeadSpacingStep(key: string, value: number): void {
    if (
        !szDevWarningsEnabled() ||
        PROPERTY_CATEGORY_MAP[key] !== PropertyCategory.SPACING ||
        (value * 4) % 1 === 0
    ) {
        return;
    }
    const token = `${key}:${value}`;
    if (_warnedSpacingSteps.has(token)) return;
    _warnedSpacingSteps.add(token);
    const at = szWarnLocation ? ` at ${szWarnLocation}` : '';
    console.warn(
        `[csszyx] "${key}: ${value}"${at}: ${value} is not on Tailwind's spacing scale ` +
            '(quarter steps only), so the class generates no CSS. Use a quarter step ' +
            `(1.25, 1.5, 1.75) or a unit value ("${value}rem").`,
    );
}

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

const ARBITRARY_LENGTH_UNITS = new Set([
    'px',
    'rem',
    'em',
    '%',
    'vh',
    'vw',
    'ch',
    'dvh',
    'dvw',
    'svh',
    'svw',
    'lvh',
    'lvw',
    'cqw',
    'cqh',
    'deg',
    'rad',
    'turn',
    'grad',
    'ms',
    's',
    'fr',
]);
const LEADING_DECIMAL_UNITS = new Set(['px', 'rem', 'em', '%', 'vh', 'vw', 'ch']);

/**
 * Returns whether a value is a numeric arbitrary value with a supported unit.
 *
 * @param value Candidate property value.
 * @returns Whether the value needs Tailwind arbitrary-value brackets.
 */
function isArbitraryLength(value: string): boolean {
    const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))([a-z%]+)?$/.exec(value);
    if (!match) return false;
    const leadingDecimal = match[1].replace(/^-/, '').startsWith('.');
    const unit = match[2];
    if (!unit) return leadingDecimal;
    if (leadingDecimal) return LEADING_DECIMAL_UNITS.has(unit);
    return ARBITRARY_LENGTH_UNITS.has(unit);
}

/**
 * Checks if a value needs arbitrary brackets
 * @param value - the CSS value to check
 * @returns whether the value requires wrapping in brackets
 */
function needsArbitraryBrackets(value: string): boolean {
    // Strip user-provided outer brackets before detection so '[100px]' is treated as '100px'
    const v = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
    return (
        isArbitraryLength(v) ||
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
 * @param code - Unicode code point to classify
 * @returns Whether the code point is an ASCII identifier character
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
 * @param code - Unicode code point to classify
 * @returns Whether the code point can start an ASCII Tailwind function name
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
    if (length < 5 || value.codePointAt(0) !== 45 || value.codePointAt(1) !== 45) {
        return false;
    }

    if (!isAsciiIdentifierStartCode(value.codePointAt(2) ?? -1)) return false;

    let index = 3;
    while (index < length && isAsciiIdentifierCode(value.codePointAt(index) ?? -1)) {
        index += 1;
    }
    if (index === 2 || index >= length || value.codePointAt(index) !== 40) {
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
        const code = value.codePointAt(index) ?? -1;
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

/**
 * Shadow-family utility prefixes where a bare `(--var)` suffix is parsed by
 * Tailwind as the shadow VALUE (`--tw-shadow: var(--c)`), so a var used as a
 * color needs the `(color:--var)` hint to land on `--tw-shadow-color`.
 */
const SHADOW_COLOR_HINT_PREFIXES = new Set([
    'shadow',
    'inset-shadow',
    'text-shadow',
    'drop-shadow',
]);

/** Builds a color utility from the `{ color, op }` object syntax. */
function buildColorObjectClass(
    key: string,
    color: { color: string; op?: number | string },
    prefix: string,
): string {
    const utilityPrefix =
        PROPERTY_MAP[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const rawColor = color.color;
    const colorValue =
        SHADOW_COLOR_HINT_PREFIXES.has(utilityPrefix) &&
        rawColor.startsWith('--') &&
        !rawColor.includes('(')
            ? `(color:${rawColor})`
            : formatColorObjectBase(rawColor);
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

const WILL_CHANGE_KEYWORDS = new Set(['auto', 'scroll', 'contents', 'transform']);

/** Collects special properties that emit one direct utility. */
function collectBasicSpecialProperty(
    rawKey: string,
    key: string,
    value: SzValue,
    prefix: string,
    classes: string[],
): boolean {
    if (rawKey === 'willChange' && typeof value === 'string') {
        classes.push(`${prefix}${formatWillChange(value)}`);
        return true;
    }
    if (typeof value === 'string' && isDirectKeywordProperty(key)) {
        classes.push(`${prefix}${formatDirectKeywordProperty(key, value)}`);
        return true;
    }
    if (isGradientPositionKey(rawKey) && typeof value === 'number') {
        classes.push(`${prefix}${rawKey.replace('Pos', '')}-${value}%`);
        return true;
    }
    return false;
}

/** Formats a will-change value. */
function formatWillChange(value: string): string {
    if (WILL_CHANGE_KEYWORDS.has(value)) return `will-change-${value}`;
    return value.startsWith('--')
        ? `will-change-(${value})`
        : `will-change-[${normalizeArbitraryValue(value)}]`;
}

/** Returns whether a property maps its string value directly to a utility. */
function isDirectKeywordProperty(key: string): boolean {
    return key === 'display' || key === 'position' || key === 'visibility' || key === 'isolation';
}

/** Formats display, position, visibility, and isolation values. */
function formatDirectKeywordProperty(key: string, value: string): string {
    if (key === 'display') return value === 'none' ? 'hidden' : value;
    if (key === 'visibility') return value === 'hidden' ? 'invisible' : value;
    if (key === 'isolation') return value === 'isolate' ? 'isolate' : `isolation-${value}`;
    return value;
}

/** Returns whether a key controls a gradient stop position. */
function isGradientPositionKey(key: string): boolean {
    return key === 'fromPos' || key === 'viaPos' || key === 'toPos';
}

/** Collects closed font style and smoothing modes. */
function collectFontModeProperty(
    key: string,
    value: string,
    prefix: string,
    classes: string[],
): boolean {
    if (key === 'fontStyle') {
        let className = '';
        if (value === 'italic') className = 'italic';
        else if (value === 'normal') className = 'not-italic';
        if (className) classes.push(`${prefix}${className}`);
        else warnUnsupportedFontStyle(value);
        return true;
    }
    if (key !== 'fontSmoothing') return false;
    let className = '';
    if (value === 'grayscale') className = 'antialiased';
    else if (value === 'subpixel') className = 'subpixel-antialiased';
    if (className) classes.push(`${prefix}${className}`);
    else if (szDevWarningsEnabled()) {
        console.warn(
            `[csszyx] fontSmoothing: '${value}' is not supported — use ` +
                `'grayscale' or 'subpixel'.`,
        );
    }
    return true;
}

/** Warns when fontStyle cannot map to a Tailwind class. */
function warnUnsupportedFontStyle(value: string): void {
    if (!szDevWarningsEnabled()) return;
    console.warn(
        `[csszyx] fontStyle: '${value}' is not supported — Tailwind only models ` +
            `'italic' and 'normal'. For oblique, use css: { fontStyle: '${value}' }.`,
    );
}

const DECORATION_CLASSES = new Set([
    'underline',
    'overline',
    'line-through',
    'no-underline',
    'none',
]);
const TEXT_TRANSFORM_CLASSES = new Set(['uppercase', 'lowercase', 'capitalize']);
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

/** Collects direct text decoration, transform, wrapping, and numeral modes. */
function collectTextKeywordProperty(
    key: string,
    value: string,
    prefix: string,
    classes: string[],
): boolean {
    if (key === 'decoration' && DECORATION_CLASSES.has(value)) {
        classes.push(`${prefix}${value === 'none' ? 'no-underline' : value}`);
        return true;
    }
    if (key === 'textTransform' && TEXT_TRANSFORM_CLASSES.has(value)) {
        classes.push(`${prefix}${value}`);
        return true;
    }
    if (key === 'textTransform' && (value === 'normal-case' || value === 'none')) {
        classes.push(`${prefix}normal-case`);
        return true;
    }
    if (key === 'fontVariant' && FONT_VARIANT_CLASSES.has(value)) {
        classes.push(`${prefix}${value}`);
        return true;
    }
    if (key === 'textWrap') {
        classes.push(`${prefix}text-${value}`);
        return true;
    }
    return false;
}

const WORD_BREAK_CLASSES: Record<string, string> = {
    normal: 'break-normal',
    all: 'break-all',
    keep: 'break-keep',
    'break-normal': 'break-normal',
    'break-all': 'break-all',
    'break-keep': 'break-keep',
};
const OVERFLOW_WRAP_CLASSES: Record<string, string> = {
    normal: 'wrap-normal',
    'break-word': 'wrap-break-word',
    anywhere: 'wrap-anywhere',
    'wrap-normal': 'wrap-normal',
    'wrap-break-word': 'wrap-break-word',
    'wrap-anywhere': 'wrap-anywhere',
};

/** Collects text flow, line clamp, and list utilities. */
function collectTextFlowProperty(
    key: string,
    value: string,
    prefix: string,
    classes: string[],
): boolean {
    let utility: string | null = null;
    if (key === 'break') utility = WORD_BREAK_CLASSES[value] || `break-${value}`;
    else if (key === 'wrap') utility = OVERFLOW_WRAP_CLASSES[value] || `wrap-${value}`;
    else if (key === 'textOverflow') utility = formatTextOverflow(value);
    else if (key === 'lineClamp') utility = formatLineClamp(value);
    else if (key === 'list' || key === 'listStyle') utility = formatListStyle(value);
    else if (key === 'listPos') utility = `list-${value}`;
    if (utility === null) return false;
    classes.push(`${prefix}${utility}`);
    return true;
}

/** Formats a text-overflow utility. */
function formatTextOverflow(value: string): string {
    return value === 'ellipsis' || value === 'clip' ? `text-${value}` : `text-[${value}]`;
}

/** Formats a line-clamp utility. */
function formatLineClamp(value: string): string {
    if (value === 'none') return 'line-clamp-none';
    if (value.startsWith('--')) return `line-clamp-(${value})`;
    const numeric = Number(value);
    return !Number.isNaN(numeric) && Number.isInteger(numeric)
        ? `line-clamp-${value}`
        : `line-clamp-[${value}]`;
}

/** Formats a list-style utility. */
function formatListStyle(value: string): string {
    if (value.startsWith('--')) return `list-(${value})`;
    return LIST_STYLE_STANDARD.has(value) ? `list-${value}` : `list-[${value}]`;
}

/** Collects divide, text-decoration, and font-stretch utilities. */
function collectDecorationProperty(
    key: string,
    value: string,
    prefix: string,
    classes: string[],
): boolean {
    let utility: string | null = null;
    if (key === 'divideStyle') utility = `divide-${value}`;
    else if (key === 'decorationStyle' || key === 'textDecorationStyle') {
        utility = `decoration-${value}`;
    } else if (key === 'decorationColor' || key === 'textDecorationColor') {
        utility = `decoration-${value}`;
    } else if (key === 'decorationThickness' || key === 'textDecorationThickness') {
        utility = formatDecorationThickness(value);
    } else if (key === 'fontStretch') utility = formatFontStretch(value);
    if (utility === null) return false;
    classes.push(`${prefix}${utility}`);
    return true;
}

/** Formats text-decoration thickness. */
function formatDecorationThickness(value: string): string {
    if (needsArbitraryBrackets(value)) {
        return `decoration-[${normalizeArbitraryValue(value)}]`;
    }
    return value.startsWith('--') ? `decoration-(${value})` : `decoration-${value}`;
}

/** Formats font-stretch keywords, variables, and percentages. */
function formatFontStretch(value: string): string {
    if (FONT_STRETCH_KEYWORDS.has(value)) return `font-${value}`;
    if (value.startsWith('--')) return `font-stretch-(${value})`;
    if (!/^\d+(\.\d+)?%$/.test(value)) return `font-stretch-[${value}]`;
    const numeric = Number.parseFloat(value);
    return value.includes('.') || !Number.isInteger(numeric)
        ? `font-stretch-[${value}]`
        : `font-stretch-${value}`;
}

const ARBITRARY_EFFECT_KEYS = new Set([
    'brightness',
    'contrast',
    'saturate',
    'scale',
    'backdropBrightness',
    'backdropContrast',
    'backdropSaturate',
]);

/** Collects shadow, filter, scale, and gradient-stop string utilities. */
function collectEffectStringProperty(
    key: string,
    value: string,
    prefix: string,
    classes: string[],
): boolean {
    let utility: string | null = null;
    let includePrefix = true;
    if (key === 'maxW' && value === 'container') {
        utility = 'container';
        includePrefix = false;
    } else if (key === 'shadowColor') {
        utility = formatShadowFamilyColor('shadow', value);
        includePrefix = false;
    } else if (key === 'insetShadowColor') {
        utility = formatShadowFamilyColor('inset-shadow', value);
    } else if (ARBITRARY_EFFECT_KEYS.has(key)) {
        utility = formatArbitraryEffect(key, value);
        includePrefix = key === 'scale' && value === '3d';
    } else if (key === 'textShadow') utility = formatTextShadow(value);
    else if (key === 'textShadowColor') {
        utility = formatShadowFamilyColor('text-shadow', value);
    } else if (isGradientPositionKey(key)) {
        utility = formatGradientPosition(key, value);
        includePrefix = false;
    }
    if (utility === null) return false;
    classes.push(`${includePrefix ? prefix : ''}${utility}`);
    return true;
}

/**
 * Formats a shadow-family color utility. A bare `X-(--c)` would set the shadow
 * VALUE, not its color; the `color:` hint keeps the var on the family's
 * `--tw-*-shadow-color` slot.
 */
function formatShadowFamilyColor(base: string, value: string): string {
    return value.startsWith('--') ? `${base}-(color:${value})` : `${base}-${value}`;
}

/** Formats string-valued filters and scale without numeric coercion. */
function formatArbitraryEffect(key: string, value: string): string {
    if (key === 'scale' && value === '3d') return 'scale-3d';
    const property = key.startsWith('backdrop') ? `backdrop-${key.slice(8).toLowerCase()}` : key;
    return value.startsWith('--') ? `${property}-(${value})` : `${property}-[${value}]`;
}

/** Formats a text-shadow utility. */
function formatTextShadow(value: string): string {
    if (value === 'none') return 'text-shadow-none';
    if (value === '') return 'text-shadow';
    return needsArbitraryBrackets(value)
        ? `text-shadow-[${normalizeArbitraryValue(value)}]`
        : `text-shadow-${value}`;
}

/** Formats a string-valued gradient stop position. */
function formatGradientPosition(key: string, value: string): string {
    const property = key.replace('Pos', '');
    if (value.startsWith('--')) return `${property}-(${value})`;
    return /^\d+%$/.test(value) ? `${property}-${value}` : `${property}-[${value}]`;
}

/** Formats background image keywords, gradients, variables, and URLs. */
function formatBackgroundImage(rawValue: string): string {
    const value = rawValue.trim();
    if (value === 'none') return 'bg-none';
    const normalized = value.startsWith('-') ? value.slice(1) : value;
    if (normalized.startsWith('repeating-')) {
        return `bg-[${normalizeArbitraryValue(value)}]`;
    }
    if (isBackgroundGradientString(normalized)) {
        const mapped = normalized.startsWith('gradient-to-')
            ? normalized.replace('gradient-to-', 'linear-to-')
            : normalized;
        return value.startsWith('-') ? `-bg-${mapped}` : `bg-${mapped}`;
    }
    if (value.startsWith('--')) return `bg-(image:${value})`;
    if (value.startsWith('url(')) return `bg-[${value}]`;
    return `bg-[url(${value})]`;
}

/** Returns whether a string names a Tailwind background-gradient utility. */
function isBackgroundGradientString(value: string): boolean {
    return (
        value.startsWith('linear-') ||
        value.startsWith('radial') ||
        value.startsWith('conic') ||
        value.startsWith('gradient-to-')
    );
}

const SIMPLE_MASK_KEYS = new Set(['maskPos', 'maskSize', 'maskShape', 'maskComposite', 'maskMode']);

/** Collects background position/size/repeat and simple mask utilities. */
function collectBackgroundMaskProperty(
    key: string,
    value: string,
    prefix: string,
    classes: string[],
): boolean {
    let utility: string | null = null;
    if (key === 'bgPos') utility = formatBackgroundPosition(value);
    else if (key === 'bgSize') utility = formatBackgroundSize(value);
    else if (key === 'bgRepeat' || key === 'backgroundRepeat') {
        utility = formatBackgroundRepeat(value);
    } else if (key === 'maskRepeat') utility = formatMaskRepeat(value);
    else if (key === 'maskType') utility = `mask-type-${value}`;
    else if (SIMPLE_MASK_KEYS.has(key)) utility = `mask-${value}`;
    if (utility === null) return false;
    classes.push(`${prefix}${utility}`);
    return true;
}

/** Formats a background-position value. */
function formatBackgroundPosition(value: string): string {
    if (value.startsWith('--')) return `bg-(${value})`;
    return value.includes('_') || needsArbitraryBrackets(value)
        ? `bg-[${normalizeArbitraryValue(value)}]`
        : `bg-${value}`;
}

/** Formats a background-size value. */
function formatBackgroundSize(value: string): string {
    if (value === 'auto' || value === 'cover' || value === 'contain') return `bg-${value}`;
    if (value.startsWith('--')) return `bg-size-(${value})`;
    return `bg-size-[${normalizeArbitraryValue(value)}]`;
}

/** Formats a background-repeat value. */
function formatBackgroundRepeat(value: string): string {
    if (value === 'repeat') return 'bg-repeat';
    if (value === 'no-repeat') return 'bg-no-repeat';
    const suffix = value.startsWith('repeat-') ? value.slice(7) : value;
    return `bg-repeat-${suffix}`;
}

/** Formats a mask-repeat value. */
function formatMaskRepeat(value: string): string {
    if (value === 'repeat') return 'mask-repeat';
    return value === 'no-repeat' ? 'mask-no-repeat' : `mask-${value}`;
}

const BORDER_COLOR_SIDES: Record<string, string> = {
    borderTColor: 't',
    borderRColor: 'r',
    borderBColor: 'b',
    borderLColor: 'l',
    borderXColor: 'x',
    borderYColor: 'y',
};

/** Collects content, border-color, transition, and drop-shadow utilities. */
function collectContentBorderProperty(
    key: string,
    value: string,
    prefix: string,
    classes: string[],
): boolean {
    let utility: string | null = null;
    if (key === 'alignContent') utility = `content-${value}`;
    else if (key === 'content') utility = formatContentValue(value);
    else if (BORDER_COLOR_SIDES[key]) utility = `border-${BORDER_COLOR_SIDES[key]}-${value}`;
    else if (key === 'transitionBehavior') utility = `transition-${value}`;
    else if (key === 'dropShadowColor') {
        utility = value.startsWith('--') ? `drop-shadow-(color:${value})` : `drop-shadow-${value}`;
    }
    if (utility === null) return false;
    classes.push(`${prefix}${utility}`);
    return true;
}

/** Formats CSS generated-content values. */
function formatContentValue(value: string): string {
    if (value === 'none') return 'content-none';
    if (value.startsWith('--')) return `content-(${value})`;
    const inner =
        value.startsWith('"') && value.endsWith('"') && value.length >= 2
            ? `'${value.slice(1, -1)}'`
            : value;
    return `content-[${inner}]`;
}

const COMPLEX_TRANSFORM_KEYS = new Set([
    'origin',
    'ease',
    'animate',
    'filter',
    'backdropFilter',
    'dropShadow',
]);
const STANDARD_PERSPECTIVE = new Set(['none', 'normal', 'dramatic', 'midrange']);
const STANDARD_PERSPECTIVE_ORIGINS = new Set([
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

/** Collects complex transform, perspective, and backface string utilities. */
function collectTransformStringProperty(
    key: string,
    value: string,
    prefix: string,
    classes: string[],
): boolean {
    let utility: string | null = null;
    if (COMPLEX_TRANSFORM_KEYS.has(key) && isComplexUtilityValue(value)) {
        utility = `${PROPERTY_MAP[key] || key}-[${normalizeArbitraryValue(value)}]`;
    } else if (key === 'transformStyle') utility = `transform-${value}`;
    else if (key === 'perspective') utility = formatPerspective(value);
    else if (key === 'perspectiveOrigin') utility = formatPerspectiveOrigin(value);
    else if (key === 'backface') utility = `backface-${value}`;
    if (utility === null) return false;
    classes.push(`${prefix}${utility}`);
    return true;
}

/** Returns whether a utility value requires arbitrary brackets. */
function isComplexUtilityValue(value: string): boolean {
    return (
        needsArbitraryBrackets(value) ||
        value.includes('(') ||
        value.includes('_') ||
        value.includes('%')
    );
}

/** Formats a perspective utility. */
function formatPerspective(value: string): string {
    if (STANDARD_PERSPECTIVE.has(value)) return `perspective-${value}`;
    if (value.startsWith('--')) return `perspective-(${value})`;
    return needsArbitraryBrackets(value)
        ? `perspective-[${normalizeArbitraryValue(value)}]`
        : `perspective-${value}`;
}

/** Formats a perspective-origin utility. */
function formatPerspectiveOrigin(value: string): string {
    return STANDARD_PERSPECTIVE_ORIGINS.has(value)
        ? `perspective-origin-${value}`
        : `perspective-origin-[${normalizeArbitraryValue(value)}]`;
}

/** Warns when a fallback key cannot produce a supported sz utility. */
function warnUnknownSzProperty(key: string, szProp: SzObject): void {
    if (!szDevWarningsEnabled() || isKnownSzPropertyKey(key)) return;
    let message = unknownSzPropertyMessage(key);
    if (!szWarnLocation) message += runtimeSzWarnContext(szProp);
    console.warn(message);
    hintProjectScanOnce(szWarnLocation);
}

/** Returns whether a key belongs to any supported property or variant family. */
function isKnownSzPropertyKey(key: string): boolean {
    return Boolean(
        PROPERTY_MAP[key] ||
            KNOWN_SPECIAL_PROPERTIES.has(key) ||
            BOOLEAN_SHORTHANDS.has(key) ||
            SNAP_DIRECT_MAP[key] ||
            isGradientPositionKey(key) ||
            key.startsWith('--') ||
            key.startsWith('[') ||
            key.startsWith('@') ||
            KNOWN_VARIANTS.has(key) ||
            SPECIAL_VARIANTS.has(key) ||
            key === 'min' ||
            key === 'max',
    );
}

/** Builds the diagnostic for an unsupported key without runtime context. */
function unknownSzPropertyMessage(key: string): string {
    const at = szWarnLocation ? ` at ${szWarnLocation}` : '';
    const suggestion = SUGGESTION_MAP[key];
    if (suggestion) {
        return `[csszyx] Use the canonical key "${suggestion}" instead of "${key}"${at}.`;
    }
    if (/^\d+(?:\.\d+)?$/.test(key)) {
        return (
            `[csszyx] sz received a numeric key "${key}"${at}. This usually ` +
            'means an array or a spread was passed where an object of sz ' +
            'keys was expected. The value is ignored.'
        );
    }
    return (
        `[csszyx] Unknown property "${key}" in sz prop${at}. ` +
        'This will be ignored. Check for typos.'
    );
}

/** Builds the fallback class for a string-valued property. */
function buildGenericStringClass(
    rawKey: string,
    key: string,
    value: string,
    prefix: string,
): string {
    const importantValue = handleImportant(value);
    const finalValue = normalizeGenericStringValue(rawKey, key, importantValue.value);
    const className =
        finalValue.startsWith('-') && NEGATIVE_ALLOWED.has(key)
            ? `-${prefix}${key}-${finalValue.substring(1)}`
            : `${prefix}${key}-${finalValue}`;
    return importantValue.important ? `${className}!` : className;
}

/** Normalizes string values into Tailwind utility suffix syntax. */
function normalizeGenericStringValue(rawKey: string, key: string, value: string): string {
    if (isTailwindBuildFunction(value) || (value.startsWith('--') && value.includes('('))) {
        return `[${normalizeArbitraryValue(value)}]`;
    }
    if (value.startsWith('--')) {
        const typeHint = CSS_VAR_TYPE_HINTS[rawKey];
        return typeHint ? `(${typeHint}:${value})` : `(${value})`;
    }
    if (value.startsWith('var(')) return `[${normalizeArbitraryValue(value)}]`;
    if (/^\d+\/\d+$/.test(value)) {
        return FRACTION_SUPPORTED_PROPS.has(rawKey) ? value : `[${value}]`;
    }
    if (key === 'aspect' && /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(value)) {
        return /^\d+\/\d+$/.test(value) ? value : `[${value}]`;
    }
    if (needsArbitraryBrackets(value) || /^\d+\.\d+%$/.test(value)) {
        return `[${normalizeArbitraryValue(value)}]`;
    }
    return value;
}

/** Indexed text-size utility eligible for a matching leading utility. */
interface TextSizeEntry {
    index: number;
    prefix: string;
    size: string;
}

/** Indexed leading utility eligible for a matching text-size utility. */
interface LeadingEntry {
    index: number;
    prefix: string;
    value: string;
}

const TEXT_SIZE_BASE_RE = /^text-(xs|sm|base|lg|[2-9]?xl|\[[^\]]+\]|\([^)]+\))$/;
const LEADING_BASE_RE = /^leading-(.+)$/;

/** Merges compatible text-size and line-height utilities with equal prefixes. */
function mergeTextSizeAndLeading(classes: string[]): string[] {
    const textEntries: TextSizeEntry[] = [];
    const leadingEntries: LeadingEntry[] = [];
    for (let index = 0; index < classes.length; index++) {
        collectTextLeadingEntry(classes[index], index, textEntries, leadingEntries);
    }
    if (textEntries.length === 0 || leadingEntries.length === 0) return classes;

    const mergedClasses = [...classes];
    const removeIndices = new Set<number>();
    for (const textEntry of textEntries) {
        const leadingEntry = findMatchingLeading(textEntry.prefix, leadingEntries, removeIndices);
        if (!leadingEntry) continue;
        mergedClasses[textEntry.index] =
            `${textEntry.prefix}text-${textEntry.size}/${leadingEntry.value}`;
        removeIndices.add(leadingEntry.index);
    }
    return removeIndices.size === 0
        ? classes
        : mergedClasses.filter((_, index) => !removeIndices.has(index));
}

/** Indexes one utility when it is a mergeable text-size or leading class. */
function collectTextLeadingEntry(
    className: string,
    index: number,
    textEntries: TextSizeEntry[],
    leadingEntries: LeadingEntry[],
): void {
    const lastColon = className.lastIndexOf(':');
    const prefix = lastColon === -1 ? '' : className.slice(0, lastColon + 1);
    const base = lastColon === -1 ? className : className.slice(lastColon + 1);
    const textMatch = TEXT_SIZE_BASE_RE.exec(base);
    if (textMatch) textEntries.push({ index, prefix, size: textMatch[1] });
    const leadingMatch = LEADING_BASE_RE.exec(base);
    if (leadingMatch) leadingEntries.push({ index, prefix, value: leadingMatch[1] });
}

/** Finds the first unconsumed leading utility with the requested prefix. */
function findMatchingLeading(
    prefix: string,
    entries: LeadingEntry[],
    consumedIndices: Set<number>,
): LeadingEntry | undefined {
    return entries.find(entry => entry.prefix === prefix && !consumedIndices.has(entry.index));
}

/** Filters empty utilities, applies optional mangling, and joins the result. */
function finalizeTransformResult(
    classes: string[],
    mangleMap?: Record<string, string>,
): TransformResult {
    const finalClasses = mergeTextSizeAndLeading(classes).filter(Boolean);
    const outputClasses = mangleMap
        ? finalClasses.map(className => mangleMap[className] || className)
        : finalClasses;
    return { className: outputClasses.join(' ') };
}

/** Formats a numeric utility, hoisting the sign for negative-capable keys. */
function formatNumericUtility(key: string, value: number): string {
    return value < 0 && NEGATIVE_ALLOWED.has(key)
        ? `-${key}-${Math.abs(value)}`
        : `${key}-${value}`;
}

/**
 * Whether a leading/lineHeight value must bracket as an unitless ratio.
 * Numbers ride Tailwind's spacing scale (leading-1.5 = 0.375rem) like every
 * other spacing utility; numeric STRINGS are the unitless line-height ratio
 * and auto-bracket (leading: '1.5' → leading-[1.5]). Non-quarter-step numbers
 * (1.4) have no bare spelling — Tailwind drops leading-1.4 — so they bracket
 * too instead of emitting a dead class.
 */
function isUnitlessLeadingRatio(value: unknown): value is number | string {
    if (typeof value === 'number') return (value * 4) % 1 !== 0;
    return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value);
}

/** Collects the scalar property forms that remain after specialized dispatch. */
function collectFallbackProperty(
    rawKey: string,
    key: string,
    value: unknown,
    prefix: string,
    szProp: SzObject,
    classes: string[],
): void {
    warnUnknownSzProperty(rawKey, szProp);
    if (/^\d+(?:\.\d+)?$/.test(rawKey)) return;
    if (value === true) {
        const utility = BOOLEAN_SHORTHANDS.has(rawKey) ? BOOLEAN_TO_CLASS[rawKey] || key : key;
        classes.push(`${prefix}${utility}`);
        return;
    }
    if (rawKey === 'animationDelay') {
        const delay = typeof value === 'number' ? `${value}ms` : String(value);
        classes.push(`${prefix}[animation-delay:${delay}]`);
        return;
    }
    if ((rawKey === 'leading' || rawKey === 'lineHeight') && isUnitlessLeadingRatio(value)) {
        classes.push(`${prefix}leading-[${value}]`);
        return;
    }
    if (typeof value === 'number') {
        warnDeadSpacingStep(rawKey, value);
        classes.push(`${prefix}${formatNumericUtility(key, value)}`);
        return;
    }
    if (typeof value === 'string') {
        if (/^-?\d+(?:\.\d+)?$/.test(value)) warnDeadSpacingStep(rawKey, Number(value));
        classes.push(buildGenericStringClass(rawKey, key, value, prefix));
    }
}

/** Routes object-valued properties to CSS, color, gradient, or variant handling. */
function collectObjectProperty(
    rawKey: string,
    value: unknown,
    prefix: string,
    classes: string[],
): boolean {
    if (rawKey === 'css') {
        if (isRecordValue(value)) appendArbitraryCss(value, prefix, classes);
        return true;
    }
    if (!isRecordValue(value)) return false;
    if (rawKey === 'bgImg') {
        const gradient = buildBackgroundGradientClass(value as BackgroundGradientValue);
        if (gradient) classes.push(`${prefix}${gradient}`);
        return true;
    }
    if (rawKey in PROPERTY_MAP && 'color' in value) {
        classes.push(
            buildColorObjectClass(rawKey, value as { color: string; op?: number | string }, prefix),
        );
        return true;
    }
    warnPropertyObjectValue(rawKey, value);
    collectNestedVariant(rawKey, value as SzObject, prefix, classes);
    return true;
}

/** Property keys already nudged about stray object values (once each). */
const _warnedPropertyObjects = new Set<string>();

/**
 * Warns when a PROPERTY key receives an object that is not the `{ color, op }`
 * form. The lowering falls through to variant handling and emits classes like
 * `p:bg-red-500` — `p:` matches no Tailwind variant, so the styles silently
 * generate no CSS. Keys that are genuine variants (hover, sm, group…) never
 * reach here with a property meaning: PROPERTY_MAP and the variant sets are
 * disjoint (locked by test).
 * @param key - The sz key holding the object.
 * @param value - The stray object value (used to name the nested keys).
 */
function warnPropertyObjectValue(key: string, value: Record<string, unknown>): void {
    if (
        !szDevWarningsEnabled() ||
        !(key in PROPERTY_MAP) ||
        KNOWN_VARIANTS.has(key) ||
        SPECIAL_VARIANTS.has(key) ||
        _warnedPropertyObjects.has(key)
    ) {
        return;
    }
    _warnedPropertyObjects.add(key);
    const at = szWarnLocation ? ` at ${szWarnLocation}` : '';
    const nested = Object.keys(value).slice(0, 3).join(', ');
    console.warn(
        `[csszyx] "${key}" is a property, not a variant, but received an object ` +
            `{ ${nested} }${at}. This compiles to "${key}:*" classes that match no ` +
            `Tailwind variant and generate no CSS. Move the nested keys up a level, ` +
            `or for color opacity use { color: '...', op: ... }.`,
    );
}

/** Returns whether a value is a non-array object. */
function isRecordValue(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Emits arbitrary CSS declarations from the `css` escape hatch. */
function appendArbitraryCss(
    declarations: Record<string, unknown>,
    prefix: string,
    classes: string[],
): void {
    for (const [property, value] of Object.entries(declarations)) {
        if (value === null || value === undefined) continue;
        classes.push(
            `${prefix}[${camelToKebab(property)}:${normalizeArbitraryValue(String(value))}]`,
        );
    }
}

/** Collects one nested special, breakpoint, container, or standard variant. */
function collectNestedVariant(
    rawKey: string,
    value: SzObject,
    prefix: string,
    classes: string[],
): void {
    const specialClasses = collectSpecialNestedVariant(rawKey, value, prefix);
    if (specialClasses !== null) {
        classes.push(...specialClasses);
        return;
    }
    if (rawKey === 'min' || rawKey === 'max') {
        collectMinMaxVariants(rawKey, value, prefix, classes);
        return;
    }
    if (rawKey.startsWith('@')) {
        collectContainerQueryVariants(rawKey, value, prefix, classes);
        return;
    }
    const variantName = isArbitraryVariant(rawKey)
        ? normalizeArbitraryVariant(rawKey)
        : getVariantPrefix(rawKey);
    const nestedResult = transform(value, `${prefix}${variantName}:`);
    if (nestedResult.className) classes.push(nestedResult.className);
}

/** Suppresses a removed boolean shorthand and emits its migration warning. */
function collectRemovedBooleanSugar(rawKey: string, value: unknown): boolean {
    if (value !== true) return false;
    const removed = REMOVED_BOOLEAN_SUGAR[rawKey];
    if (!removed) return false;
    if (szDevWarningsEnabled()) {
        console.warn(
            `[csszyx] "${rawKey}" boolean sugar was removed. Use ` +
                `{ ${removed.key}: '${removed.value}' } instead, or run \`csszyx migrate\`.`,
        );
    }
    return true;
}

/** Collects string shortcuts that must run before property-name resolution. */
function collectUnresolvedStringProperty(
    rawKey: string,
    value: unknown,
    prefix: string,
    classes: string[],
): boolean {
    if (typeof value !== 'string') return false;
    if (rawKey.startsWith('@')) {
        classes.push(`${prefix}${VARIANT_MAP[rawKey] || rawKey}/${value}`);
        return true;
    }
    if (rawKey === 'group' || rawKey === 'peer') {
        classes.push(`${prefix}${rawKey}/${value}`);
        return true;
    }
    if (
        PROPERTY_CATEGORY_MAP[rawKey] === PropertyCategory.COLOR &&
        !validateColorPropertyString(rawKey, value.replace(/!$/, ''))
    ) {
        return true;
    }
    const snapClass = SNAP_DIRECT_MAP[rawKey]?.[value];
    if (snapClass) {
        classes.push(`${prefix}${snapClass}`);
        return true;
    }
    if (KNOWN_VARIANTS.has(rawKey)) {
        classes.push(`${prefix}${getVariantPrefix(rawKey)}:${value}`);
        return true;
    }
    return false;
}

/** Collects custom-property declarations and the container utility forms. */
function collectUnresolvedDirectProperty(
    rawKey: string,
    value: unknown,
    prefix: string,
    classes: string[],
): boolean {
    if (rawKey.startsWith('--')) {
        classes.push(`${prefix}[${rawKey}:${value}]`);
        return true;
    }
    if (rawKey !== 'container') return false;
    if (value === true) classes.push(`${prefix}container`);
    else if (typeof value === 'string') classes.push(`${prefix}@container/${value}`);
    return true;
}

/** Collects one property after filtering inactive values and shortcut forms. */
function collectTransformProperty(
    rawKey: string,
    value: SzValue,
    prefix: string,
    szProp: SzObject,
    classes: string[],
): void {
    if (value === false || value === null || value === undefined) return;
    warnAlignmentValue(rawKey, value);
    if (collectRemovedBooleanSugar(rawKey, value)) return;
    if (collectObjectProperty(rawKey, value, prefix, classes)) return;
    if (collectUnresolvedStringProperty(rawKey, value, prefix, classes)) return;
    if (collectUnresolvedDirectProperty(rawKey, value, prefix, classes)) return;

    const key = PROPERTY_MAP[rawKey] || camelToKebab(rawKey);
    if (collectBasicSpecialProperty(rawKey, key, value, prefix, classes)) return;
    if (collectResolvedStringProperty(rawKey, value, prefix, classes)) return;
    collectFallbackProperty(rawKey, key, value, prefix, szProp, classes);
}

/** Collects string utilities that require a resolved property context. */
function collectResolvedStringProperty(
    rawKey: string,
    value: unknown,
    prefix: string,
    classes: string[],
): boolean {
    if (typeof value !== 'string') return false;
    if (collectFontModeProperty(rawKey, value, prefix, classes)) return true;
    if (collectTextKeywordProperty(rawKey, value, prefix, classes)) return true;
    if (collectTextFlowProperty(rawKey, value, prefix, classes)) return true;
    if (collectDecorationProperty(rawKey, value, prefix, classes)) return true;
    if (collectEffectStringProperty(rawKey, value, prefix, classes)) return true;
    if (collectContentBorderProperty(rawKey, value, prefix, classes)) return true;
    if (collectTransformStringProperty(rawKey, value, prefix, classes)) return true;
    if (rawKey === 'bgImg') {
        classes.push(`${prefix}${formatBackgroundImage(value)}`);
        return true;
    }
    return collectBackgroundMaskProperty(rawKey, value, prefix, classes);
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
        collectTransformProperty(rawKey, value, prefix, szProp, classes);
    }

    return finalizeTransformResult(classes, mangleMap);
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
