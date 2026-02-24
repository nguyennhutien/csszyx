/**
 * @csszyx/compiler - TypeScript type definitions for sz prop.
 *
 * This module provides comprehensive type definitions for the sz prop
 * to enable IntelliSense, autocompletion, and type safety.
 *
 * @module @csszyx/compiler/types
 */

// ============================================================================
// Helper Types
// ============================================================================

/** Tailwind spacing scale values (0-96 + special values) */
export type SpacingScale =
  | 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  | 11 | 12 | 14 | 16 | 20 | 24 | 28 | 32 | 36 | 40 | 44 | 48 | 52 | 56
  | 60 | 64 | 72 | 80 | 96;

/** Spacing value that can be scale, keyword, or arbitrary */
export type SpacingValue = SpacingScale | 'px' | 'auto' | (number & {}) | (string & {});

/** Negative spacing value */
export type NegativeSpacingValue = SpacingValue | number;

/** Tailwind color names */
export type ColorName =
  | 'inherit' | 'current' | 'transparent' | 'black' | 'white'
  | 'slate' | 'gray' | 'zinc' | 'neutral' | 'stone'
  | 'red' | 'orange' | 'amber' | 'yellow' | 'lime' | 'green'
  | 'emerald' | 'teal' | 'cyan' | 'sky' | 'blue' | 'indigo'
  | 'violet' | 'purple' | 'fuchsia' | 'pink' | 'rose';

/** Tailwind color shades */
export type ColorShade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

/** Color value (string-based) */
export type ColorValue =
  | 'inherit' | 'current' | 'transparent' | 'black' | 'white'
  | `${ColorName}-${ColorShade}`
  | (string & {});

/** Color object with opacity */
export interface ColorObjectValue {
  color: ColorValue;
  op?: number | (string & {});
}

/** Union type for all color properties */
export type ColorPropValue = ColorValue | ColorObjectValue;

/** Container size names */
export type ContainerSize =
  | '3xs' | '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl';

/** Fraction values */
export type FractionValue =
  | '1/2' | '1/3' | '2/3' | '1/4' | '2/4' | '3/4'
  | '1/5' | '2/5' | '3/5' | '4/5'
  | '1/6' | '2/6' | '3/6' | '4/6' | '5/6'
  | '1/12' | '2/12' | '3/12' | '4/12' | '5/12' | '6/12'
  | '7/12' | '8/12' | '9/12' | '10/12' | '11/12';

/** Border radius keywords */
export type BorderRadiusValue =
  | 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full'
  | true | (string & {});

/** Shadow keywords */
export type ShadowValue =
  | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'inner' | 'none'
  | true | (string & {});

// ============================================================================
// Layout Properties
// ============================================================================

/**
 *
 */
export interface LayoutProps {
  /** @see https://tailwindcss.com/docs/aspect-ratio */
  aspect?: 'auto' | 'square' | 'video' | (string & {});

  /** @see https://tailwindcss.com/docs/columns */
  columns?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 'auto' | ContainerSize | (string & {});

  /** @see https://tailwindcss.com/docs/break-after */
  breakAfter?: 'auto' | 'avoid' | 'all' | 'avoid-page' | 'page' | 'left' | 'right' | 'column';

  /** @see https://tailwindcss.com/docs/break-before */
  breakBefore?: 'auto' | 'avoid' | 'all' | 'avoid-page' | 'page' | 'left' | 'right' | 'column';

  /** @see https://tailwindcss.com/docs/break-inside */
  breakInside?: 'auto' | 'avoid' | 'avoid-page' | 'avoid-column';

  /** @see https://tailwindcss.com/docs/box-decoration-break */
  boxDecoration?: 'slice' | 'clone';

  /** @see https://tailwindcss.com/docs/box-sizing */
  box?: 'border' | 'content';

  /** @see https://tailwindcss.com/docs/display */
  display?:
    | 'block' | 'inline-block' | 'inline' | 'flex' | 'inline-flex'
    | 'grid' | 'inline-grid' | 'contents' | 'table' | 'inline-table'
    | 'table-caption' | 'table-cell' | 'table-column' | 'table-column-group'
    | 'table-footer-group' | 'table-header-group' | 'table-row-group'
    | 'table-row' | 'flow-root' | 'list-item' | 'none';

  /** Boolean sugar for display: block */
  block?: boolean;
  /** Boolean sugar for display: inline-block */
  inlineBlock?: boolean;
  /** Boolean sugar for display: inline */
  inline?: boolean;
  /** Boolean sugar for display: flex */
  flex?: boolean | 'auto' | 'initial' | 'none' | 1 | (string & {});
  /** Boolean sugar for display: inline-flex */
  inlineFlex?: boolean;
  /** Boolean sugar for display: grid */
  grid?: boolean;
  /** Boolean sugar for display: inline-grid */
  inlineGrid?: boolean;
  /** Boolean sugar for display: table */
  table?: boolean;
  /** Boolean sugar for display: table-row */
  tableRow?: boolean;
  /** Boolean sugar for display: table-cell */
  tableCell?: boolean;
  /** Boolean sugar for display: flow-root */
  flowRoot?: boolean;
  /** Boolean sugar for display: list-item */
  listItem?: boolean;
  /** Boolean sugar for display: contents */
  contents?: boolean;
  /** Boolean sugar for display: hidden/none */
  hidden?: boolean;
  /** Boolean sugar for sr-only */
  srOnly?: boolean;
  /** Boolean sugar for not-sr-only */
  notSrOnly?: boolean;
  /** Boolean sugar for container */
  container?: boolean;
  /** Boolean sugar for prose */
  prose?: boolean;

