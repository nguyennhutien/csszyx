import React from 'react';
import { szv } from '@csszyx/runtime';
import { dynamic } from '@csszyx/dynamic';

import { parseSzObjectEntries } from '../utils/parse-sz-object.js';
import {
    type MarginDirection,
    type PaddingKind,
    resolveMarginViz,
    resolvePaddingKind,
    type SpacingVizProps,
} from '../utils/spacing-viz.js';

interface PropTableRow {
    sz: string;
    tw: string;
    /** Optional visualization rendered in the 3rd column. Use Viz helpers. */
    viz?: React.ReactNode;
}

interface PropTableProps {
    rows: PropTableRow[];
}

const VIZ_ZOOM = 0.32;

// justify is opt-in for SizingViz (start) — all other viz use center.
const vizCellContainerSz = szv({
    base: { w: 40, h: 14, overflow: 'hidden', display: 'flex', items: 'center' },
    variants: { justify: { center: { justify: 'center' }, start: { justify: 'start', pl: 2 } } },
    defaultVariants: { justify: 'center' },
});

/**
 * Isolation container for viz previews.
 * zoom is opt-in: only Flexbox and Grid viz pass it because they render many
 * child elements that need to be scaled down to fit the cell. All other viz
 * (sizing, color, border, etc.) render at 1:1 — their inline-style dimensions
 * already fit within the fixed w-40 h-14 cell without scaling.
 * zoom is not a Tailwind utility — kept as inline style.
 * justify="start" is used by SizingViz so width changes are visible from the left edge.
 */
function VizCell({ children, zoom, justify = 'center' }: { children: React.ReactNode; zoom?: number; justify?: 'center' | 'start' }) {
    return (
        <div className={dynamic(vizCellContainerSz({ justify }))}>
            {zoom != null
                ? <div style={{ zoom }} sz={{ w: 'full', h: 'full', box: 'border', leading: 'none', color: 'transparent', shrink: 0 }}>{children}</div>
                : children
            }
        </div>
    );
}

// ─── Viz helpers ─────────────────────────────────────────────────────────────
//
// SpacingViz prescan anchors — module-level consts so the compiler's
// CallExpression visitor can extract all class names at build time.
//
// PropTable is SSR-only (no client: hydration directive in Astro MDX), so
// dynamic() cannot inject CSS at runtime. Every class used in SpacingViz must
// already be in the Tailwind stylesheet. Defining these objects at module scope
// and referencing them in dynamic() calls lets the prescan add them to the
// safelist, which Tailwind then uses to generate the CSS before serving.

// ── Padding zone override consts — ONLY the per-row padding values ────────────
// Base hatch pattern is written once as inline sz prop in JSX — no repetition.
// dynamic() with these tiny consts is prescanned (TSAsExpression unwrapping fix).
const _O_P4  = { p: 4 } as const;
const _O_PX6 = { px: 6 } as const;
const _O_PY2 = { py: 2 } as const;
const _O_PT4 = { pt: 4 } as const;
const _O_PR2 = { pr: 2 } as const;
const _O_PB4 = { pb: 4 } as const;
const _O_PL2 = { pl: 2 } as const;
const _O_PPX = { p: 'px' } as const;
const _O_P5PX = { p: '5px' } as const;
const _O_PVAR = { p: '--p' } as const;
const _O_PS4 = { ps: 4 } as const;
const _O_PE4 = { pe: 4 } as const;

// ── Padding content box — gradient fill, corners flush on the padded side ─────
const _T_PAD     = { rounded: 'md' } as const;
const _T_PAD_PT4 = { roundedB: 'md' } as const;
const _T_PAD_PR2 = { roundedL: 'md' } as const;
const _T_PAD_PB4 = { roundedT: 'md' } as const;
const _T_PAD_PL2 = { roundedR: 'md' } as const;
// ps (inline-start = left in LTR) → flush left, rounded right
const _T_PAD_PS4 = { roundedR: 'md' } as const;
// pe (inline-end = bottom in vertical writing mode) → flush bottom, rounded top
const _T_PAD_PE4 = { roundedT: 'md' } as const;

