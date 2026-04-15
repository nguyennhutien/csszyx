/**
 * Static completion data derived from @csszyx/compiler metadata.
 * Built once at module load — all completion lookups are O(1) array reads.
 */

import {
    BOOLEAN_SHORTHANDS,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    SUGGESTION_MAP,
} from '@csszyx/compiler/browser';
import * as vscode from 'vscode';

// ============================================================================
// VALUE SUGGESTION TABLES
// ============================================================================

const TAILWIND_COLORS = [
    'slate', 'gray', 'zinc', 'neutral', 'stone',
    'red', 'orange', 'amber', 'yellow', 'lime',
    'green', 'emerald', 'teal', 'cyan', 'sky',
    'blue', 'indigo', 'violet', 'purple', 'fuchsia',
    'pink', 'rose',
];
const TAILWIND_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const COLOR_VALUES: string[] = [
    'transparent', 'current', 'inherit', 'black', 'white',
    ...TAILWIND_COLORS.flatMap(c => TAILWIND_SHADES.map(s => `${c}-${s}`)),
];

const SPACING_VALUES: string[] = [
    'px', '0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6', '7',
    '8', '9', '10', '11', '12', '14', '16', '20', '24', '28', '32', '36', '40',
    '44', '48', '52', '56', '60', '64', '72', '80', '96',
];
const SIZING_VALUES: string[] = [
    ...SPACING_VALUES, 'auto', 'full', 'screen', 'min', 'max', 'fit',
    'svh', 'lvh', 'dvh', 'svw', 'lvw', 'dvw', '1/2', '1/3', '2/3', '1/4', '3/4',
];
const ROUNDED_VALUES = ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full'];
const BORDER_WIDTH = ['0', '1', '2', '4', '8'];