  /** @see https://tailwindcss.com/docs/float */
  float?: 'right' | 'left' | 'start' | 'end' | 'none';

  /** @see https://tailwindcss.com/docs/clear */
  clear?: 'left' | 'right' | 'both' | 'none' | 'start' | 'end';

  /** @see https://tailwindcss.com/docs/isolation */
  isolation?: 'isolate' | 'auto';
  isolate?: boolean;

  /** @see https://tailwindcss.com/docs/object-fit */
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';

  /** @see https://tailwindcss.com/docs/object-position */
  objectPos?:
    | 'bottom' | 'center' | 'left' | 'left-bottom' | 'left-top'
    | 'right' | 'right-bottom' | 'right-top' | 'top'
    | (string & {});

  /** @see https://tailwindcss.com/docs/overflow */
  overflow?: 'auto' | 'hidden' | 'clip' | 'visible' | 'scroll';
  overflowX?: 'auto' | 'hidden' | 'clip' | 'visible' | 'scroll';
  overflowY?: 'auto' | 'hidden' | 'clip' | 'visible' | 'scroll';

  /** @see https://tailwindcss.com/docs/overscroll-behavior */
  overscroll?: 'auto' | 'contain' | 'none';
  overscrollX?: 'auto' | 'contain' | 'none';
  overscrollY?: 'auto' | 'contain' | 'none';

  /** @see https://tailwindcss.com/docs/position */
  position?: 'static' | 'fixed' | 'absolute' | 'relative' | 'sticky';
  static?: boolean;
  fixed?: boolean;
  absolute?: boolean;
  relative?: boolean;
  sticky?: boolean;

  /** @see https://tailwindcss.com/docs/top-right-bottom-left */
  inset?: SpacingValue;
  insetX?: SpacingValue;
  insetY?: SpacingValue;
  top?: NegativeSpacingValue;
  right?: NegativeSpacingValue;
  bottom?: NegativeSpacingValue;
  left?: NegativeSpacingValue;
  start?: SpacingValue;
  end?: SpacingValue;

  /** @see https://tailwindcss.com/docs/visibility */
  visibility?: 'visible' | 'hidden' | 'collapse';
  visible?: boolean;
  invisible?: boolean;
  collapse?: boolean;

  /** @see https://tailwindcss.com/docs/z-index */
  z?: 'auto' | 0 | 10 | 20 | 30 | 40 | 50 | number | (string & {});
}

// ============================================================================
// Flexbox & Grid Properties
// ============================================================================

/**
 *
 */
export interface FlexboxGridProps {
  /** @see https://tailwindcss.com/docs/flex-basis */
  basis?:
    | SpacingScale | 'px' | 'auto' | 'full'
    | FractionValue | ContainerSize
    | (string & {});

  /** @see https://tailwindcss.com/docs/flex-direction */
  flexDir?: 'row' | 'row-reverse' | 'col' | 'col-reverse';

  /** @see https://tailwindcss.com/docs/flex-wrap */
  flexWrap?: 'wrap' | 'nowrap' | 'wrap-reverse';

  /** @see https://tailwindcss.com/docs/flex-grow */
  grow?: boolean | 0 | number | (string & {});

  /** @see https://tailwindcss.com/docs/flex-shrink */
  shrink?: boolean | 0 | number | (string & {});

  /** @see https://tailwindcss.com/docs/order */
  order?: 'first' | 'last' | 'none' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | number | (string & {});

  /** @see https://tailwindcss.com/docs/grid-template-columns */
  gridCols?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 'none' | 'subgrid' | (string & {});

  /** @see https://tailwindcss.com/docs/grid-template-rows */
  gridRows?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 'none' | 'subgrid' | (string & {});

  /** @see https://tailwindcss.com/docs/grid-column */
  col?: 'auto' | number | (string & {});
  colSpan?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 'full' | number | (string & {});
  colStart?: 'auto' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | number | (string & {});
  colEnd?: 'auto' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | number | (string & {});

  /** @see https://tailwindcss.com/docs/grid-row */
  row?: 'auto' | number | (string & {});
  rowSpan?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 'full' | number | (string & {});
  rowStart?: 'auto' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | number | (string & {});
  rowEnd?: 'auto' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | number | (string & {});

  /** @see https://tailwindcss.com/docs/grid-auto-flow */
  gridFlow?: 'row' | 'col' | 'dense' | 'row-dense' | 'col-dense';

  /** @see https://tailwindcss.com/docs/grid-auto-columns */
  autoCols?: 'auto' | 'min' | 'max' | 'fr' | (string & {});

  /** @see https://tailwindcss.com/docs/grid-auto-rows */
  autoRows?: 'auto' | 'min' | 'max' | 'fr' | (string & {});

  /** @see https://tailwindcss.com/docs/gap */
  gap?: SpacingValue;
  gapX?: SpacingValue;
  gapY?: SpacingValue;

  /** @see https://tailwindcss.com/docs/justify-content */
  justify?:
    | 'normal' | 'start' | 'end' | 'center' | 'between'
    | 'around' | 'evenly' | 'stretch' | 'baseline'
    | 'safe-center' | 'safe-end';