// ── Adjacent box — szv over gradient direction for margin viz ─────────────────
const adjBoxSz = szv({
    base: { w: 8, h: 8 },
    variants: {
        dir: {
            right:  { bgImg: { gradient: 'linear', dir: 'to-r' } },
            left:   { bgImg: { gradient: 'linear', dir: 'to-l' } },
            bottom: { bgImg: { gradient: 'linear', dir: 'to-b' } },
            top:    { bgImg: { gradient: 'linear', dir: 'to-t' } },
        },
    },
});

// ── Target (green) + fake margin (yellow) — szv keyed by margin kind ──────────
type MarginKind = 'mr4' | 'mr2' | 'ml2' | 'mb8' | 'mb6' | 'mt4';

const targetMarginSz = szv({
    base: {},
    variants: {
        kind: { mr4: { mr: 4 }, mr2: { mr: 2 }, ml2: { ml: 2 }, mb8: { mb: 8 }, mb6: { mb: 6 }, mt4: { mt: 4 } },
    },
});

// ── Margin viz inner flex container — szv over direction variants ─────────────
const marginContainerSz = szv({
    base: { display: 'flex', items: 'center' },
    variants: { dir: { horiz: { flexDir: 'row' }, vert: { flexDir: 'col' } } },
});

const fakeMarginSz = szv({
    base: {},
    variants: {
        kind: {
            mr4: { before: { insetY: 0, right: -4, pr: 4, roundedL: 'md' }, after: { insetY: 0, right: -4, pr: 4, roundedL: 'md' } },
            mr2: { before: { insetY: 0, right: -2, pr: 2, roundedL: 'md' }, after: { insetY: 0, right: -2, pr: 2, roundedL: 'md' } },
            mb6: { before: { insetX: 0, bottom: -6, pb: 6, roundedT: 'md' }, after: { insetX: 0, bottom: -6, pb: 6, roundedT: 'md' } },
            mb8: { before: { insetX: 0, bottom: -8, pb: 8, roundedT: 'md' }, after: { insetX: 0, bottom: -8, pb: 8, roundedT: 'md' } },
            mt4: { before: { insetX: 0, top: -4, pt: 4, roundedB: 'md' }, after: { insetX: 0, top: -4, pt: 4, roundedB: 'md' } },
            ml2: { before: { insetY: 0, left: -2, pl: 2, roundedR: 'md' }, after: { insetY: 0, left: -2, pl: 2, roundedR: 'md' } },
        },
    },
});

// ── Padding hatch pattern — szv over direction variants ───────────────────────
const hatchSz = szv({
    base: { color: { color: 'indigo-900', op: 66 }, bgPos: 'top-left', bgSize: '8px 8px', bgImg: 'repeating-linear-gradient(315deg,currentColor 0,currentColor 1px,transparent 1px,transparent 50%)', rounded: 'md' },
    variants: {
        dir: {
            horiz: {},
            vert:  { css: { writingMode: 'vertical-lr' } },
        },
    },
});

function resolveMarginKind(dir: MarginDirection, magnitude: number): MarginKind {
    if (dir === 'right') return magnitude === 4 ? 'mr4' : 'mr2';
    if (dir === 'left') return 'ml2';
    if (dir === 'bottom') return magnitude === 8 ? 'mb8' : 'mb6';
    return 'mt4';
}

function paddingOverrideClass(p: number | 'px' | '5px' | '--p'): string {
    if (p === 4) return dynamic(_O_P4);
    if (p === 'px') return dynamic(_O_PPX);
    if (p === '5px') return dynamic(_O_P5PX);
    return dynamic(_O_PVAR);
}

function resolvePaddingClasses(
    kind: PaddingKind,
    p: SpacingVizProps['p'],
): { overrideClass: string; targetClass: string } {
    if (kind === 'p' && p != null) {
        return {
            overrideClass: paddingOverrideClass(p),
            targetClass: p === 4 || p === '5px' || p === '--p' ? '' : dynamic(_T_PAD),
        };
    }
    if (kind === 'px') return { overrideClass: dynamic(_O_PX6), targetClass: '' };
    if (kind === 'py') return { overrideClass: dynamic(_O_PY2), targetClass: '' };
    if (kind === 'pt') return { overrideClass: dynamic(_O_PT4), targetClass: dynamic(_T_PAD_PT4) };
    if (kind === 'pr') return { overrideClass: dynamic(_O_PR2), targetClass: dynamic(_T_PAD_PR2) };
    if (kind === 'pb') return { overrideClass: dynamic(_O_PB4), targetClass: dynamic(_T_PAD_PB4) };
    if (kind === 'ps') return { overrideClass: dynamic(_O_PS4), targetClass: dynamic(_T_PAD_PS4) };
    if (kind === 'pe') return { overrideClass: dynamic(_O_PE4), targetClass: dynamic(_T_PAD_PE4) };
    if (kind === 'pl') return { overrideClass: dynamic(_O_PL2), targetClass: dynamic(_T_PAD_PL2) };
    return { overrideClass: '', targetClass: '' };
}

