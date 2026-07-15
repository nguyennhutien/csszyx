/** Inputs accepted by the spacing visualization. */
export interface SpacingVizProps {
    p?: number | 'px' | '5px' | '--p';
    px?: number;
    py?: number;
    pt?: number;
    pr?: number;
    pb?: number;
    pl?: number;
    ps?: number;
    pe?: number;
    m?: number;
    mx?: number;
    my?: number;
    mt?: number;
    mr?: number;
    mb?: number;
    ml?: number;
}

/** Visual direction used to place a margin's adjacent box. */
export type MarginDirection = 'right' | 'left' | 'bottom' | 'top';

/** Selected padding input, following the component's display precedence. */
export type PaddingKind =
    | 'p'
    | 'px'
    | 'py'
    | 'pt'
    | 'pr'
    | 'pb'
    | 'ps'
    | 'pe'
    | 'pl'
    | 'none';

/** Resolved margin layout inputs. */
export interface MarginVizState {
    /** Direction of the visualized margin. */
    direction: MarginDirection;
    /** Absolute spacing magnitude. */
    magnitude: number;
    /** Whether boxes flow along the inline axis. */
    horizontal: boolean;
}

/**
 * Resolve margin direction with the same precedence as the public props.
 * @param props - Spacing visualization inputs.
 * @returns Direction selected by the first applicable edge/axis prop.
 */
function resolveMarginDirection(props: SpacingVizProps): MarginDirection {
    if (props.mr != null) return 'right';
    if (props.ml != null) return 'left';
    if (props.mb != null) return 'bottom';
    if (props.mt != null) return 'top';
    if (props.mx != null || props.m != null) return 'right';
    if (props.my != null) return 'bottom';
    return 'right';
}

/**
 * Resolve margin visualization state when any margin prop is present.
 * @param props - Spacing visualization inputs.
 * @returns Margin state, or null for padding-only inputs.
 */
export function resolveMarginViz(props: SpacingVizProps): MarginVizState | null {
    const values = [props.m, props.mx, props.my, props.mt, props.mr, props.mb, props.ml];
    if (!values.some(value => value != null)) return null;

    const direction = resolveMarginDirection(props);
    return {
        direction,
        magnitude: Math.abs(
            props.mr ?? props.ml ?? props.mb ?? props.mt ?? props.mx ?? props.my ?? props.m ?? 0,
        ),
        horizontal: direction === 'right' || direction === 'left',
    };
}

/**
 * Resolve the displayed padding prop using the component's established precedence.
 * @param props - Spacing visualization inputs.
 * @returns Selected padding kind, or none when no padding prop is present.
 */
export function resolvePaddingKind(props: SpacingVizProps): PaddingKind {
    if (props.p != null) return 'p';
    if (props.px != null) return 'px';
    if (props.py != null) return 'py';
    if (props.pt != null) return 'pt';
    if (props.pr != null) return 'pr';
    if (props.pb != null) return 'pb';
    if (props.ps != null) return 'ps';
    if (props.pe != null) return 'pe';
    if (props.pl != null) return 'pl';
    return 'none';
}