  /** @see https://tailwindcss.com/docs/justify-items */
  justifyItems?: 'start' | 'end' | 'center' | 'stretch' | 'normal' | 'safe-center' | 'safe-end';

  /** @see https://tailwindcss.com/docs/justify-self */
  justifySelf?: 'auto' | 'start' | 'end' | 'center' | 'stretch' | 'safe-center' | 'safe-end';

  // NOTE: align-content is now covered by "content" key in TypographyProps

  /** @see https://tailwindcss.com/docs/align-items */
  items?: 'start' | 'end' | 'center' | 'baseline' | 'stretch' | 'safe-center' | 'safe-end' | (string & {});

  /** @see https://tailwindcss.com/docs/align-self */
  self?: 'auto' | 'start' | 'end' | 'center' | 'stretch' | 'baseline' | 'safe-center' | 'safe-end' | (string & {});

  /** @see https://tailwindcss.com/docs/place-content */
  placeContent?:
    | 'center' | 'start' | 'end' | 'between' | 'around'
    | 'evenly' | 'baseline' | 'stretch' | 'safe-center' | 'safe-end';

  /** @see https://tailwindcss.com/docs/place-items */
  placeItems?: 'start' | 'end' | 'center' | 'baseline' | 'stretch' | 'safe-center' | 'safe-end';

  /** @see https://tailwindcss.com/docs/place-self */
  placeSelf?: 'auto' | 'start' | 'end' | 'center' | 'stretch' | 'safe-center' | 'safe-end';
}

// ============================================================================
// Spacing Properties
// ============================================================================

/**
 *
 */
export interface SpacingProps {
  /** Padding - all sides */
  p?: SpacingValue;
  /** Padding - X axis (left/right) */
  px?: SpacingValue;
  /** Padding - Y axis (top/bottom) */
  py?: SpacingValue;
  /** Padding - top */
  pt?: SpacingValue;
  /** Padding - right */
  pr?: SpacingValue;
  /** Padding - bottom */
  pb?: SpacingValue;
  /** Padding - left */
  pl?: SpacingValue;
  /** Padding - inline start (logical) */
  ps?: SpacingValue;
  /** Padding - inline end (logical) */
  pe?: SpacingValue;

  /** Margin - all sides */
  m?: NegativeSpacingValue;
  /** Margin - X axis (left/right) */
  mx?: NegativeSpacingValue;
  /** Margin - Y axis (top/bottom) */
  my?: NegativeSpacingValue;
  /** Margin - top */
  mt?: NegativeSpacingValue;
  /** Margin - right */
  mr?: NegativeSpacingValue;
  /** Margin - bottom */
  mb?: NegativeSpacingValue;
  /** Margin - left */
  ml?: NegativeSpacingValue;
  /** Margin - inline start (logical) */
  ms?: NegativeSpacingValue;
  /** Margin - inline end (logical) */
  me?: NegativeSpacingValue;

  /** Space between child elements - X axis */
  spaceX?: NegativeSpacingValue;
  /** Space between child elements - Y axis */
  spaceY?: NegativeSpacingValue;
  /** Reverse space-x direction */
  spaceXReverse?: boolean;
  /** Reverse space-y direction */
  spaceYReverse?: boolean;
}

// ============================================================================
// Sizing Properties
// ============================================================================

/**
 *
 */
export interface SizingProps {
  /** @see https://tailwindcss.com/docs/width */
  w?: SpacingScale | 'px' | 'auto' | 'full' | 'screen'
    | 'svw' | 'lvw' | 'dvw' | 'min' | 'max' | 'fit'
    | FractionValue | (string & {});

  /** @see https://tailwindcss.com/docs/min-width */
  minW?: SpacingScale | 'px' | 'full' | 'min' | 'max' | 'fit' | FractionValue | (string & {});

  /** @see https://tailwindcss.com/docs/max-width */
  maxW?:
    | SpacingScale | 'px' | 'full' | 'none' | 'prose'
    | 'min' | 'max' | 'fit' | ContainerSize
    | 'screen-sm' | 'screen-md' | 'screen-lg' | 'screen-xl' | 'screen-2xl'
    | FractionValue | (string & {});

  /** @see https://tailwindcss.com/docs/height */
  h?: SpacingScale | 'px' | 'auto' | 'full' | 'screen'
    | 'svh' | 'lvh' | 'dvh' | 'min' | 'max' | 'fit'
    | FractionValue | (string & {});

  /** @see https://tailwindcss.com/docs/min-height */
  minH?: SpacingScale | 'px' | 'full' | 'screen'
    | 'svh' | 'lvh' | 'dvh' | 'min' | 'max' | 'fit'
    | (string & {});

  /** @see https://tailwindcss.com/docs/max-height */
  maxH?: SpacingScale | 'px' | 'full' | 'screen'
    | 'svh' | 'lvh' | 'dvh' | 'min' | 'max' | 'fit'
    | (string & {});

  /** @see https://tailwindcss.com/docs/size */
  size?: SpacingScale | 'px' | 'auto' | 'full' | 'min' | 'max' | 'fit' | (string & {});
}

// ============================================================================
// Typography Properties
// ============================================================================

/**
 *
 */
export interface TypographyProps {

  /** @see https://tailwindcss.com/docs/font-size — use `color` for text color, `textAlign` for alignment */
  text?:
    | 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl'
    | '6xl' | '7xl' | '8xl' | '9xl'
    | (string & {});

