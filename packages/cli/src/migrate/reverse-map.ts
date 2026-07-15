/**
 * Reverse mapping: Tailwind class prefixes → sz prop names.
 *
 * Built by inverting the compiler's PROPERTY_MAP, BOOLEAN_SHORTHANDS,
 * and BOOLEAN_TO_CLASS. Disambiguation for ambiguous prefixes (text-*,
 * font-*, border-*, bg-*, etc.) is handled in class-parser.ts.
 */

// ============================================================================
// REVERSE PROPERTY MAP: TW prefix → preferred sz prop name
// When multiple sz props share a TW prefix, the "primary" one is listed here.
// Disambiguation decides which prop to use based on the value.
// ============================================================================
export const REVERSE_PROPERTY_MAP: Record<string, string> = {
    // Background (ambiguous — disambiguated in class-parser)
    bg: 'bg',
    'bg-clip': 'bgClip',
    'bg-origin': 'bgOrigin',
    'bg-size': 'bgSize',

    // Border Radius
    rounded: 'rounded',
    'rounded-t': 'roundedT',
    'rounded-r': 'roundedR',
    'rounded-b': 'roundedB',
    'rounded-l': 'roundedL',
    'rounded-tl': 'roundedTl',
    'rounded-tr': 'roundedTr',
    'rounded-bl': 'roundedBl',
    'rounded-br': 'roundedBr',
    'rounded-s': 'roundedS',
    'rounded-e': 'roundedE',
    'rounded-ss': 'roundedSs',
    'rounded-se': 'roundedSe',
    'rounded-es': 'roundedEs',
    'rounded-ee': 'roundedEe',

    // Border (ambiguous — disambiguated)
    border: 'border',
    'border-t': 'borderT',
    'border-r': 'borderR',
    'border-b': 'borderB',
    'border-l': 'borderL',
    'border-x': 'borderX',
    'border-y': 'borderY',
    'border-s': 'borderS',
    'border-e': 'borderE',

    // Divide
    'divide-x': 'divideX',
    'divide-y': 'divideY',
    divide: 'divideColor',

    // Outline (ambiguous)
    outline: 'outline',
    'outline-offset': 'outlineOffset',

    // Ring (v4: outset ring + inset ring)
    ring: 'ring',
    'ring-offset': 'ringOffset',
    'inset-ring': 'insetRing',

    // Spacing
    p: 'p',
    pt: 'pt',
    pr: 'pr',
    pb: 'pb',
    pl: 'pl',
    px: 'px',
    py: 'py',
    ps: 'ps',
    pe: 'pe',
    m: 'm',
    mt: 'mt',
    mr: 'mr',
    mb: 'mb',
    ml: 'ml',
    mx: 'mx',
    my: 'my',
    ms: 'ms',
    me: 'me',

    // Space between
    'space-x': 'spaceX',
    'space-y': 'spaceY',

    // Logical margin / padding (block-start / block-end)
    mbs: 'mbs',
    mbe: 'mbe',
    pbs: 'pbs',
    pbe: 'pbe',

    // Sizing
    w: 'w',
    'min-w': 'minW',
    'max-w': 'maxW',
    h: 'h',
    'min-h': 'minH',
    'max-h': 'maxH',
    size: 'size',
    // Logical sizing (block-size / inline-size). The bare `block`/`inline` classes
    // are display values (BOOLEAN_VALUE_MAP wins via exact match first); only the
    // `block-*` / `inline-*` value forms route here.
    block: 'blockSize',
    inline: 'inlineSize',
    'min-block': 'minBlockSize',
    'max-block': 'maxBlockSize',
    'min-inline': 'minInlineSize',
    'max-inline': 'maxInlineSize',

    // Layout
    aspect: 'aspect',
    columns: 'columns',
    'break-after': 'breakAfter',
    'break-before': 'breakBefore',
    'break-inside': 'breakInside',
    'box-decoration': 'boxDecoration',
    box: 'box',
    float: 'float',
    clear: 'clear',
    object: 'objectFit', // ambiguous — objectFit vs objectPos (objectPos for position values)
    overflow: 'overflow',
    'overflow-x': 'overflowX',
    'overflow-y': 'overflowY',
    overscroll: 'overscroll',
    'overscroll-x': 'overscrollX',
    'overscroll-y': 'overscrollY',
    z: 'z',

    // Inset
    inset: 'inset',
    'inset-x': 'insetX',
    'inset-y': 'insetY',
    // Logical inset sides (inset-s/e + block-start/block-end)
    'inset-s': 'insetS',
    'inset-e': 'insetE',
    'inset-bs': 'insetBs',
    'inset-be': 'insetBe',
    top: 'top',
    right: 'right',
    bottom: 'bottom',
    left: 'left',
    // TW v4.2: start/end are deprecated — migrate to inset-s/inset-e
    start: 'insetS',
    end: 'insetE',

    // Typography (ambiguous — text-*, font-* disambiguated)
    text: 'color', // default for text- prefix
    font: 'weight', // default for font- prefix
    decoration: 'decoration', // ambiguous
    'underline-offset': 'underlineOffset',
    indent: 'indent',
    align: 'align',
    whitespace: 'whitespace',
    break: 'break', // ambiguous with break-after/before/inside (handled by prefix matching)
    hyphens: 'hyphens',
    content: 'content',
    leading: 'leading',
    tracking: 'tracking',
    list: 'list', // ambiguous
    'list-image': 'listImg',

    // Flex & Grid
    basis: 'basis',
    flex: 'flex', // ambiguous (boolean flex, flexDirection, flexWrap)
    grow: 'grow',
    shrink: 'shrink',
    order: 'order',
    items: 'items',
    self: 'self',
    justify: 'justify',
    'justify-items': 'justifyItems',
    'justify-self': 'justifySelf',
    'place-content': 'placeContent',
    'place-items': 'placeItems',
    'place-self': 'placeSelf',
    gap: 'gap',
    'gap-x': 'gapX',
    'gap-y': 'gapY',

    // Grid
    'grid-cols': 'gridCols',
    'grid-rows': 'gridRows',
    col: 'col',
    'col-span': 'colSpan',
    'col-start': 'colStart',
    'col-end': 'colEnd',
    row: 'row',
    'row-span': 'rowSpan',
    'row-start': 'rowStart',
    'row-end': 'rowEnd',
    'grid-flow': 'gridFlow',
    'auto-cols': 'autoCols',
    'auto-rows': 'autoRows',

    // Effects
    shadow: 'shadow', // ambiguous (shadow vs shadowColor)
    'inset-shadow': 'insetShadow',
    opacity: 'opacity',
    'mix-blend': 'mixBlend',
    'bg-blend': 'bgBlend',

    // Filters
    filter: 'filter',
    'backdrop-filter': 'backdropFilter',
    blur: 'blur',
    brightness: 'brightness',
    contrast: 'contrast',
    'drop-shadow': 'dropShadow',
    grayscale: 'grayscale',
    'hue-rotate': 'hueRotate',
    invert: 'invert',
    saturate: 'saturate',
    sepia: 'sepia',
    'backdrop-blur': 'backdropBlur',
    'backdrop-brightness': 'backdropBrightness',
    'backdrop-contrast': 'backdropContrast',
    'backdrop-grayscale': 'backdropGrayscale',
    'backdrop-hue-rotate': 'backdropHueRotate',
    'backdrop-invert': 'backdropInvert',
    'backdrop-opacity': 'backdropOpacity',
    'backdrop-saturate': 'backdropSaturate',
    'backdrop-sepia': 'backdropSepia',

    // Transforms
    scale: 'scale',
    'scale-x': 'scaleX',
    'scale-y': 'scaleY',
    'scale-z': 'scaleZ',
    rotate: 'rotate',
    translate: 'translate',
    'translate-x': 'translateX',
    'translate-y': 'translateY',
    'translate-z': 'translateZ',
    'skew-x': 'skewX',
    'skew-y': 'skewY',
    origin: 'origin',

    // Transitions & Animation
    transition: 'transition',
    duration: 'duration',
    ease: 'ease',
    delay: 'delay',
    animate: 'animate',

    // Interactivity
    cursor: 'cursor',
    caret: 'caret',
    'pointer-events': 'pointerEvents',
    scheme: 'scheme',
    tab: 'tabSize',
    zoom: 'zoom',
    scrollbar: 'scrollbar',
    'scrollbar-gutter': 'scrollbarGutter',
    resize: 'resize',
    scroll: 'scroll',
    'scroll-m': 'scrollM',
    'scroll-mt': 'scrollMt',
    'scroll-mr': 'scrollMr',
    'scroll-mb': 'scrollMb',
    'scroll-ml': 'scrollMl',
    'scroll-ms': 'scrollMs',
    'scroll-me': 'scrollMe',
    'scroll-mx': 'scrollMx',
    'scroll-my': 'scrollMy',
    'scroll-p': 'scrollP',
    'scroll-pt': 'scrollPt',
    'scroll-pr': 'scrollPr',
    'scroll-pb': 'scrollPb',
    'scroll-pl': 'scrollPl',
    'scroll-ps': 'scrollPs',
    'scroll-pe': 'scrollPe',
    'scroll-px': 'scrollPx',
    'scroll-py': 'scrollPy',
    snap: 'snapType', // ambiguous
    touch: 'touch',
    select: 'select',
    'will-change': 'willChange',
    accent: 'accent',

    // SVG
    fill: 'fill',
    stroke: 'stroke',

    // Tables
    'border-spacing': 'borderSpacing',
    table: 'tableLayout', // ambiguous with boolean "table" display
    caption: 'caption',

    // Line clamp
    'line-clamp': 'lineClamp',
    wrap: 'wrap',

    // Typography plugin (bare `prose` is boolean; `prose-gray`/`prose-lg` carry a value)
    prose: 'prose',

    // Text shadow
    'text-shadow': 'textShadow',

    // Gradient stops
    from: 'from',
    via: 'via',
    to: 'to',

    // Masks
    mask: 'mask',

    // Forced colors
    'forced-color-adjust': 'forcedColorAdjust',

    // Perspective
    perspective: 'perspective',
    'perspective-origin': 'perspectiveOrigin',
    backface: 'backface',
};