/**
 * Spacing viz — padding and margin.
 *
 * PADDING: Hatch-pattern zone wraps the content box. The hatch base (bg color,
 *          size, pos, rounded) is resolved via dynamic() from module-level consts —
 *          prescan discovers classes and SSR mangle map is correctly applied.
 *          Per-row padding values come from tiny module-level consts via dynamic().
 *          sz + className merge uses _szMerge (negligible runtime cost).
 *
 * MARGIN:  Two boxes: green target + adjacent box with gradient fading away.
 */
export function SpacingViz(props: SpacingVizProps) {
    const { p, ps, pe } = props;
    const margin = resolveMarginViz(props);

    if (margin) {
        const adjCls = dynamic(adjBoxSz({ dir: margin.direction }));
        const marginKind = resolveMarginKind(margin.direction, margin.magnitude);
        const targetCls    = dynamic(targetMarginSz({ kind: marginKind }));
        const fakeMarginCls = dynamic(fakeMarginSz({  kind: marginKind }));

        const targetBox = <div
          key="target"
          className={`${targetCls} ${fakeMarginCls}`}
          sz={{
            position: 'relative',
            before: { content: '""', box: 'content', position: 'absolute', w: 'full', h: 'full', bg: { color: 'yellow-300', op: 70 } },
            after:  { content: '""', box: 'content', position: 'absolute', w: 'full', h: 'full', color: { color: 'lime-900', op: 90 }, bgPos: 'top-left', bgSize: '8px 8px', bgImg: 'repeating-linear-gradient(315deg, currentColor 0, currentColor 1px, transparent 1px, transparent 50%)' },
          }}
        >
          <div sz={{ position: 'relative', w: 8, h: 8, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'indigo-800', to: 'indigo-900', rounded: 'sm', shrink: 0, z: 2 }} />
        </div>;
        const adjBox    = <div key="adj" className={adjCls} sz={{ from: 'indigo-800', to: 'transparent', rounded: 'md', shrink: 0 }} />;
        const ordered = margin.direction === 'right' || margin.direction === 'bottom'
            ? [targetBox, adjBox] : [adjBox, targetBox];

        return (
            <div sz={{ w: 40, h: 24, display: 'flex', items: 'center', justify: 'center', overflow: 'hidden' }}>
                <div className={dynamic(marginContainerSz({ dir: margin.horizontal ? 'horiz' : 'vert' }))}>
                    {ordered}
                </div>
            </div>
        );
    }

    // ── Padding visualization ─────────────────────────────────────────────────
    const padding = resolvePaddingClasses(resolvePaddingKind(props), p);

    // ps/pe: show text content so the inline-start/end direction is obvious
    const showText = ps != null || pe != null;

    return (
        <div sz={{ w: 40, h: 24, display: 'flex', items: 'center', justify: 'center', overflow: 'hidden' }}>
          <div sz={{ bg: '--sl-color-accent-high', rounded: 'md' }}>
            <div
              className={`${padding.overrideClass} ${dynamic(hatchSz({ dir: pe != null ? 'vert' : 'horiz' }))}`}
              {...(p === '--p' ? { style: { '--p': '0.75em' } as React.CSSProperties } : {})}
            >
              <div
                className={padding.targetClass}
                sz={[{ w: 8, h: 8, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'indigo-800', to: 'indigo-900', shrink: 0 }, pe && { textAlign: 'right' }]}
              >
                {showText && <span sz={{ text: 'xs', fontMono: true, color: 'indigo-200', leading: 'none', select: 'none' }}>ABC</span>}
              </div>
            </div>
          </div>
        </div>
    );
}