  /** @see https://tailwindcss.com/docs/font-smoothing */
  antialiased?: boolean;
  subpixelAntialiased?: boolean;

  /** @see https://tailwindcss.com/docs/font-style */
  italic?: boolean;
  notItalic?: boolean;

  /** @see https://tailwindcss.com/docs/font-weight */
  fontWeight?:
    | 'thin' | 'extralight' | 'light' | 'normal' | 'medium'
    | 'semibold' | 'bold' | 'extrabold' | 'black'
    | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
    | (string & {});
  /** Explicit font-family key. Use `font` for the short form */
  fontFamily?: 'sans' | 'serif' | 'mono' | (string & {});

  /** @see https://tailwindcss.com/docs/font-stretch */
  fontStretch?:
    | 'ultra-condensed' | 'extra-condensed' | 'condensed' | 'semi-condensed'
    | 'normal' | 'semi-expanded' | 'expanded' | 'extra-expanded' | 'ultra-expanded'
    | (string & {});

  /** @see https://tailwindcss.com/docs/font-variant-numeric */
  ordinal?: boolean;
  slashedZero?: boolean;
  liningNums?: boolean;
  oldstyleNums?: boolean;
  proportionalNums?: boolean;
  tabularNums?: boolean;
  diagonalFractions?: boolean;
  stackedFractions?: boolean;

  /** @see https://tailwindcss.com/docs/letter-spacing */
  tracking?: 'tighter' | 'tight' | 'normal' | 'wide' | 'wider' | 'widest' | (string & {});

  /** @see https://tailwindcss.com/docs/line-clamp */
  lineClamp?: 1 | 2 | 3 | 4 | 5 | 6 | 'none' | number | (string & {});

  /** @see https://tailwindcss.com/docs/line-height */
  leading?:
    | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
    | 'none' | 'tight' | 'snug' | 'normal' | 'relaxed' | 'loose'
    | (string & {});

  /** @see https://tailwindcss.com/docs/list-style-image */
  listImg?: 'none' | (string & {});

  /** @see https://tailwindcss.com/docs/list-style-position */
  listPos?: 'inside' | 'outside';

  /** @see https://tailwindcss.com/docs/list-style-type */
  list?: 'none' | 'disc' | 'decimal' | (string & {});

  /** @see https://tailwindcss.com/docs/text-align */
  textAlign?: 'left' | 'center' | 'right' | 'justify' | 'start' | 'end';

  /** @see https://tailwindcss.com/docs/text-color */
  color?: ColorPropValue;

  /** @see https://tailwindcss.com/docs/text-decoration */
  underline?: boolean;
  overline?: boolean;
  lineThrough?: boolean;
  noUnderline?: boolean;
  /** String-keyed text-decoration prop for arbitrary values */
  decoration?: 'underline' | 'overline' | 'line-through' | 'none' | (string & {});

  /** @see https://tailwindcss.com/docs/text-decoration-color */
  decorationColor?: ColorPropValue;

  /** @see https://tailwindcss.com/docs/text-decoration-style */
  decorationStyle?: 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy';

  /** @see https://tailwindcss.com/docs/text-decoration-thickness */
  decorationThickness?: 'auto' | 'from-font' | 0 | 1 | 2 | 4 | 8 | (string & {});

  /** @see https://tailwindcss.com/docs/text-underline-offset */
  underlineOffset?: 'auto' | 0 | 1 | 2 | 4 | 8 | (string & {});

  /** @see https://tailwindcss.com/docs/text-transform */
  uppercase?: boolean;
  lowercase?: boolean;
  capitalize?: boolean;
  normalCase?: boolean;

  /** @see https://tailwindcss.com/docs/text-overflow */
  truncate?: boolean;
  textEllipsis?: boolean;
  textClip?: boolean;

  /** @see https://tailwindcss.com/docs/text-wrap */
  textWrap?: 'wrap' | 'nowrap' | 'balance' | 'pretty';

  /** @see https://tailwindcss.com/docs/overflow-wrap (v4.1+) */
  wrap?: 'normal' | 'break-word' | 'anywhere';

  /** @see https://tailwindcss.com/docs/text-indent */
  indent?: SpacingValue;

  /** @see https://tailwindcss.com/docs/vertical-align */
  align?:
    | 'baseline' | 'top' | 'middle' | 'bottom'
    | 'text-top' | 'text-bottom' | 'sub' | 'super'
    | (string & {});

  /** @see https://tailwindcss.com/docs/whitespace */
  whitespace?: 'normal' | 'nowrap' | 'pre' | 'pre-line' | 'pre-wrap' | 'break-spaces';

  /** @see https://tailwindcss.com/docs/word-break */
  break?: 'normal' | 'all' | 'keep';

  /** @see https://tailwindcss.com/docs/hyphens */
  hyphens?: 'none' | 'manual' | 'auto';

  /** @see https://tailwindcss.com/docs/content — also handles align-content */
  content?:
    | 'none'
    | 'normal' | 'start' | 'end' | 'center' | 'between'
    | 'around' | 'evenly' | 'baseline' | 'stretch'
    | (string & {});

  /** @see https://tailwindcss.com/docs/forced-color-adjust */
  forcedColorAdjust?: 'auto' | 'none';
}

// ============================================================================
// Background Properties
// ============================================================================

/**
 *
 */
export interface BgImgGradient {
  gradient: 'linear' | 'radial' | 'conic';
  dir?: string | number;
  in?: 'srgb' | 'hsl' | 'oklab' | 'oklch' | 'longer' | 'shorter' | 'increasing' | 'decreasing';
}