// ============================================================================
// REVERSE BOOLEAN MAP: TW class name → sz prop (value = true)
// ============================================================================
// Single-property value-alias classes (display/position/visibility/isolation/
// text-transform/font-style/text-decoration-line/font-smoothing) are NOT here —
// they migrate to their canonical { key: value } form via BOOLEAN_VALUE_MAP.
// Only genuinely on/off utilities (composite, additive, default-or-value, plugin)
// remain true boolean shorthands.
export const REVERSE_BOOLEAN_MAP: Record<string, string> = {
    // Typography (composite)
    truncate: 'truncate',

    // Flexbox (default-or-value: bare `grow`/`shrink` mean grow/shrink: true,
    // while grow-0/shrink-0 carry a value via REVERSE_PROPERTY_MAP).
    // flexWrap is string-based, not boolean — kept out of this map.
    grow: 'grow',
    shrink: 'shrink',

    // Filters (defaults)
    blur: 'blur',
    grayscale: 'grayscale',
    invert: 'invert',
    sepia: 'sepia',
    'backdrop-blur': 'backdropBlur',
    'backdrop-grayscale': 'backdropGrayscale',
    'backdrop-invert': 'backdropInvert',
    'backdrop-sepia': 'backdropSepia',

    // Misc
    container: 'container',
    prose: 'prose',
    // Bare `resize` (resize: both) and bare `shadow` (default elevation) are
    // default-or-value toggles, like ring/outline below.
    resize: 'resize',
    shadow: 'shadow',
    'sr-only': 'srOnly',
    'not-sr-only': 'notSrOnly',
    isolate: 'isolate',
    ordinal: 'ordinal',
    'slashed-zero': 'slashedZero',
    // Bare `transition` (common transition property) and the `group`/`peer`
    // marker classes round-trip through the compiler as boolean sugar.
    transition: 'transition',
    group: 'group',
    peer: 'peer',

    // Divide/Space reverse
    'divide-x-reverse': 'divideXReverse',
    'divide-y-reverse': 'divideYReverse',
    'space-x-reverse': 'spaceXReverse',
    'space-y-reverse': 'spaceYReverse',

    // Ring/Outline/Border-radius (boolean defaults)
    ring: 'ring',
    'inset-ring': 'insetRing',
    outline: 'outline',
    rounded: 'rounded',

    // Transforms — scale-3d/translate-3d carry the literal '3d' value via
    // BOOLEAN_VALUE_MAP, and transform-gpu/cpu/none → { transform: 'gpu'/'cpu'/'none' }.

    // Font numeric
    'normal-nums': 'fontVariant',
    'lining-nums': 'fontVariant',
    'oldstyle-nums': 'fontVariant',
    'proportional-nums': 'fontVariant',
    'tabular-nums': 'fontVariant',
    'diagonal-fractions': 'fontVariant',
    'stacked-fractions': 'fontVariant',

    // Snap
    'snap-none': 'snapType',
    'snap-x': 'snapType',
    'snap-y': 'snapType',
    'snap-both': 'snapType',
    'snap-mandatory': 'snapStrictness',
    'snap-proximity': 'snapStrictness',
    'snap-start': 'snapAlign',
    'snap-end': 'snapAlign',
    'snap-center': 'snapAlign',
    'snap-align-none': 'snapAlign',
    'snap-normal': 'snapStop',
    'snap-always': 'snapStop',

    // Divide styles
    'divide-solid': 'divideStyle',
    'divide-dashed': 'divideStyle',
    'divide-dotted': 'divideStyle',
    'divide-double': 'divideStyle',
    'divide-none': 'divideStyle',

    // Appearance
    'appearance-none': 'appearance',
    'appearance-auto': 'appearance',
};