/** Curated per-prop value suggestions for the most-used sz props. */
export const VALUE_SUGGESTIONS: Record<string, string[]> = {
    // Spacing
    p: SPACING_VALUES, pt: SPACING_VALUES, pr: SPACING_VALUES,
    pb: SPACING_VALUES, pl: SPACING_VALUES, ps: SPACING_VALUES, pe: SPACING_VALUES,
    px: SPACING_VALUES, py: SPACING_VALUES,
    m: [...SPACING_VALUES, 'auto'],
    mt: [...SPACING_VALUES, 'auto'], mr: [...SPACING_VALUES, 'auto'],
    mb: [...SPACING_VALUES, 'auto'], ml: [...SPACING_VALUES, 'auto'],
    ms: [...SPACING_VALUES, 'auto'], me: [...SPACING_VALUES, 'auto'],
    mx: [...SPACING_VALUES, 'auto'], my: [...SPACING_VALUES, 'auto'],
    gap: SPACING_VALUES, gapX: SPACING_VALUES, gapY: SPACING_VALUES,
    spaceX: SPACING_VALUES, spaceY: SPACING_VALUES,

    // Sizing
    w: SIZING_VALUES, h: SIZING_VALUES, size: SIZING_VALUES,
    minW: [...SPACING_VALUES, 'full', 'min', 'max', 'fit'],
    maxW: [...SPACING_VALUES, 'full', 'min', 'max', 'fit', 'screen', 'prose',
        'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl'],
    minH: [...SPACING_VALUES, 'full', 'screen', 'svh', 'lvh', 'dvh', 'min', 'max', 'fit'],
    maxH: [...SPACING_VALUES, 'full', 'screen', 'svh', 'lvh', 'dvh', 'min', 'max', 'fit'],

    // Colors
    bg: COLOR_VALUES,
    color: COLOR_VALUES,
    borderColor: COLOR_VALUES,
    borderColorT: COLOR_VALUES, borderColorR: COLOR_VALUES,
    borderColorB: COLOR_VALUES, borderColorL: COLOR_VALUES,
    outlineColor: COLOR_VALUES, caretColor: COLOR_VALUES,
    accentColor: COLOR_VALUES,
    fill: [...COLOR_VALUES, 'none'], stroke: [...COLOR_VALUES, 'none'],
    from: COLOR_VALUES, via: COLOR_VALUES, to: COLOR_VALUES,
    ringColor: COLOR_VALUES, ringOffsetColor: COLOR_VALUES,
    textDecorationColor: COLOR_VALUES, shadowColor: COLOR_VALUES,
    insetShadowColor: COLOR_VALUES, insetRingColor: COLOR_VALUES,

    // Typography
    text: ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'],
    fontWeight: ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold',
        'bold', 'extrabold', 'black', '100', '200', '300', '400', '500',
        '600', '700', '800', '900'],
    fontFamily: ['sans', 'serif', 'mono'],
    leading: ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose',
        '3', '4', '5', '6', '7', '8', '9', '10'],
    tracking: ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'],
    textAlign: ['left', 'center', 'right', 'justify', 'start', 'end'],
    listStyle: ['none', 'disc', 'decimal'],

    // Layout
    overflow: ['auto', 'hidden', 'clip', 'visible', 'scroll'],
    overflowX: ['auto', 'hidden', 'clip', 'visible', 'scroll'],
    overflowY: ['auto', 'hidden', 'clip', 'visible', 'scroll'],
    overscroll: ['auto', 'contain', 'none'],
    objectFit: ['contain', 'cover', 'fill', 'none', 'scale-down'],
    inset: [...SPACING_VALUES, 'auto', 'full', '1/2', '1/3', '2/3', '1/4', '3/4'],
    insetX: [...SPACING_VALUES, 'auto', 'full', '1/2'],
    insetY: [...SPACING_VALUES, 'auto', 'full', '1/2'],
    top: [...SPACING_VALUES, 'auto', 'full', '1/2'],
    bottom: [...SPACING_VALUES, 'auto', 'full', '1/2'],
    left: [...SPACING_VALUES, 'auto', 'full', '1/2'],
    right: [...SPACING_VALUES, 'auto', 'full', '1/2'],
    float: ['left', 'right', 'none', 'start', 'end'],
    clear: ['left', 'right', 'both', 'none', 'start', 'end'],
    order: ['first', 'last', 'none', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],

    // Flexbox
    flexDir: ['row', 'row-reverse', 'col', 'col-reverse'],
    flexWrap: ['wrap', 'wrap-reverse', 'nowrap'],
    flex: ['1', 'auto', 'none', 'initial'],
    items: ['start', 'end', 'center', 'baseline', 'stretch'],
    justify: ['start', 'end', 'center', 'between', 'around', 'evenly', 'stretch'],
    justifyItems: ['start', 'end', 'center', 'stretch'],
    justifySelf: ['auto', 'start', 'end', 'center', 'stretch'],
    alignSelf: ['auto', 'start', 'end', 'center', 'stretch', 'baseline'],
    content: ['normal', 'center', 'start', 'end', 'between', 'around', 'evenly', 'baseline', 'stretch'],

    // Grid
    gridCols: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'none', 'subgrid'],
    gridRows: ['1', '2', '3', '4', '5', '6', '7', 'none', 'subgrid'],
    colSpan: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'full'],
    rowSpan: ['1', '2', '3', '4', '5', '6', 'full'],
    colStart: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', 'auto'],
    colEnd: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', 'auto'],

    // Border
    border: BORDER_WIDTH, borderT: BORDER_WIDTH, borderR: BORDER_WIDTH,
    borderB: BORDER_WIDTH, borderL: BORDER_WIDTH, borderX: BORDER_WIDTH, borderY: BORDER_WIDTH,
    borderStyle: ['solid', 'dashed', 'dotted', 'double', 'hidden', 'none'],
    rounded: ROUNDED_VALUES, roundedT: ROUNDED_VALUES, roundedB: ROUNDED_VALUES,
    roundedL: ROUNDED_VALUES, roundedR: ROUNDED_VALUES,
    roundedTl: ROUNDED_VALUES, roundedTr: ROUNDED_VALUES,
    roundedBl: ROUNDED_VALUES, roundedBr: ROUNDED_VALUES,
    outline: BORDER_WIDTH,
    outlineStyle: ['none', 'solid', 'dashed', 'dotted', 'double'],
    ring: BORDER_WIDTH,
    insetRing: BORDER_WIDTH,
    ringOffset: BORDER_WIDTH,
    divide: BORDER_WIDTH,
    divideColor: COLOR_VALUES,
    divideStyle: ['solid', 'dashed', 'dotted', 'double', 'none'],

    // Effects
    shadow: ['none', 'sm', 'md', 'lg', 'xl', '2xl', 'inner'],
    insetShadow: ['none', 'sm', 'md', 'lg', 'xl', '2xl'],
    opacity: ['0', '5', '10', '15', '20', '25', '30', '35', '40', '45', '50',
        '55', '60', '65', '70', '75', '80', '85', '90', '95', '100'],
    blur: ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'],
    backdropBlur: ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'],
    brightness: ['0', '50', '75', '90', '95', '100', '105', '110', '125', '150', '200'],
    contrast: ['0', '50', '75', '100', '125', '150', '200'],
    saturate: ['0', '50', '100', '150', '200'],

    // Transitions / Animations
    transition: ['none', 'all', 'colors', 'opacity', 'shadow', 'transform'],
    duration: ['0', '75', '100', '150', '200', '300', '500', '700', '1000'],
    ease: ['linear', 'in', 'out', 'in-out'],
    delay: ['0', '75', '100', '150', '200', '300', '500', '700', '1000'],
    animate: ['none', 'spin', 'ping', 'pulse', 'bounce'],

    // Transforms
    scale: ['0', '50', '75', '90', '95', '100', '105', '110', '125', '150'],
    scaleX: ['0', '50', '75', '90', '95', '100', '105', '110', '125', '150'],
    scaleY: ['0', '50', '75', '90', '95', '100', '105', '110', '125', '150'],
    rotate: ['0', '1', '2', '3', '6', '12', '45', '90', '180'],
    translateX: [...SPACING_VALUES, 'full', '1/2'],
    translateY: [...SPACING_VALUES, 'full', '1/2'],
    skewX: ['0', '1', '2', '3', '6', '12'],
    skewY: ['0', '1', '2', '3', '6', '12'],
    transformOrigin: ['center', 'top', 'top-right', 'right', 'bottom-right',
        'bottom', 'bottom-left', 'left', 'top-left'],

    // Z-index / Cursor / Misc
    z: ['0', '10', '20', '30', '40', '50', 'auto'],
    cursor: ['auto', 'default', 'pointer', 'wait', 'text', 'move', 'help',
        'not-allowed', 'none', 'context-menu', 'progress', 'cell',
        'crosshair', 'grab', 'grabbing', 'col-resize', 'row-resize',
        'zoom-in', 'zoom-out'],
    userSelect: ['none', 'text', 'all', 'auto'],
    pointerEvents: ['none', 'auto'],
    resize: ['none', 'y', 'x', 'both'],
    appearance: ['none', 'auto'],
    aspect: ['auto', 'square', 'video'],

    // Background extras
    bgAttach: ['fixed', 'local', 'scroll'],
    bgClip: ['border', 'padding', 'content', 'text'],
    bgOrigin: ['border', 'padding', 'content'],
    bgPos: ['bottom', 'center', 'left', 'left-bottom', 'left-top',
        'right', 'right-bottom', 'right-top', 'top'],
    bgRepeat: ['repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'round', 'space'],
    bgSize: ['auto', 'cover', 'contain'],

    // Columns
    cols: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
        'auto', '3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl'],
    colBreak: ['auto', 'avoid', 'all', 'avoid-page', 'avoid-column'],
};