// ── SizingViz — szv over all (w, h) combinations used in sizing.mdx ──────────
// w/h without a counterpart get a fixed cross-axis (h: 8 or w: 8).
// MDX passes the actual sz value ('1/2', 'px', …) not the CSS string.
const sizingVizSz = szv({
    base: { bg: '#2dd597' },
    variants: {
        mode: {
            s4:     { w: 4,      h: 4      },
            sFull:  { w: 'full', h: 'full' },
            sHalf:  { w: '1/2',  h: '1/2' },
            sPx:    { w: 'px',   h: 'px'  },
            w4:     { w: 4,      h: 4     },
            wFull:  { w: 'full', h: 4     },
            wHalf:  { w: '1/2',  h: 4     },
            wThird: { w: '1/3',  h: 4     },
            wPx:    { w: 'px',   h: 4     },
            h4:     { w: 4,      h: 4     },
            hFull:  { w: 4,      h: 'full'},
        },
    },
});

type SizingMode = 's4' | 'sFull' | 'sHalf' | 'sPx' | 'w4' | 'wFull' | 'wHalf' | 'wThird' | 'wPx' | 'h4' | 'hFull';

const SQUARE_SIZING_MODES: Record<string, SizingMode> = {
    full: 'sFull',
    '1/2': 'sHalf',
    px: 'sPx',
};
const WIDTH_SIZING_MODES: Record<string, SizingMode> = {
    full: 'wFull',
    '1/2': 'wHalf',
    '1/3': 'wThird',
    px: 'wPx',
};

function resolveSizingMode(w: number | string | undefined, h: number | string | undefined): SizingMode {
    if (w !== undefined && h !== undefined) return SQUARE_SIZING_MODES[String(w)] ?? 's4';
    if (w !== undefined) return WIDTH_SIZING_MODES[String(w)] ?? 'w4';
    if (h === 4) return 'h4';
    if (h !== undefined) return 'hFull';
    return 's4';
}

/** Width/height sizing viz. Accepts the actual sz value ('1/2', 'px', …). */
export function SizingViz({ w, h }: { w?: number | string; h?: number | string }) {
    const mode = resolveSizingMode(w, h);
    return <VizCell justify="start"><div className={dynamic(sizingVizSz({ mode }))} /></VizCell>;
}

/** Color swatch. Accepts a raw CSS color string (hex, rgba, named).
 *  Inline style is intentional: the MDX passes pre-computed CSS color values
 *  (including rgba() with decimals) that can't be reversed to an sz class at
 *  SSR build time without explicit per-color prescan consts. */
export function ColorViz({ color }: { color: string }) {
    return (
        <VizCell>
            <div style={{ background: color }} sz={{ w: 36, h: 10, border: 2, borderColor: { color: 'white', op: 15 }, rounded: 'sm' }} />
        </VizCell>
    );
}

// ── BorderViz — szv with named variant key encoding each (border, borderStyle) combo ─
const borderVizSz = szv({
    base: { w: 10, h: 10, rounded: 'sm' },
    variants: {
        kind: {
            none:   {},
            b1:     { border: true,  borderColor: '#2dd597' },
            b2:     { border: 2,     borderColor: '#2dd597' },
            b4:     { border: 4,     borderColor: '#2dd597' },
            solid:  { border: 2, borderStyle: 'solid',  borderColor: '#2dd597' },
            dashed: { border: 2, borderStyle: 'dashed', borderColor: '#2dd597' },
            dotted: { border: 2, borderStyle: 'dotted', borderColor: '#2dd597' },
            double: { border: 4, borderStyle: 'double', borderColor: '#2dd597' },
        },
    },
});

type BorderKind = 'none' | 'b1' | 'b2' | 'b4' | 'solid' | 'dashed' | 'dotted' | 'double';

function resolveBorderKind(border: number | boolean, borderStyle: string | undefined): BorderKind {
    if (border === 0) return 'none';
    if (
        borderStyle === 'dashed' ||
        borderStyle === 'dotted' ||
        borderStyle === 'double' ||
        borderStyle === 'solid'
    ) {
        return borderStyle;
    }
    if (border === 4) return 'b4';
    if (border === 2) return 'b2';
    return 'b1';
}

/** Border width / style viz. Accepts sz prop names (`border`, `borderStyle`). */
export function BorderViz({ border = true, borderStyle }: {
    border?: number | boolean; borderStyle?: string;
}) {
    const kind = resolveBorderKind(border, borderStyle);
    return <VizCell><div className={dynamic(borderVizSz({ kind }))} /></VizCell>;
}

