import { Demo } from '../Demo.tsx';

// SCREAMING_SNAKE_CASE — module-level shared label styles
// zinc-300 for slightly better contrast on zinc-800 bordered boxes
const LABEL_MUTED = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'zinc-300' } as const;
const LABEL_WHITE = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', color: 'white' } as const;

// Base swatch box — chained into sized and styled variants
const BOX_CENTER = { flex: true, items: 'center', justify: 'center' } as const;
const BOX_BORDER = { ...BOX_CENTER, rounded: 'lg', borderColor: 'violet-500', bg: 'zinc-950' } as const;

export function BorderRadiusScale() {
    const baseBox = { size: 16, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500', ...BOX_CENTER } as const;
    return (
        <Demo label="border radius scale — none, sm, md, lg, full">
            <div sz={{ ...baseBox, rounded: 'none' }}>
                <span sz={LABEL_WHITE}>none</span>
            </div>
            <div sz={{ ...baseBox, rounded: 'md' }}>
                <span sz={LABEL_WHITE}>md</span>
            </div>
            <div sz={{ ...baseBox, rounded: 'xl' }}>
                <span sz={LABEL_WHITE}>xl</span>
            </div>
            <div sz={{ ...baseBox, rounded: 'full' }}>
                <span sz={LABEL_WHITE}>full</span>
            </div>
        </Demo>
    );
}

export function BorderWidthScale() {
    return (
        <Demo label="border width — 1, 2, 4">
            <div sz={{ w: 20, h: 14, border: true, ...BOX_BORDER }}>
                <span sz={LABEL_MUTED}>1</span>
            </div>
            <div sz={{ w: 20, h: 14, border: 2, ...BOX_BORDER }}>
                <span sz={LABEL_MUTED}>2</span>
            </div>
            <div sz={{ w: 20, h: 14, border: 4, ...BOX_BORDER }}>
                <span sz={LABEL_MUTED}>4</span>
            </div>
        </Demo>
    );
}

export function BorderStyles() {
    // borderStyleBox: base styling for style demos — spread override per style
    const borderStyleBox = { w: 24, h: 12, border: 2, borderColor: 'violet-500', rounded: 'lg', bg: 'zinc-950', ...BOX_CENTER } as const;
    return (
        <Demo label="border styles — solid, dashed, dotted">
            <div sz={{ ...borderStyleBox, borderStyle: 'solid' }}>
                <span sz={LABEL_MUTED}>solid</span>
            </div>
            <div sz={{ ...borderStyleBox, borderStyle: 'dashed' }}>
                <span sz={LABEL_MUTED}>dashed</span>
            </div>
            <div sz={{ ...borderStyleBox, borderStyle: 'dotted' }}>
                <span sz={LABEL_MUTED}>dotted</span>
            </div>
        </Demo>
    );
}

export function RingDemo() {
    return (
        <Demo label="ring-2 with ring-offset-2">
            <button sz={{ px: 5, py: 2.5, bg: 'violet-600', color: 'white', rounded: 'lg', ring: 2, ringColor: 'violet-500', ringOffset: 2, ringOffsetColor: 'zinc-950', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold' }}>
                ring-2 + offset-2
            </button>
        </Demo>
    );
}

export function DivideY() {
    // Row style for divider demo — direct variable reference, no override
    const divideRow = { py: 2.5, px: 4, text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'violet-400' } as const;
    return (
        <Demo label="{ divideY: true } — horizontal dividers between rows">
            <div sz={{ divideY: true, divideColor: 'zinc-800', w: 52, bg: 'zinc-950', rounded: 'lg' }}>
                <div sz={divideRow}>Row one</div>
                <div sz={divideRow}>Row two</div>
                <div sz={divideRow}>Row three</div>
            </div>
        </Demo>
    );
}