// Values that mean "use the prop name as-is with value true". `cssProperty`
// marks single-property utilities so the variant parser fails closed on a
// scope conflict (e.g. `block flex` → two display values). Additive utilities
// (font-variant-numeric) intentionally omit it — they combine, not conflict.
export const BOOLEAN_VALUE_MAP: Record<
    string,
    { prop: string; value: unknown; cssProperty?: string }
> = {
    // Snap types
    'snap-none': { prop: 'snapType', value: 'none' },
    'snap-x': { prop: 'snapType', value: 'x' },
    'snap-y': { prop: 'snapType', value: 'y' },
    'snap-both': { prop: 'snapType', value: 'both' },
    'snap-mandatory': { prop: 'snapStrictness', value: 'mandatory' },
    'snap-proximity': { prop: 'snapStrictness', value: 'proximity' },
    'snap-start': { prop: 'snapAlign', value: 'start' },
    'snap-end': { prop: 'snapAlign', value: 'end' },
    'snap-center': { prop: 'snapAlign', value: 'center' },
    'snap-align-none': { prop: 'snapAlign', value: 'none' },
    'snap-normal': { prop: 'snapStop', value: 'normal' },
    'snap-always': { prop: 'snapStop', value: 'always' },

    // Divide styles
    'divide-solid': { prop: 'divideStyle', value: 'solid' },
    'divide-dashed': { prop: 'divideStyle', value: 'dashed' },
    'divide-dotted': { prop: 'divideStyle', value: 'dotted' },
    'divide-double': { prop: 'divideStyle', value: 'double' },
    'divide-none': { prop: 'divideStyle', value: 'none' },

    // Font variants
    'normal-nums': { prop: 'fontVariant', value: 'normal-nums' },
    'lining-nums': { prop: 'fontVariant', value: 'lining-nums' },
    'oldstyle-nums': { prop: 'fontVariant', value: 'oldstyle-nums' },
    'proportional-nums': { prop: 'fontVariant', value: 'proportional-nums' },
    'tabular-nums': { prop: 'fontVariant', value: 'tabular-nums' },
    'diagonal-fractions': { prop: 'fontVariant', value: 'diagonal-fractions' },
    'stacked-fractions': { prop: 'fontVariant', value: 'stacked-fractions' },

    // Appearance
    'appearance-none': { prop: 'appearance', value: 'none' },
    'appearance-auto': { prop: 'appearance', value: 'auto' },

    // Isolation (bare `isolate` is in REVERSE_BOOLEAN_MAP; `isolation-auto` carries a value)
    'isolation-auto': { prop: 'isolation', value: 'auto', cssProperty: 'isolation' },

    // Field sizing
    'field-sizing-content': { prop: 'fieldSizing', value: 'content', cssProperty: 'field-sizing' },
    'field-sizing-fixed': { prop: 'fieldSizing', value: 'fixed', cssProperty: 'field-sizing' },

    // Transform
    'transform-none': { prop: 'transform', value: 'none' },
    'transform-gpu': { prop: 'transform', value: 'gpu' },
    'transform-cpu': { prop: 'transform', value: 'cpu' },
    // transform-style (3d / flat) — single CSS property, so fail-closed on conflict.
    'transform-3d': { prop: 'transformStyle', value: '3d', cssProperty: 'transform-style' },
    'transform-flat': { prop: 'transformStyle', value: 'flat', cssProperty: 'transform-style' },
    // 3D scale/translate keyword shorthands carry the literal '3d' value.
    'scale-3d': { prop: 'scale', value: '3d' },
    'translate-3d': { prop: 'translate', value: '3d' },

    // Single-property utilities — migrated to their canonical { key: value }
    // form. The boolean-sugar aliases (flex/absolute/italic/...) were removed,
    // so these never emit `{ flex: true }`; one key per CSS property.
    // display
    block: { prop: 'display', value: 'block', cssProperty: 'display' },
    inline: { prop: 'display', value: 'inline', cssProperty: 'display' },
    'inline-block': { prop: 'display', value: 'inline-block', cssProperty: 'display' },
    flex: { prop: 'display', value: 'flex', cssProperty: 'display' },
    'inline-flex': { prop: 'display', value: 'inline-flex', cssProperty: 'display' },
    grid: { prop: 'display', value: 'grid', cssProperty: 'display' },
    'inline-grid': { prop: 'display', value: 'inline-grid', cssProperty: 'display' },
    hidden: { prop: 'display', value: 'none', cssProperty: 'display' },
    contents: { prop: 'display', value: 'contents', cssProperty: 'display' },
    table: { prop: 'display', value: 'table', cssProperty: 'display' },
    'inline-table': { prop: 'display', value: 'inline-table', cssProperty: 'display' },
    'table-row': { prop: 'display', value: 'table-row', cssProperty: 'display' },
    'table-row-group': { prop: 'display', value: 'table-row-group', cssProperty: 'display' },
    'table-cell': { prop: 'display', value: 'table-cell', cssProperty: 'display' },
    'table-caption': { prop: 'display', value: 'table-caption', cssProperty: 'display' },
    'table-column': { prop: 'display', value: 'table-column', cssProperty: 'display' },
    'table-column-group': {
        prop: 'display',
        value: 'table-column-group',
        cssProperty: 'display',
    },
    'table-footer-group': {
        prop: 'display',
        value: 'table-footer-group',
        cssProperty: 'display',
    },
    'table-header-group': {
        prop: 'display',
        value: 'table-header-group',
        cssProperty: 'display',
    },
    'flow-root': { prop: 'display', value: 'flow-root', cssProperty: 'display' },
    'list-item': { prop: 'display', value: 'list-item', cssProperty: 'display' },
    // position
    static: { prop: 'position', value: 'static', cssProperty: 'position' },
    fixed: { prop: 'position', value: 'fixed', cssProperty: 'position' },
    absolute: { prop: 'position', value: 'absolute', cssProperty: 'position' },
    relative: { prop: 'position', value: 'relative', cssProperty: 'position' },
    sticky: { prop: 'position', value: 'sticky', cssProperty: 'position' },
    // visibility
    visible: { prop: 'visibility', value: 'visible', cssProperty: 'visibility' },
    invisible: { prop: 'visibility', value: 'hidden', cssProperty: 'visibility' },
    collapse: { prop: 'visibility', value: 'collapse', cssProperty: 'visibility' },
    // isolation
    isolate: { prop: 'isolation', value: 'isolate', cssProperty: 'isolation' },
    // text-transform
    uppercase: { prop: 'textTransform', value: 'uppercase', cssProperty: 'text-transform' },
    lowercase: { prop: 'textTransform', value: 'lowercase', cssProperty: 'text-transform' },
    capitalize: { prop: 'textTransform', value: 'capitalize', cssProperty: 'text-transform' },
    'normal-case': { prop: 'textTransform', value: 'none', cssProperty: 'text-transform' },
    // font-style
    italic: { prop: 'fontStyle', value: 'italic', cssProperty: 'font-style' },
    'not-italic': { prop: 'fontStyle', value: 'normal', cssProperty: 'font-style' },
    // text-decoration-line
    underline: { prop: 'decoration', value: 'underline', cssProperty: 'text-decoration-line' },
    overline: { prop: 'decoration', value: 'overline', cssProperty: 'text-decoration-line' },
    'line-through': {
        prop: 'decoration',
        value: 'line-through',
        cssProperty: 'text-decoration-line',
    },
    'no-underline': { prop: 'decoration', value: 'none', cssProperty: 'text-decoration-line' },
    // font-smoothing
    antialiased: { prop: 'fontSmoothing', value: 'grayscale', cssProperty: 'font-smoothing' },
    'subpixel-antialiased': {
        prop: 'fontSmoothing',
        value: 'subpixel',
        cssProperty: 'font-smoothing',
    },
};

