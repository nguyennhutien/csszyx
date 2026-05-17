/**
 * Property Type System for CSS Variable Auto-Compile.
 *
 * Maps every sz property to its CSS variable value generation strategy,
 * determining how dynamic values should be converted to inline style values.
 *
 * @module @csszyx/compiler/property-types
 */

/**
 * Property categories for CSS variable value generation.
 * Each category determines how a dynamic runtime value is transformed
 * into a CSS custom property value.
 */
export enum PropertyCategory {
    /** Spacing props (p, m, gap, inset, top, etc.) → calc(N * var(--spacing)) */
    SPACING,
    /** Color props (bg, color, borderColor, etc.) → __szColorVar(value) */
    COLOR,
    /** Fraction props (w, h when value like '1/2') → percentage */
    FRACTION,
    /** Unitless number props (z, order, columns, opacity) → direct number */
    UNITLESS,
    /** Angle props (rotate, skew) → Ndeg */
    ANGLE,
    /** Duration props (duration, delay) → Nms */
    DURATION,
    /** Already has [] brackets → pass-through */
    ARBITRARY,
    /** Unknown → direct pass-through */
    PASSTHROUGH,
}

/**
 * Maps sz property names to their PropertyCategory.
 * Covers all ~200 properties from PROPERTY_MAP in transform.ts.
 */
