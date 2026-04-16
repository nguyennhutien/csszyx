import { Demo } from '../Demo.tsx';

// Shared swatch layout — direct reference when no override needed
const swatchLayout = { size: 20, rounded: 'lg', flex: true, items: 'center', justify: 'center' } as const;
const labelWhite = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', color: 'white' } as const;
const labelDark = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', color: 'slate-900' } as const;

export function BackgroundColorSwatches() {
    return (
        <Demo label="background color swatches — gradient to-br">
            <div sz={{ ...swatchLayout, bg: 'violet-400' }}>
                <span sz={labelDark}>violet</span>
            </div>
            <div sz={{ ...swatchLayout, bg: 'sky-400' }}>
                <span sz={labelDark}>sky</span>
            </div>
            <div sz={{ ...swatchLayout, bg: 'emerald-400' }}>
                <span sz={labelDark}>emerald</span>
            </div>
        </Demo>
    );
}

export function BackgroundOpacity() {
    const labelText = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', color: '--ds-text' } as const;
    return (
        <Demo label="{ bg: { color: 'blue-500', op: 50 } } — background with opacity">
            <div sz={{ ...swatchLayout, bg: { color: 'sky-400', op: 100 } }}>
                <span sz={{ ...labelWhite, color: 'slate-900' }}>op-100</span>
            </div>
            <div sz={{ ...swatchLayout, bg: { color: 'sky-400', op: 50 } }}>
                <span sz={labelText}>op-50</span>
            </div>
            <div sz={{ ...swatchLayout, bg: { color: 'sky-400', op: 20 } }}>
                <span sz={labelText}>op-20</span>
            </div>
        </Demo>
    );
}

export function LinearGradient() {
    return (
        <Demo label="linear gradient left → right">
            {/* fixed: to: '--ds-primary' replaced with a concrete color token */}
            <div sz={{ w: 64, h: 14, bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'sky-400', to: 'violet-500', rounded: 'lg' }} />
        </Demo>
    );
}

export function LinearGradientVia() {
    return (
        <Demo label="linear gradient with via stop — blue → purple → pink">
            <div sz={{ w: 64, h: 14, bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'sky-400', via: 'purple-400', to: 'pink-400', rounded: 'lg' }} />
        </Demo>
    );
}