// ============================================================================
// SORTED PREFIXES: For longest-prefix-match (sorted by length desc, then alpha)
// ============================================================================
export const SORTED_PREFIXES: string[] = Object.keys(REVERSE_PROPERTY_MAP).sort((a, b) => {
    // Longer prefixes first
    if (b.length !== a.length) {
        return b.length - a.length;
    }
    // Alphabetical for same length
    return a.localeCompare(b);
});

// ============================================================================
// KNOWN BREAKPOINTS: Named breakpoints that don't need [] wrapping
// ============================================================================
export const KNOWN_BREAKPOINTS = new Set(['sm', 'md', 'lg', 'xl', '2xl']);

// ============================================================================
// NEGATIVE_ALLOWED: Properties that support negative values
// ============================================================================
export const NEGATIVE_ALLOWED = new Set([
    'm',
    'mt',
    'mr',
    'mb',
    'ml',
    'mx',
    'my',
    'ms',
    'me',
    'top',
    'right',
    'bottom',
    'left',
    'inset',
    'inset-x',
    'inset-y',
    'start',
    'end',
    'inset-s',
    'inset-e',
    'inset-bs',
    'inset-be',
    'mbs',
    'mbe',
    'translate',
    'z',
    'order',
    'col',
    'col-start',
    'col-end',
    'row',
    'row-start',
    'row-end',
    'rotate',
    'skew-x',
    'skew-y',
    'translate-x',
    'translate-y',
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
    // mask gradient direction carries a leading `-` as part of the value
    // (e.g. -mask-linear-45 → { mask: '-linear-45' }), not a numeric negation.
    'mask',
]);