// ============================================================================
// PRE-BUILT COMPLETION ITEMS (built once at module load)
// ============================================================================

/**
 * Build a MarkdownString showing the Tailwind prefix for a sz prop.
 * @param tailwindPrefix - The Tailwind utility prefix (e.g. "bg", "p")
 * @returns Formatted MarkdownString for CompletionItem documentation
 */
function doc(tailwindPrefix: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString(`**CSSzyx** → \`${tailwindPrefix}-*\``);
    md.isTrusted = true;
    return md;
}

/** CompletionItems for top-level sz prop keys (PROPERTY_MAP + BOOLEAN_SHORTHANDS). */
export const KEY_COMPLETIONS: vscode.CompletionItem[] = [
    // Regular props from PROPERTY_MAP
    ...Object.entries(PROPERTY_MAP).map(([key, twPrefix]) => {
        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
        item.documentation = doc(twPrefix);
        item.detail = `sz prop → ${twPrefix}-*`;
        item.insertText = new vscode.SnippetString(`${key}: $1,`);
        return item;
    }),
    // Boolean shorthands — value is always `true`
    ...[...BOOLEAN_SHORTHANDS].map(key => {
        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Field);
        item.documentation = new vscode.MarkdownString(`**CSSzyx** boolean shorthand → \`${key}\``);
        item.detail = `sz boolean → ${key}`;
        item.insertText = new vscode.SnippetString(`${key}: true,`);
        return item;
    }),
    // Special: css key for arbitrary CSS
    (() => {
        const item = new vscode.CompletionItem('css', vscode.CompletionItemKind.Property);
        item.documentation = new vscode.MarkdownString('**CSSzyx** arbitrary CSS escape hatch.\n\nAccepts any `CSS.Properties` key + CSS custom properties (`--*`).');
        item.detail = 'sz arbitrary CSS';
        item.insertText = new vscode.SnippetString('css: { $1 },');
        return item;
    })(),
];