// ── RadiusViz — szv over all rounded values used in borders.mdx ───────────────
const radiusVizSz = szv({
    base: { bg: '#2dd597', w: 10, h: 10 },
    variants: {
        rounded: {
            sm:   { rounded: 'sm' },
            md:   { rounded: 'md' },
            lg:   { rounded: 'lg' },
            xl:   { rounded: 'xl' },
            full: { rounded: 'full' },
            none: {},
            '5px': { rounded: '5px' },
        },
    },
});

/** Border-radius viz. Accepts the sz `rounded` value ('sm', 'md', '5px', …). */
export function RadiusViz({ rounded }: { rounded: string }) {
    return <VizCell><div className={dynamic(radiusVizSz({ rounded: rounded as 'sm' | 'md' | 'lg' | 'xl' | 'full' | 'none' | '5px' }))} /></VizCell>;
}

// ── Grid container — szv over cols variants used in flex-grid.mdx ────────────
const colsVizSz = szv({
    base: { display: 'grid', w: 60, h: 24, gap: 2, border: true, borderColor: { color: 'emerald-400', op: 40 }, rounded: 'sm', p: 1 },
    variants: { cols: { '1': { gridCols: 1 }, '3': { gridCols: 3 } } },
});

/** Grid columns viz — each column is a thin colored strip. */
export function ColsViz({ cols }: { cols: number }) {
    return (
        <VizCell zoom={VIZ_ZOOM}>
            <div className={dynamic(colsVizSz({ cols: String(cols) as '1' | '3' }))}>
                {Array.from({ length: cols }, (_, i) => (
                    // odd: CSS :nth-child(odd) = 1st,3rd… = index 0,2,4 → dark
                    // even: index 1,3,5 → light tint
                    <div key={i} sz={{
                        bg: { color: 'emerald-400', op: 35 },
                        odd: { bg: '#2dd597' },
                        rounded: 'sm',
                    }} />
                ))}
            </div>
        </VizCell>
    );
}

// Compiler pre-extracts all variant combinations at build time → Tailwind JIT sees every
// class statically → all are in built CSS → runtime szv dispatch just looks them up.
const flexContainerSz = szv({
    base: { display: 'flex', gap: 2, border: true, rounded: 'sm', p: 2, w: 'full', h: 'full' },
    variants: {
        direction: {
            'row':            { flexDir: 'row' },
            'column':         { flexDir: 'col' },
            'row-reverse':    { flexDir: 'row-reverse' },
            'column-reverse': { flexDir: 'col-reverse' },
        },
        justify: {
            'flex-start':    { justify: 'start' },
            'center':        { justify: 'center' },
            'flex-end':      { justify: 'end' },
            'space-between': { justify: 'between' },
            'space-around':  { justify: 'around' },
        },
        items: {
            'stretch':    { items: 'stretch' },
            'center':     { items: 'center' },
            'flex-start': { items: 'start' },
            'flex-end':   { items: 'end' },
            'baseline':   { items: 'baseline' },
        },
        flexWrap: {
            wrap:   { flexWrap: 'wrap' },
            nowrap: { flexWrap: 'nowrap' },
        },
        tint: {
            reverse: { bgImg: { gradient: 'linear', dir: 'to-br' }, from: {color: 'violet-800', op: 20}, to: {color: 'violet-900', op: 20} },
            normal:  { bgImg: { gradient: 'linear', dir: 'to-br' }, from: {color: 'zinc-700', op: 10}, to: {color: 'zinc-800', op: 10} },
        },
    },
    defaultVariants: { direction: 'row', justify: 'flex-start', items: 'stretch', flexWrap: 'nowrap', tint: 'normal' },
});