// ============================================================================
// FRACTION_SUPPORTED: Props that support fractions (e.g., w-1/2)
// ============================================================================
export const FRACTION_SUPPORTED = new Set([
    'w',
    'min-w',
    'max-w',
    'h',
    'min-h',
    'max-h',
    'size',
    'basis',
    'inset',
    'inset-x',
    'inset-y',
    'top',
    'right',
    'bottom',
    'left',
    'start',
    'end',
    'inset-s',
    'inset-e',
    'inset-bs',
    'inset-be',
    'translate-x',
    'translate-y',
    'translate',
    'aspect',
]);

// ============================================================================
// SPACING_PROPS: Props that support 0.5-step decimals
// ============================================================================
export const SPACING_PROPS = new Set([
    'p',
    'pt',
    'pr',
    'pb',
    'pl',
    'px',
    'py',
    'ps',
    'pe',
    'm',
    'mt',
    'mr',
    'mb',
    'ml',
    'mx',
    'my',
    'ms',
    'me',
    'gap',
    'gap-x',
    'gap-y',
    'w',
    'h',
    'min-w',
    'max-w',
    'min-h',
    'max-h',
    'size',
    'basis',
    'inset',
    'inset-x',
    'inset-y',
    'top',
    'right',
    'bottom',
    'left',
    'start',
    'end',
    'space-x',
    'space-y',
    'indent',
    'scroll-m',
    'scroll-mx',
    'scroll-my',
    'scroll-mt',
    'scroll-mr',
    'scroll-mb',
    'scroll-ml',
    'scroll-ms',
    'scroll-me',
    'scroll-p',
    'scroll-px',
    'scroll-py',
    'scroll-pt',
    'scroll-pr',
    'scroll-pb',
    'scroll-pl',
    'scroll-ps',
    'scroll-pe',
    'border-spacing',
    'translate-x',
    'translate-y',
    'translate-z',
    'translate',
    // Logical sizing accepts the spacing/sizing scale (block-4, inline-full, …)
    'block',
    'inline',
    'min-block',
    'max-block',
    'min-inline',
    'max-inline',
    // Logical inset sides + block-axis margin/padding
    'inset-s',
    'inset-e',
    'inset-bs',
    'inset-be',
    'mbs',
    'mbe',
    'pbs',
    'pbe',
]);