export const PROPERTY_CATEGORY_MAP: Record<string, PropertyCategory> = {
    // ---- SPACING ----
    p: PropertyCategory.SPACING,
    pt: PropertyCategory.SPACING,
    pr: PropertyCategory.SPACING,
    pb: PropertyCategory.SPACING,
    pl: PropertyCategory.SPACING,
    px: PropertyCategory.SPACING,
    py: PropertyCategory.SPACING,
    ps: PropertyCategory.SPACING,
    pe: PropertyCategory.SPACING,
    pbs: PropertyCategory.SPACING,
    pbe: PropertyCategory.SPACING,
    m: PropertyCategory.SPACING,
    mt: PropertyCategory.SPACING,
    mr: PropertyCategory.SPACING,
    mb: PropertyCategory.SPACING,
    ml: PropertyCategory.SPACING,
    mx: PropertyCategory.SPACING,
    my: PropertyCategory.SPACING,
    ms: PropertyCategory.SPACING,
    me: PropertyCategory.SPACING,
    mbs: PropertyCategory.SPACING,
    mbe: PropertyCategory.SPACING,
    spaceX: PropertyCategory.SPACING,
    spaceY: PropertyCategory.SPACING,
    gap: PropertyCategory.SPACING,
    gapX: PropertyCategory.SPACING,
    gapY: PropertyCategory.SPACING,
    inset: PropertyCategory.SPACING,
    insetX: PropertyCategory.SPACING,
    insetY: PropertyCategory.SPACING,
    top: PropertyCategory.SPACING,
    right: PropertyCategory.SPACING,
    bottom: PropertyCategory.SPACING,
    left: PropertyCategory.SPACING,
    start: PropertyCategory.SPACING,
    end: PropertyCategory.SPACING,
    insetS: PropertyCategory.SPACING,
    insetE: PropertyCategory.SPACING,
    insetBs: PropertyCategory.SPACING,
    insetBe: PropertyCategory.SPACING,
    w: PropertyCategory.SPACING,
    minW: PropertyCategory.SPACING,
    maxW: PropertyCategory.SPACING,
    h: PropertyCategory.SPACING,
    minH: PropertyCategory.SPACING,
    maxH: PropertyCategory.SPACING,
    size: PropertyCategory.SPACING,
    blockSize: PropertyCategory.SPACING,
    minBlockSize: PropertyCategory.SPACING,
    maxBlockSize: PropertyCategory.SPACING,
    inlineSize: PropertyCategory.SPACING,
    minInlineSize: PropertyCategory.SPACING,
    maxInlineSize: PropertyCategory.SPACING,
    basis: PropertyCategory.SPACING,
    indent: PropertyCategory.SPACING,
    scrollM: PropertyCategory.SPACING,
    scrollMt: PropertyCategory.SPACING,
    scrollMr: PropertyCategory.SPACING,
    scrollMb: PropertyCategory.SPACING,
    scrollMl: PropertyCategory.SPACING,
    scrollMs: PropertyCategory.SPACING,
    scrollMe: PropertyCategory.SPACING,
    scrollMx: PropertyCategory.SPACING,
    scrollMy: PropertyCategory.SPACING,
    scrollP: PropertyCategory.SPACING,
    scrollPt: PropertyCategory.SPACING,
    scrollPr: PropertyCategory.SPACING,
    scrollPb: PropertyCategory.SPACING,
    scrollPl: PropertyCategory.SPACING,
    scrollPs: PropertyCategory.SPACING,
    scrollPe: PropertyCategory.SPACING,
    scrollPx: PropertyCategory.SPACING,
    scrollPy: PropertyCategory.SPACING,
    scrollPbs: PropertyCategory.SPACING,
    scrollPbe: PropertyCategory.SPACING,
    scrollMbs: PropertyCategory.SPACING,
    scrollMbe: PropertyCategory.SPACING,
    translateX: PropertyCategory.SPACING,
    translateY: PropertyCategory.SPACING,
    borderSpacing: PropertyCategory.SPACING,
    borderSpacingX: PropertyCategory.SPACING,
    borderSpacingY: PropertyCategory.SPACING,
    outlineOffset: PropertyCategory.SPACING,
    ringOffset: PropertyCategory.SPACING,
    underlineOffset: PropertyCategory.SPACING,

    // ---- COLOR ----
    bg: PropertyCategory.COLOR,
    color: PropertyCategory.COLOR,
    borderColor: PropertyCategory.COLOR,
    divideColor: PropertyCategory.COLOR,
    outlineColor: PropertyCategory.COLOR,
    ringColor: PropertyCategory.COLOR,
    ringOffsetColor: PropertyCategory.COLOR,
    shadowColor: PropertyCategory.COLOR,
    textShadowColor: PropertyCategory.COLOR,
    decorationColor: PropertyCategory.COLOR,
    accent: PropertyCategory.COLOR,
    caret: PropertyCategory.COLOR,
    fill: PropertyCategory.COLOR,
    stroke: PropertyCategory.COLOR,
    from: PropertyCategory.COLOR,
    via: PropertyCategory.COLOR,
    to: PropertyCategory.COLOR,
    dropShadowColor: PropertyCategory.COLOR,

    // ---- UNITLESS ----
    opacity: PropertyCategory.UNITLESS,
    z: PropertyCategory.UNITLESS,
    order: PropertyCategory.UNITLESS,
    columns: PropertyCategory.UNITLESS,
    gridCols: PropertyCategory.UNITLESS,
    gridRows: PropertyCategory.UNITLESS,
    col: PropertyCategory.UNITLESS,
    colSpan: PropertyCategory.UNITLESS,
    colStart: PropertyCategory.UNITLESS,
    colEnd: PropertyCategory.UNITLESS,
    row: PropertyCategory.UNITLESS,
    rowSpan: PropertyCategory.UNITLESS,
    rowStart: PropertyCategory.UNITLESS,
    rowEnd: PropertyCategory.UNITLESS,
    lineClamp: PropertyCategory.UNITLESS,
    grow: PropertyCategory.UNITLESS,
    shrink: PropertyCategory.UNITLESS,
    scale: PropertyCategory.UNITLESS,
    scaleX: PropertyCategory.UNITLESS,
    scaleY: PropertyCategory.UNITLESS,
    brightness: PropertyCategory.UNITLESS,
    contrast: PropertyCategory.UNITLESS,
    saturate: PropertyCategory.UNITLESS,
    hueRotate: PropertyCategory.UNITLESS,
    backdropBrightness: PropertyCategory.UNITLESS,
    backdropContrast: PropertyCategory.UNITLESS,
    backdropSaturate: PropertyCategory.UNITLESS,
    backdropHueRotate: PropertyCategory.UNITLESS,
    backdropOpacity: PropertyCategory.UNITLESS,
    strokeWidth: PropertyCategory.UNITLESS,
    border: PropertyCategory.UNITLESS,
    borderT: PropertyCategory.UNITLESS,
    borderR: PropertyCategory.UNITLESS,
    borderB: PropertyCategory.UNITLESS,
    borderL: PropertyCategory.UNITLESS,
    borderX: PropertyCategory.UNITLESS,
    borderY: PropertyCategory.UNITLESS,
    borderS: PropertyCategory.UNITLESS,
    borderE: PropertyCategory.UNITLESS,
    borderBs: PropertyCategory.UNITLESS,
    borderBe: PropertyCategory.UNITLESS,
    ring: PropertyCategory.UNITLESS,
    outline: PropertyCategory.UNITLESS,
    leading: PropertyCategory.UNITLESS,
    decorationThickness: PropertyCategory.UNITLESS,

    // ---- ANGLE ----
    rotate: PropertyCategory.ANGLE,
    skewX: PropertyCategory.ANGLE,
    skewY: PropertyCategory.ANGLE,

    // ---- DURATION ----
    duration: PropertyCategory.DURATION,
    delay: PropertyCategory.DURATION,
    animationDelay: PropertyCategory.DURATION,
};

/**
 * Returns the PropertyCategory for a given sz property name.
 * Falls back to PASSTHROUGH for unknown properties.
 * @param property - the sz property name to look up
 * @returns the PropertyCategory for the property, or PASSTHROUGH if unknown
 */
export function getPropertyCategory(property: string): PropertyCategory {
    return PROPERTY_CATEGORY_MAP[property] ?? PropertyCategory.PASSTHROUGH;
}

/**
 * Set of all properties that are color-type.
 * Used for quick lookup to determine if __szColorVar import is needed.
 */
export const COLOR_PROPERTIES: Set<string> = new Set(
    Object.entries(PROPERTY_CATEGORY_MAP)
        .filter(([, cat]) => cat === PropertyCategory.COLOR)
        .map(([key]) => key),
);

/**
 * Generates the CSS variable naming convention for a property.
 * @param property - the sz property name
 * @param variantPrefix - variant chain (e.g., 'hover', 'md')
 * @returns CSS variable name like '--_sz-p' or '--_sz-hover-bg'
 */
export function getCSSVariableName(property: string, variantPrefix?: string): string {
    const prop = property.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    if (variantPrefix) {
        return `--_sz-${variantPrefix}-${prop}`;
    }
    return `--_sz-${prop}`;
}