// All possible box item dimension + style combinations, declared statically so
// the compiler catalog includes every class → Tailwind JIT generates CSS →
// dynamic() in SSR finds classes in built stylesheet (no client:* needed).
const boxItemSz = szv({
    base: { rounded: 'sm', shrink: 0, minH: 2 },
    variants: {
        slot: {
            // Row mode — no explicit height (flex stretch fills container)
            r0:  { w: 7 },  r1:  { w: 10 },  r2:  { w: 8 },
            // Row mode — explicit height (non-stretch alignments)
            r0h: { w: 7,    h: 8  },
            r1h: { w: 10,   h: 13 },
            r2h: { w: 8,    h: 10 },
            // Col mode — percentage width, explicit height, min-width
            c0:  { w: '60%', h: 5, minW: 2 },
            c1:  { w: '90%', h: 5, minW: 2 },
            c2:  { w: '45%', h: 5, minW: 2 },
            // Wrap mode — all boxes same size
            wx:  { w: 23,   h: 8  },
        },
        idx:   { 0: { opacity: 50 }, 1: { opacity: 70 }, 2: { opacity: 90 } },
        color: { normal: { bg: '#2dd597' }, reverse: { bg: '#a78bfa' } },
    },
    defaultVariants: { idx: 0, color: 'normal' },
});

const COL_SLOTS  = ['c0',  'c1',  'c2' ] as const;
const ROW_SLOTS  = ['r0',  'r1',  'r2' ] as const;
const ROWH_SLOTS = ['r0h', 'r1h', 'r2h'] as const;

function resolveFlexSlot(wrap: boolean, isColumn: boolean, needsHeight: boolean, index: number) {
    if (wrap) return 'wx';
    if (isColumn) return COL_SLOTS[index];
    if (needsHeight) return ROWH_SLOTS[index];
    return ROW_SLOTS[index];
}

/** Flex layout viz. */
export function FlexViz({ direction = 'row', wrap = false, justify = 'flex-start', items = 'stretch' }: {
    direction?: string; wrap?: boolean; justify?: string; items?: string;
}) {
    const isCol = direction === 'column' || direction === 'column-reverse';
    const isReverse = direction.includes('reverse');
    // Row-stretch: items fill container height via flex — no explicit h needed.
    // All other modes: explicit h required so items have visible height.
    const needsH = isCol || wrap || items !== 'stretch';

    const divs = wrap ? [0, 1, 2, 3, 4, 5] : [0, 1, 2] as const;

    return (
        <VizCell zoom={VIZ_ZOOM}>
            <div className={dynamic(flexContainerSz({
                direction: direction as 'row' | 'column' | 'row-reverse' | 'column-reverse',
                justify: justify as 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around',
                items: items as 'stretch' | 'center' | 'flex-start' | 'flex-end' | 'baseline',
                flexWrap: wrap ? 'wrap' : 'nowrap',
                tint: isReverse ? 'reverse' : 'normal',
            }))}>
                {divs.map(i => (
                    <div key={i} className={dynamic(boxItemSz({
                        slot: resolveFlexSlot(wrap, isCol, needsH, i),
                        idx: i,
                        color: isReverse ? 'reverse' : 'normal',
                    }))} />
                ))}
            </div>
        </VizCell>
    );
}

// ── OpacityViz — szv over all opacity values used in effects.mdx ──────────────
const opacityVizSz = szv({
    base: { position: 'absolute', inset: 0, bg: '#2dd597' },
    variants: {
        opacity: {
            '0':   { opacity: 0 },
            '35':  { opacity: 35 },
            '50':  { opacity: 50 },
            '75':  { opacity: 75 },
            '100': { opacity: 100 },
        },
    },
});

/** Opacity viz. Pass the sz opacity value (0–100). */
export function OpacityViz({ opacity }: { opacity: number }) {
    return (
        <VizCell>
            <div sz={{ position: 'relative', w: 10, h: 10 }}>
                {/* repeating-linear-gradient has no sz equivalent — inline style is unavoidable */}
                <div sz={{ position: 'absolute', inset: 0 }}
                     style={{ background: 'repeating-linear-gradient(45deg,#334155 0,#334155 8px,#1e293b 8px,#1e293b 16px)' }} />
                <div className={dynamic(opacityVizSz({ opacity: String(opacity) as '0' | '35' | '50' | '75' | '100' }))} />
            </div>
        </VizCell>
    );
}

// ── ShadowViz — szv over all shadow values used in effects.mdx ────────────────
const shadowVizSz = szv({
    base: { bg: 'white', w: 8, h: 8, rounded: 'md' },
    variants: {
        shadow: {
            sm:    { shadow: 'sm' },
            base:  { shadow: true },
            md:    { shadow: 'md' },
            lg:    { shadow: 'lg' },
            xl:    { shadow: 'xl' },
            '2xl': { shadow: '2xl' },
            inner: { shadow: 'inner' },
        },
    },
});