// ============================================================================
// DISAMBIGUATION VALUE SETS
// ============================================================================

export const TEXT_SIZE_KEYWORDS = new Set([
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

export const TEXT_ALIGN_KEYWORDS = new Set(['left', 'center', 'right', 'justify', 'start', 'end']);

export const TEXT_WRAP_KEYWORDS = new Set(['wrap', 'nowrap', 'balance', 'pretty']);

export const TEXT_OVERFLOW_KEYWORDS = new Set(['ellipsis', 'clip']);

export const FONT_WEIGHT_KEYWORDS = new Set([
    'thin',
    'extralight',
    'light',
    'normal',
    'medium',
    'semibold',
    'bold',
    'extrabold',
    'black',
]);

export const FONT_FAMILY_KEYWORDS = new Set(['sans', 'serif', 'mono']);

export const FONT_STRETCH_KEYWORDS = new Set([
    'ultra-condensed',
    'extra-condensed',
    'condensed',
    'semi-condensed',
    'semi-expanded',
    'expanded',
    'extra-expanded',
    'ultra-expanded',
]);

export const BORDER_WIDTH_KEYWORDS = new Set(['0', '2', '4', '8']);

export const BORDER_STYLE_KEYWORDS = new Set([
    'solid',
    'dashed',
    'dotted',
    'double',
    'none',
    'hidden',
]);

export const BG_POSITION_KEYWORDS = new Set([
    'center',
    'top',
    'bottom',
    'left',
    'right',
    'left-top',
    'left-bottom',
    'right-top',
    'right-bottom',
]);

export const BG_SIZE_KEYWORDS = new Set(['cover', 'contain', 'auto']);

export const BG_REPEAT_KEYWORDS = new Set([
    'repeat',
    'no-repeat',
    'repeat-x',
    'repeat-y',
    'round',
    'space',
]);

export const BG_ATTACHMENT_KEYWORDS = new Set(['fixed', 'local', 'scroll']);

export const OBJECT_FIT_KEYWORDS = new Set(['contain', 'cover', 'fill', 'none', 'scale-down']);

export const OBJECT_POSITION_KEYWORDS = new Set([
    'center',
    'top',
    'bottom',
    'left',
    'right',
    'left-top',
    'left-bottom',
    'right-top',
    'right-bottom',
]);

export const SHADOW_SIZE_KEYWORDS = new Set([
    '2xs',
    'xs',
    'sm',
    'md',
    'lg',
    'xl',
    '2xl',
    'inner',
    'none',
]);

// align-content keywords. `content-<keyword>` is align-content (→ alignContent),
// while quoted / none / var / arbitrary `content-*` is the `content` CSS property.
export const ALIGN_CONTENT_KEYWORDS = new Set([
    'normal',
    'center',
    'start',
    'end',
    'between',
    'around',
    'evenly',
    'baseline',
    'stretch',
]);

export const OUTLINE_STYLE_KEYWORDS = new Set(['none', 'dashed', 'dotted', 'double']);

export const RING_WIDTH_VALUES = new Set(['0', '1', '2', '4', '8']);

export const DECORATION_STYLE_KEYWORDS = new Set(['solid', 'double', 'dotted', 'dashed', 'wavy']);

export const DECORATION_THICKNESS_KEYWORDS = new Set([
    'auto',
    'from-font',
    '0',
    '1',
    '2',
    '4',
    '8',
]);

export const TRANSITION_PROPERTY_KEYWORDS = new Set([
    'none',
    'all',
    'colors',
    'opacity',
    'shadow',
    'transform',
]);

export const EASE_KEYWORDS = new Set(['linear', 'in', 'out', 'in-out']);

// Color patterns
export const COLOR_NAMES = new Set([
    'inherit',
    'current',
    'transparent',
    'black',
    'white',
    'slate',
    'gray',
    'zinc',
    'neutral',
    'stone',
    'red',
    'orange',
    'amber',
    'yellow',
    'lime',
    'green',
    'emerald',
    'teal',
    'cyan',
    'sky',
    'blue',
    'indigo',
    'violet',
    'purple',
    'fuchsia',
    'pink',
    'rose',
]);

const COLOR_SCALE_NAMES = new Set([
    'slate',
    'gray',
    'zinc',
    'neutral',
    'stone',
    'red',
    'orange',
    'amber',
    'yellow',
    'lime',
    'green',
    'emerald',
    'teal',
    'cyan',
    'sky',
    'blue',
    'indigo',
    'violet',
    'purple',
    'fuchsia',
    'pink',
    'rose',
]);

/**
 * Checks if a value matches a known Tailwind color name or color-scale pattern.
 * @param value - The value string to check
 * @returns True if the value is a recognized color
 */
export function isColorValue(value: string): boolean {
    if (COLOR_NAMES.has(value)) {
        return true;
    }
    const separator = value.lastIndexOf('-');
    const colorName = value.slice(0, separator);
    const shade = value.slice(separator + 1);
    if (separator > 0 && COLOR_SCALE_NAMES.has(colorName) && /^\d+$/.test(shade)) {
        return true;
    }
    return false;
}

// ============================================================================
// VARIANT MAPS (inverted from compiler's VARIANT_MAP)
// ============================================================================
export const REVERSE_VARIANT_MAP: Record<string, string> = {
    'focus-within': 'focusWithin',
    'focus-visible': 'focusVisible',
    'first-of-type': 'firstOfType',
    'last-of-type': 'lastOfType',
    'only-of-type': 'onlyOfType',
    'motion-reduce': 'motionReduce',
    'motion-safe': 'motionSafe',
    'contrast-more': 'contrastMore',
    'contrast-less': 'contrastLess',
    'first-line': 'firstLine',
    'first-letter': 'firstLetter',
    'placeholder-shown': 'placeholderShown',
    'in-range': 'inRange',
    'out-of-range': 'outOfRange',
    'read-only': 'readOnly',
    'pointer-fine': 'pointerFine',
    'pointer-coarse': 'pointerCoarse',
    'pointer-none': 'pointerNone',
    '@max-sm': '@maxSm',
    '@max-md': '@maxMd',
    '@max-lg': '@maxLg',
    '@max-xl': '@maxXl',
    '@max-2xl': '@max2xl',
};

// Simple variants that map 1:1 (kebab = camelCase or same)
export const KNOWN_SIMPLE_VARIANTS = new Set([
    'sm',
    'md',
    'lg',
    'xl',
    '2xl',
    '@sm',
    '@md',
    '@lg',
    '@xl',
    '@2xl',
    'dark',
    'light',
    'print',
    'portrait',
    'landscape',
    'hover',
    'focus',
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
    'autofill',
    'open',
    'first',
    'last',
    'only',
    'odd',
    'even',
    'empty',
    'before',
    'after',
    'placeholder',
    'file',
    'marker',
    'selection',
    'backdrop',
    'ltr',
    'rtl',
]);

export const KNOWN_VARIANTS = new Set([
    ...KNOWN_SIMPLE_VARIANTS,
    'focus-within',
    'focus-visible',
    'first-of-type',
    'last-of-type',
    'only-of-type',
    'first-child',
    'last-child',
    'only-child',
    'motion-reduce',
    'motion-safe',
    'contrast-more',
    'contrast-less',
    'first-line',
    'first-letter',
    'placeholder-shown',
    'in-range',
    'out-of-range',
    'read-only',
    'pointer-fine',
    'pointer-coarse',
    'pointer-none',
]);

export const ARIA_STATES = new Set([
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