/** Background-related sz prop definitions. */
export interface BackgroundProps {
  /** @see https://tailwindcss.com/docs/background-attachment */
  bgAttach?: 'fixed' | 'local' | 'scroll';

  /** @see https://tailwindcss.com/docs/background-clip */
  bgClip?: 'border' | 'padding' | 'content' | 'text';

  /** @see https://tailwindcss.com/docs/background-color */
  bg?: ColorPropValue | (string & {});

  /** @see https://tailwindcss.com/docs/background-origin */
  bgOrigin?: 'border' | 'padding' | 'content';

  /** @see https://tailwindcss.com/docs/background-position */
  bgPos?:
    | 'top-left' | 'top' | 'top-right'
    | 'left' | 'center' | 'right'
    | 'bottom-left' | 'bottom' | 'bottom-right'
    | (string & {});

  /** @see https://tailwindcss.com/docs/background-repeat */
  bgRepeat?: 'repeat' | 'no-repeat' | 'repeat-x' | 'repeat-y' | 'round' | 'space';

  /** @see https://tailwindcss.com/docs/background-size */
  bgSize?: 'auto' | 'cover' | 'contain' | (string & {});

  /** @see https://tailwindcss.com/docs/background-image */
  bgImg?: 'none' | BgImgGradient | (string & {});

  /** @see https://tailwindcss.com/docs/gradient-color-stops */
  from?: ColorPropValue;
  via?: ColorPropValue;
  to?: ColorPropValue;

  /** @see https://tailwindcss.com/docs/gradient-color-stops (position) */
  fromPos?: number | (string & {});
  viaPos?: number | (string & {});
  toPos?: number | (string & {});
}

// ============================================================================
// Border Properties
// ============================================================================

/**
 *
 */
export interface BorderProps {
  /** @see https://tailwindcss.com/docs/border-radius */
  rounded?: BorderRadiusValue;
  roundedT?: BorderRadiusValue;
  roundedR?: BorderRadiusValue;
  roundedB?: BorderRadiusValue;
  roundedL?: BorderRadiusValue;
  roundedTl?: BorderRadiusValue;
  roundedTr?: BorderRadiusValue;
  roundedBl?: BorderRadiusValue;
  roundedBr?: BorderRadiusValue;
  roundedS?: BorderRadiusValue;
  roundedE?: BorderRadiusValue;
  roundedSs?: BorderRadiusValue;
  roundedSe?: BorderRadiusValue;
  roundedEs?: BorderRadiusValue;
  roundedEe?: BorderRadiusValue;

  /** @see https://tailwindcss.com/docs/border-width — use `borderColor` for border color */
  border?: boolean | 0 | 2 | 4 | 8 | (string & {});
  borderX?: boolean | 0 | 2 | 4 | 8 | (string & {});
  borderY?: boolean | 0 | 2 | 4 | 8 | (string & {});
  borderT?: boolean | 0 | 2 | 4 | 8 | (string & {});
  borderR?: boolean | 0 | 2 | 4 | 8 | (string & {});
  borderB?: boolean | 0 | 2 | 4 | 8 | (string & {});
  borderL?: boolean | 0 | 2 | 4 | 8 | (string & {});
  borderS?: boolean | 0 | 2 | 4 | 8 | (string & {});
  borderE?: boolean | 0 | 2 | 4 | 8 | (string & {});

  /** @see https://tailwindcss.com/docs/border-color */
  borderColor?: ColorPropValue;

  /** @see https://tailwindcss.com/docs/border-style */
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double' | 'hidden' | 'none';

  /** @see https://tailwindcss.com/docs/divide-width */
  divideX?: boolean | 0 | 2 | 4 | 8 | 'reverse' | (string & {});
  divideY?: boolean | 0 | 2 | 4 | 8 | 'reverse' | (string & {});

  /** @see https://tailwindcss.com/docs/divide-color */
  divideColor?: ColorPropValue;

  /** @see https://tailwindcss.com/docs/divide-style */
  divideStyle?: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  /** Reverse divide-x direction */
  divideXReverse?: boolean;
  /** Reverse divide-y direction */
  divideYReverse?: boolean;

  /** @see https://tailwindcss.com/docs/outline-width */
  outline?: boolean | 'none' | 0 | 1 | 2 | 4 | 8 | (string & {});

  /** @see https://tailwindcss.com/docs/outline-color */
  outlineColor?: ColorPropValue;

  /** @see https://tailwindcss.com/docs/outline-style */
  outlineStyle?: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';

  /** @see https://tailwindcss.com/docs/outline-offset */
  outlineOffset?: 0 | 1 | 2 | 4 | 8 | (string & {});

  /** @see https://tailwindcss.com/docs/ring-width */
  ring?: boolean | 0 | 1 | 2 | 4 | 8 | 'inset' | (string & {});

  /** @see https://tailwindcss.com/docs/ring-color */
  ringColor?: ColorPropValue;

  /** @see https://tailwindcss.com/docs/ring-offset-width */
  ringOffset?: 0 | 1 | 2 | 4 | 8 | (string & {});

  /** @see https://tailwindcss.com/docs/ring-offset-color */
  ringOffsetColor?: ColorPropValue;
}

// ============================================================================
// Effects Properties
// ============================================================================

/**
 *
 */
