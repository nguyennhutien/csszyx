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

    // Sizing
    w: 'w',
    'min-w': 'minW',
    'max-w': 'maxW',
    h: 'h',
    'min-h': 'minH',
    'max-h': 'maxH',
    size: 'size',

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
    top: 'top',
    right: 'right',
    bottom: 'bottom',
    left: 'left',
    // TW v4.2: start/end are deprecated — migrate to inset-s/inset-e
    start: 'insetS',
    end: 'insetE',

    // Typography (ambiguous — text-*, font-* disambiguated)
    text: 'color', // default for text- prefix
    font: 'fontWeight', // default for font- prefix
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
    rotate: 'rotate',
    'translate-x': 'translateX',
    'translate-y': 'translateY',
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
export const REVERSE_BOOLEAN_MAP: Record<string, string> = {
    // Display
    block: 'block',
    inline: 'inline',
    'inline-block': 'inlineBlock',
    flex: 'flex',
    'inline-flex': 'inlineFlex',
    grid: 'grid',
    'inline-grid': 'inlineGrid',
    hidden: 'hidden',
    contents: 'contents',
    table: 'table',
    'table-row': 'tableRow',
    'table-cell': 'tableCell',
    'flow-root': 'flowRoot',
    'list-item': 'listItem',

    // Position
    static: 'static',
    fixed: 'fixed',
    absolute: 'absolute',
    relative: 'relative',
    sticky: 'sticky',

    // Visibility
    visible: 'visible',
    invisible: 'invisible',
    collapse: 'collapse',

    // Typography
    truncate: 'truncate',
    uppercase: 'uppercase',
    lowercase: 'lowercase',
    capitalize: 'capitalize',
    'normal-case': 'normalCase',
    underline: 'underline',
    overline: 'overline',
    'line-through': 'lineThrough',
    'no-underline': 'noUnderline',
    italic: 'italic',
    'not-italic': 'notItalic',
    antialiased: 'antialiased',
    'subpixel-antialiased': 'subpixelAntialiased',

    // Flexbox
    // flexWrap is string-based, not boolean — removed from boolean map

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

    // Transforms
    'scale-3d': 'scale',
    'translate-3d': 'translate',
    // transform-gpu/cpu/none use BOOLEAN_VALUE_MAP → { transform: 'gpu'/'cpu'/'none' }

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

// Values that mean "use the prop name as-is with value true"
export const BOOLEAN_VALUE_MAP: Record<string, { prop: string; value: unknown }> = {
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

    // Transform
    'transform-none': { prop: 'transform', value: 'none' },
    'transform-gpu': { prop: 'transform', value: 'gpu' },
    'transform-cpu': { prop: 'transform', value: 'cpu' },
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
    'translate-x',
    'translate-y',
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

export const SHADOW_SIZE_KEYWORDS = new Set(['sm', 'md', 'lg', 'xl', '2xl', 'inner', 'none']);

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

const COLOR_SCALE_RE =
    /^(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+$/;

/**
 * Checks if a value matches a known Tailwind color name or color-scale pattern.
 * @param value - The value string to check
 * @returns True if the value is a recognized color
 */
export function isColorValue(value: string): boolean {
    if (COLOR_NAMES.has(value)) {
        return true;
    }
    if (COLOR_SCALE_RE.test(value)) {
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