/** CompletionItems for variant keys (inside a variant object like `hover: { | }`). */
export const VARIANT_KEY_COMPLETIONS: vscode.CompletionItem[] = Object.entries(PROPERTY_MAP)
    .map(([key, twPrefix]) => {
        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
        item.documentation = doc(twPrefix);
        item.detail = `sz prop → ${twPrefix}-*`;
        item.insertText = new vscode.SnippetString(`${key}: $1,`);
        return item;
    });

/** CompletionItems for top-level variant keys (hover, focus, sm, md, ...). */
export const TOP_LEVEL_VARIANT_COMPLETIONS: vscode.CompletionItem[] = [...KNOWN_VARIANTS].map(v => {
    const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Module);
    item.documentation = new vscode.MarkdownString(`**CSSzyx** variant → \`${v}:\` prefix`);
    item.detail = 'sz variant';
    item.insertText = new vscode.SnippetString(`${v}: { $1 },`);
    return item;
});

/**
 * Build value completion items for a given sz key.
 * @param key - The sz prop key (e.g. "bg", "p")
 * @returns Array of CompletionItems, or empty array if no suggestions exist for this key
 */
export function getValueCompletions(key: string): vscode.CompletionItem[] {
    const values = VALUE_SUGGESTIONS[key];
    if (!values) {return [];}
    return values.map(v => {
        const isNum = !isNaN(Number(v)) && v !== '';
        const item = new vscode.CompletionItem(
            isNum ? v : `'${v}'`,
            isNum ? vscode.CompletionItemKind.Value : vscode.CompletionItemKind.EnumMember,
        );
        item.insertText = isNum ? v : `'${v}'`;
        item.detail = `${key}: ${isNum ? v : `'${v}'`}`;
        return item;
    });
}

// Export compiler data for use by diagnostic-provider and hover-provider
// Re-export for use by diagnostic-provider (avoids a second import of compiler/browser)
export { BOOLEAN_SHORTHANDS, KNOWN_VARIANTS, PROPERTY_MAP, SUGGESTION_MAP };