export interface EffectsProps {
  /** @see https://tailwindcss.com/docs/box-shadow */
  shadow?: ShadowValue;

  /** @see https://tailwindcss.com/docs/box-shadow-color */
  shadowColor?: ColorPropValue;

  /** Text shadow */
  textShadow?: ShadowValue;
  /** Text shadow color */
  textShadowColor?: ColorPropValue;

  /** Inset shadow */
  insetShadow?: ShadowValue;
  /** Inset shadow color */
  insetShadowColor?: ColorPropValue;

  /** Drop shadow color */
  dropShadowColor?: ColorPropValue;

  /** @see https://tailwindcss.com/docs/opacity */
  opacity?: 0 | 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50
    | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | 100 | number | (string & {});

  /** @see https://tailwindcss.com/docs/mix-blend-mode */
  mixBlend?:
    | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
    | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference'
    | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity' | 'plus-darker' | 'plus-lighter';

  /** @see https://tailwindcss.com/docs/background-blend-mode */
  bgBlend?:
    | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
    | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference'
    | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';
}

// ============================================================================
// Filter Properties
// ============================================================================

/**
 *
 */
export interface FilterProps {
  /** @see https://tailwindcss.com/docs/blur */
  blur?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | true | (string & {});

  /** @see https://tailwindcss.com/docs/brightness */
  brightness?: 0 | 50 | 75 | 90 | 95 | 100 | 105 | 110 | 125 | 150 | 200 | number | (string & {});

  /** @see https://tailwindcss.com/docs/contrast */
  contrast?: 0 | 50 | 75 | 100 | 125 | 150 | 200 | number | (string & {});

  /** @see https://tailwindcss.com/docs/drop-shadow */
  dropShadow?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'none' | true | (string & {});

  /** @see https://tailwindcss.com/docs/grayscale */
  grayscale?: boolean | 0 | (string & {});

  /** @see https://tailwindcss.com/docs/hue-rotate */
  hueRotate?: 0 | 15 | 30 | 60 | 90 | 180 | number | (string & {});

  /** @see https://tailwindcss.com/docs/invert */
  invert?: boolean | 0 | (string & {});

  /** @see https://tailwindcss.com/docs/saturate */
  saturate?: 0 | 50 | 100 | 150 | 200 | number | (string & {});

  /** @see https://tailwindcss.com/docs/sepia */
  sepia?: boolean | 0 | (string & {});

  /** @see https://tailwindcss.com/docs/backdrop-blur */
  backdropBlur?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | true | (string & {});

  /** @see https://tailwindcss.com/docs/backdrop-brightness */
  backdropBrightness?: 0 | 50 | 75 | 90 | 95 | 100 | 105 | 110 | 125 | 150 | 200 | number | (string & {});

  /** @see https://tailwindcss.com/docs/backdrop-contrast */
  backdropContrast?: 0 | 50 | 75 | 100 | 125 | 150 | 200 | number | (string & {});

  /** @see https://tailwindcss.com/docs/backdrop-grayscale */
  backdropGrayscale?: boolean | 0 | (string & {});

  /** @see https://tailwindcss.com/docs/backdrop-hue-rotate */
  backdropHueRotate?: 0 | 15 | 30 | 60 | 90 | 180 | number | (string & {});

  /** @see https://tailwindcss.com/docs/backdrop-invert */
  backdropInvert?: boolean | 0 | (string & {});

  /** @see https://tailwindcss.com/docs/backdrop-opacity */
  backdropOpacity?: 0 | 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50
    | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | 100 | number | (string & {});

  /** @see https://tailwindcss.com/docs/backdrop-saturate */
  backdropSaturate?: 0 | 50 | 100 | 150 | 200 | number | (string & {});

  /** @see https://tailwindcss.com/docs/backdrop-sepia */
  backdropSepia?: boolean | 0 | (string & {});
}

// ============================================================================
// Transform Properties
// ============================================================================

/**
 *
 */
export interface TransformProps {
  /** @see https://tailwindcss.com/docs/scale */
  scale?: 0 | 50 | 75 | 90 | 95 | 100 | 105 | 110 | 125 | 150 | 200 | number | (string & {});
  scaleX?: TransformProps['scale'];
  scaleY?: TransformProps['scale'];
  /** Boolean sugar for 3D scale */
  scale3d?: boolean;

  /** @see https://tailwindcss.com/docs/rotate */
  rotate?: 0 | 1 | 2 | 3 | 6 | 12 | 45 | 90 | 180 | number | (string & {});
  /** Boolean sugar for 3D rotate */
  rotate3d?: boolean;

  /** @see https://tailwindcss.com/docs/translate */
  translateX?: SpacingValue | FractionValue;
  translateY?: SpacingValue | FractionValue;
  /** Boolean sugar for 3D translate */
  translate3d?: boolean;

  /** @see https://tailwindcss.com/docs/skew */
  skewX?: 0 | 1 | 2 | 3 | 6 | 12 | number | (string & {});
  skewY?: 0 | 1 | 2 | 3 | 6 | 12 | number | (string & {});

  /** @see https://tailwindcss.com/docs/transform-origin */
  origin?:
    | 'center' | 'top' | 'top-right' | 'right' | 'bottom-right'
    | 'bottom' | 'bottom-left' | 'left' | 'top-left'
    | (string & {});

  /** Transform rendering hints */
  transformGpu?: boolean;
  transformCpu?: boolean;
  transformNone?: boolean;