/** Shadow viz. Accepts the sz `shadow` value ('sm', 'md', true, …). */
export function ShadowViz({ shadow }: { shadow: string | boolean }) {
    const s = (shadow === true ? 'base' : shadow) as 'sm' | 'base' | 'md' | 'lg' | 'xl' | '2xl' | 'inner';
    return (
        <VizCell>
            <div sz={{ w: 'full', h: 'full', bg: 'white', display: 'flex', items: 'center', justify: 'center' }}>
                <div className={dynamic(shadowVizSz({ shadow: s }))} />
            </div>
        </VizCell>
    );
}

// ─── PropTable ────────────────────────────────────────────────────────────────

/**
 * Astro's MDX compiler wraps JSX in object literals as {astro:jsx, type, props}
 * instead of React elements. Convert them so React can render them.
 */
function resolveViz(viz: React.ReactNode): React.ReactNode {
    if (viz !== null && typeof viz === 'object' && 'astro:jsx' in (viz as object)) {
        const { type, props } = viz as { type: React.ElementType; props: Record<string, unknown> };
        return React.createElement(type, props);
    }
    return viz;
}

/**
 * Renders an sz prop entry as a syntax-highlighted object token.
 * Handles multi-property and nested objects via recursive entry parsing.
 * Input: "p: 4"  →  { p: 4 }  with token colors per value type.
 */
export function SzToken({ value }: { value: string }) {
    // MDX rows may already include outer { } — strip before parsing
    const trimmed = value.trim();
    const inner = trimmed.startsWith('{') && trimmed.endsWith('}')
        ? trimmed.slice(1, -1).trim()
        : trimmed;

    const entries = parseSzObjectEntries(inner);

    // Bare key with no value (e.g. { nowrap })
    if (entries.length === 0) {
        return (
            <>
                <span className="sz-punct">{'{ '}</span>
                <span className="sz-key">{inner}</span>
                <span className="sz-punct">{' }'}</span>
            </>
        );
    }

    return (
        <>
            <span className="sz-punct">{'{ '}</span>
            {entries.map(({ key, val }, i) => {
                const isNum  = /^-?\d+(\.\d+)?$/.test(val);
                const isBool = val === 'true' || val === 'false';
                const isStr  = /^['"]/.test(val);
                const isObj  = val.startsWith('{');
                let valClass = 'sz-punct';
                if (isNum) valClass = 'sz-val-num';
                else if (isBool) valClass = 'sz-val-bool';
                else if (isStr) valClass = 'sz-val-str';
                return (
                    <React.Fragment key={i}>
                        {i > 0 && <span className="sz-punct">{', '}</span>}
                        <span className="sz-key">{key}</span>
                        <span className="sz-punct">{': '}</span>
                        {isObj
                            ? <SzToken value={val} />
                            : <span className={valClass}>{val}</span>
                        }
                    </React.Fragment>
                );
            })}
            <span className="sz-punct">{' }'}</span>
        </>
    );
}

/**
 * Three-column sz → Tailwind → visualization table for props reference pages.
 */
export function PropTable({ rows }: PropTableProps) {
    const hasViz = rows.some(r => r.viz != null);
    return (
        // width:100% overrides the fit-content default set by design-system.css
        // for regular markdown tables — PropTable always fills its container.
        <table>
            <thead>
                <tr>
                    {(['sz prop', 'Tailwind class'] as const).map(label => (
                        <th key={label}>
                            {label}
                        </th>
                    ))}
                    {hasViz && (
                        <th>Preview</th>
                    )}
                </tr>
            </thead>
            <tbody>
                {rows.map((row, i) => (
                    <tr key={i}>
                        <td sz={{
                            fontFamily: '--ds-font-ui',
                            text: 'xs',
                            whitespace: 'nowrap',
                        }}>
                            <SzToken value={row.sz} />
                        </td>
                        <td sz={{
                            fontFamily: '--ds-font-ui',
                            text: 'xs',
                            color: '--ds-text',
                            whitespace: 'nowrap',
                        }}>
                            {row.tw}
                        </td>
                        {hasViz && (
                            <td className='not-content'>{resolveViz(row.viz) ?? null}</td>
                        )}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
