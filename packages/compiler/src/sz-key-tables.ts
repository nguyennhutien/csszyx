/**
 * The sz key vocabulary: every key the lowering knows, the variant names, and
 * the removed spellings with what replaced them.
 *
 * The browser lowering (`transform-core.ts`) and the diagnostic renderer both
 * read these, and `pnpm gen:rust-tables` renders them for the engine. They sit
 * in a leaf module of their own so a process that renders the engine's
 * diagnostics (`@csszyx/compiler/engine`, `/internal`) loads the tables and not
 * the lowering around them.
 *
 * @module sz-key-tables
 */

// ============================================================================
// PROPERTY_MAP: Maps sz prop names to Tailwind utility prefixes
// ============================================================================
export const PROPERTY_MAP: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze({
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
    // `start-*` / `end-*`, not `inset-s-*` / `inset-e-*`: the latter exist from
    // Tailwind 4.2 only, the former are served with the same CSS on every v4
    // (ADR 0023, one release serves 4.0 → latest).
    start: 'start',
    end: 'end',
    insetS: 'start',
    insetE: 'end',
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
});

// ============================================================================
// SUGGESTION_MAP: Removed aliases → canonical key migration hints (dev only)
// This is exported for the MCP server so AI can guide users accurately.
// ============================================================================
/**
 * Removed keys whose replacement is a SHAPE, not another key name. These need
 * their own sentence: rendering them through the SUGGESTION_MAP template would
 * print the prose as if it were a key ("Use the canonical key "maskLinear /
 * maskRadial / maskConic with { from }" …").
 */
export const MIGRATION_NOTES: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze({
    // Mask gradient stops moved onto the layer that owns them: Tailwind has no
    // bare `mask-from-*`, only `mask-<layer>-from-*` and `mask-<side>-from-*`.
    maskFrom:
        'write the from stop on its layer: `maskLinear`, `maskRadial` or `maskConic` take `{ from }`',
    maskTo: 'write the to stop on its layer: `maskLinear`, `maskRadial` or `maskConic` take `{ to }`',
    maskVia:
        'write `{ from, to }` on `maskLinear`, `maskRadial` or `maskConic`; Tailwind masks have no via stop',
    maskShape: "write the shape on `maskRadial`: `{ shape: 'circle' }` or `{ shape: 'ellipse' }`",
    // One key could hold one keyword, while CSS combines one per group.
    fontVariant:
        "write one key per group: `numFigure`, `numSpacing`, `numFraction`, `numOrdinal`, `numSlashedZero`, or `nums: 'normal'`",
});

/**
 * CSS shorthands csszyx writes as two keys, so no one key is their canonical
 * spelling: each names the `canonical-key` form whose help names both keys.
 * Like an alias, such a key emits nothing. Kept apart from `SUGGESTION_MAP`,
 * whose every value is a key to write.
 */
export const SPLIT_SHORTHAND_KEYS: Readonly<Record<string, 'font' | 'scrollbar-color'>> =
    /* @__PURE__ */ Object.freeze({
        font: 'font',
        scrollbarColor: 'scrollbar-color',
    });

export const SUGGESTION_MAP: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze({
    // font-variant-numeric single-keyword groups joined the `num*` family (0.18.0)
    ordinal: 'numOrdinal',
    slashedZero: 'numSlashedZero',
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
    // Typography (`font` itself is a split shorthand: SPLIT_SHORTHAND_KEYS)
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
    // Scrollbar (v4.3; `scrollbarColor` is a split shorthand: SPLIT_SHORTHAND_KEYS)
    scrollbarWidth: 'scrollbar',
    // Boolean remaps
    flexWrapReverse: "flexWrap: 'wrap-reverse'",
    flexNowrap: "flexWrap: 'nowrap'",
});

// ============================================================================
// KNOWN_VARIANTS: All known variant names for disambiguation
// ============================================================================
export const KNOWN_VARIANTS: ReadonlySet<string> = new Set([
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
// BOOLEAN_SHORTHANDS: Properties that map directly when value is true
// ============================================================================
// Canonical keys lowered by dedicated branches rather than PROPERTY_MAP. This
// table feeds native and editor-tooling generation so valid-key diagnostics and
// completions cannot drift from the compiler.
export const KNOWN_SPECIAL_PROPERTIES: ReadonlySet<string> = new Set([
    'css',
    'maskLinear',
    'maskRadial',
    'maskConic',
    'alignContent',
    'fromPos',
    'viaPos',
    'toPos',
    'maskComposite',
    'maskMode',
    'maskType',
    'snapStrictness',
    // font-variant-numeric, one key per group of its grammar (CLOSED_ENUM_CLASSES)
    'nums',
    'numFigure',
    'numSpacing',
    'numFraction',
    // touch-action and contain, one key per group (CLOSED_ENUM_CLASSES); `touch`
    // itself is a PROPERTY_MAP key
    'touchPanX',
    'touchPanY',
    'contain',
    'containSize',
]);

// Boolean shorthands kept on purpose. A key stays boolean only when it is NOT a
// value-alias of a single mutually-exclusive CSS property: composite utilities
// (truncate, srOnly), single-keyword groups of an additive property
// (numOrdinal, numSlashedZero), default-or-value toggles (grow/ring/blur — true means the default,
// a value means a specific one), plugin components (container/prose), and
// directional reverse flags. Value-alias sugar for display/position/visibility/
// isolation/text-transform/font-style/text-decoration-line/font-smoothing was
// removed — those are written with their canonical key (see REMOVED_BOOLEAN_SUGAR).
export const BOOLEAN_SHORTHANDS: ReadonlySet<string> = new Set([
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
    // font-variant-numeric groups with a single keyword; the two-keyword groups
    // are closed enums (numFigure/numSpacing/numFraction) so one object cannot
    // set both keywords of a group.
    'numOrdinal',
    'numSlashedZero',
    // the single-keyword groups of touch-action and contain
    'touchPinchZoom',
    'containLayout',
    'containPaint',
    'containStyle',
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