  /** @see https://tailwindcss.com/docs/perspective */
  perspective?: 'none' | (string & {});
  perspectiveOrigin?: (string & {});

  /** @see https://tailwindcss.com/docs/backface-visibility */
  backface?: 'visible' | 'hidden';
}

// ============================================================================
// Transition & Animation Properties
// ============================================================================

/**
 *
 */
export interface TransitionAnimationProps {
  /** @see https://tailwindcss.com/docs/transition-property */
  transition?:
    | boolean | 'none' | 'all' | 'colors' | 'opacity' | 'shadow' | 'transform'
    | (string & {});

  /** @see https://tailwindcss.com/docs/transition-duration */
  duration?: 0 | 75 | 100 | 150 | 200 | 300 | 500 | 700 | 1000 | number | (string & {});

  /** @see https://tailwindcss.com/docs/transition-timing-function */
  ease?: 'linear' | 'in' | 'out' | 'in-out' | (string & {});

  /** @see https://tailwindcss.com/docs/transition-delay */
  delay?: 0 | 75 | 100 | 150 | 200 | 300 | 500 | 700 | 1000 | number | (string & {});

  /** @see https://tailwindcss.com/docs/animation */
  animate?: 'none' | 'spin' | 'ping' | 'pulse' | 'bounce' | (string & {});
}

// ============================================================================
// Interactivity Properties
// ============================================================================

/**
 *
 */
export interface InteractivityProps {
  /** @see https://tailwindcss.com/docs/accent-color */
  accent?: 'auto' | ColorPropValue;

  /** @see https://tailwindcss.com/docs/appearance */
  appearance?: 'none' | 'auto';

  /** @see https://tailwindcss.com/docs/cursor */
  cursor?:
    | 'auto' | 'default' | 'pointer' | 'wait' | 'text' | 'move'
    | 'help' | 'not-allowed' | 'none' | 'context-menu' | 'progress'
    | 'cell' | 'crosshair' | 'vertical-text' | 'alias' | 'copy'
    | 'no-drop' | 'grab' | 'grabbing' | 'all-scroll' | 'col-resize'
    | 'row-resize' | 'n-resize' | 's-resize' | 'e-resize' | 'w-resize'
    | 'ne-resize' | 'nw-resize' | 'se-resize' | 'sw-resize' | 'ew-resize'
    | 'ns-resize' | 'nesw-resize' | 'nwse-resize' | 'zoom-in' | 'zoom-out'
    | (string & {});

  /** @see https://tailwindcss.com/docs/caret-color */
  caret?: 'auto' | ColorPropValue;

  /** @see https://tailwindcss.com/docs/pointer-events */
  pointerEvents?: 'none' | 'auto';

  /** @see https://tailwindcss.com/docs/resize */
  resize?: 'none' | 'y' | 'x' | boolean;

  /** @see https://tailwindcss.com/docs/scroll-behavior */
  scroll?: 'auto' | 'smooth';

  /** @see https://tailwindcss.com/docs/scroll-margin */
  scrollM?: SpacingValue;
  scrollMx?: SpacingValue;
  scrollMy?: SpacingValue;
  scrollMt?: SpacingValue;
  scrollMr?: SpacingValue;
  scrollMb?: SpacingValue;
  scrollMl?: SpacingValue;
  scrollMs?: SpacingValue;
  scrollMe?: SpacingValue;

  /** @see https://tailwindcss.com/docs/scroll-padding */
  scrollP?: SpacingValue;
  scrollPx?: SpacingValue;
  scrollPy?: SpacingValue;
  scrollPt?: SpacingValue;
  scrollPr?: SpacingValue;
  scrollPb?: SpacingValue;
  scrollPl?: SpacingValue;
  scrollPs?: SpacingValue;
  scrollPe?: SpacingValue;

  /** @see https://tailwindcss.com/docs/scroll-snap-align */
  snapAlign?: 'start' | 'end' | 'center' | 'align-none';

  /** @see https://tailwindcss.com/docs/scroll-snap-stop */
  snapStop?: 'normal' | 'always';

  /** @see https://tailwindcss.com/docs/scroll-snap-type */
  snapType?: 'none' | 'x' | 'y' | 'both' | 'mandatory' | 'proximity';

  /** @see https://tailwindcss.com/docs/touch-action */
  touch?:
    | 'auto' | 'none' | 'pan-x' | 'pan-left' | 'pan-right'
    | 'pan-y' | 'pan-up' | 'pan-down' | 'pinch-zoom' | 'manipulation';

  /** @see https://tailwindcss.com/docs/user-select */
  select?: 'none' | 'text' | 'all' | 'auto';

  /** @see https://tailwindcss.com/docs/will-change */
  willChange?: 'auto' | 'scroll' | 'contents' | 'transform' | (string & {});
}

// ============================================================================
// SVG Properties
// ============================================================================

/**
 *
 */
export interface SvgProps {
  /** @see https://tailwindcss.com/docs/fill */
  fill?: 'none' | 'current' | ColorPropValue;

  /** @see https://tailwindcss.com/docs/stroke */
  stroke?: 'none' | 'current' | ColorPropValue;

  /** @see https://tailwindcss.com/docs/stroke-width */
  strokeWidth?: 0 | 1 | 2 | number | (string & {});
}

// ============================================================================
// Table Properties
// ============================================================================

/**
 *
 */
export interface TableProps {
  /** @see https://tailwindcss.com/docs/border-collapse */
  borderCollapse?: 'collapse' | 'separate';

  /** @see https://tailwindcss.com/docs/border-spacing */
  borderSpacing?: SpacingValue;
  borderSpacingX?: SpacingValue;
  borderSpacingY?: SpacingValue;

  /** @see https://tailwindcss.com/docs/table-layout */
  tableLayout?: 'auto' | 'fixed';

  /** @see https://tailwindcss.com/docs/caption-side */
  caption?: 'top' | 'bottom';
}

// ============================================================================
// Mask Properties
// ============================================================================

/**
 *
 */
export interface MaskProps {
  /** CSS mask shorthand */
  mask?: 'none' | (string & {});
  /** CSS mask-size */
  maskSize?: 'auto' | 'cover' | 'contain' | (string & {});
  /** CSS mask-position */
  maskPos?: (string & {});
  /** CSS mask-repeat */
  maskRepeat?: 'repeat' | 'no-repeat' | 'repeat-x' | 'repeat-y' | 'round' | 'space';
  /** CSS mask-type (shape-rendering) */
  maskShape?: 'alpha' | 'luminance';
}

// ============================================================================
// Variant Modifiers (Recursive)
// ============================================================================

/**
 * Variant modifiers for pseudo-classes, breakpoints, and states.
 * These allow nesting SzProps for conditional styling.
 */
export interface VariantModifiers {
  // Pseudo-classes
  hover?: SzPropsBase;
  focus?: SzPropsBase;
  active?: SzPropsBase;
  visited?: SzPropsBase;
  target?: SzPropsBase;
  first?: SzPropsBase;
  last?: SzPropsBase;
  only?: SzPropsBase;
  odd?: SzPropsBase;
  even?: SzPropsBase;
  firstOfType?: SzPropsBase;
  lastOfType?: SzPropsBase;
  onlyOfType?: SzPropsBase;
  empty?: SzPropsBase;
  disabled?: SzPropsBase;
  enabled?: SzPropsBase;
  checked?: SzPropsBase;
  indeterminate?: SzPropsBase;
  default?: SzPropsBase;
  required?: SzPropsBase;
  valid?: SzPropsBase;
  invalid?: SzPropsBase;
  inRange?: SzPropsBase;
  outOfRange?: SzPropsBase;
  placeholderShown?: SzPropsBase;
  autofill?: SzPropsBase;
  readOnly?: SzPropsBase;
  focusWithin?: SzPropsBase;
  focusVisible?: SzPropsBase;

  // Pseudo-elements
  before?: SzPropsBase;
  after?: SzPropsBase;
  placeholder?: SzPropsBase;
  file?: SzPropsBase;
  marker?: SzPropsBase;
  selection?: SzPropsBase;
  firstLine?: SzPropsBase;
  firstLetter?: SzPropsBase;
  backdrop?: SzPropsBase;

  // Responsive breakpoints
  sm?: SzPropsBase;
  md?: SzPropsBase;
  lg?: SzPropsBase;
  xl?: SzPropsBase;
  '2xl'?: SzPropsBase;

  // Container queries
  '@sm'?: SzPropsBase;
  '@md'?: SzPropsBase;
  '@lg'?: SzPropsBase;
  '@xl'?: SzPropsBase;
  '@2xl'?: SzPropsBase;

  // Dark mode
  dark?: SzPropsBase;
  light?: SzPropsBase;

  // Motion preferences
  motionReduce?: SzPropsBase;
  motionSafe?: SzPropsBase;

  // Contrast preferences
  contrastMore?: SzPropsBase;
  contrastLess?: SzPropsBase;

  // Print
  print?: SzPropsBase;

  // Orientation
  portrait?: SzPropsBase;
  landscape?: SzPropsBase;

  // RTL/LTR
  rtl?: SzPropsBase;
  ltr?: SzPropsBase;

  // Group/Peer modifiers (true = class, string = named, object = nested variants)
  group?: boolean | string | SzPropsBase;
  peer?: boolean | string | SzPropsBase;

  // Not modifier
  not?: SzPropsBase;

  // Has modifier
  has?: Record<string, SzPropsBase>;

  // Aria states
  aria?: Record<string, SzPropsBase>;

  // Data attributes
  data?: Record<string, SzPropsBase>;

  // Supports queries
  supports?: Record<string, SzPropsBase>;
}

// ============================================================================
// Combined SzProps Type
// ============================================================================

/**
 * Base sz props without variant modifiers (to prevent infinite recursion).
 */
export type SzPropsBase =
  & LayoutProps
  & FlexboxGridProps
  & SpacingProps
  & SizingProps
  & TypographyProps
  & BackgroundProps
  & BorderProps
  & EffectsProps
  & FilterProps
  & TransformProps
  & TransitionAnimationProps
  & InteractivityProps
  & SvgProps
  & TableProps
  & MaskProps
  & { [key: string]: unknown }; // Allow arbitrary keys

/**
 * Complete sz prop type with all properties and variant modifiers.
 *
 * @example
 * ```tsx
 * <div sz={{ p: 4, bg: 'blue-500', hover: { bg: 'blue-700' } }} />
 * ```
 */
export type SzProps = SzPropsBase & VariantModifiers;

/**
 * String-based sz prop for pass-through class names.
 *
 * @example
 * ```tsx
 * <div sz="p-4 bg-blue-500 hover:bg-blue-700" />
 * ```
 */
export type SzPropValue = string | SzProps;
