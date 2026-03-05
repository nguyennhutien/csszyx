import { Demo } from '../Demo.tsx';

export function BackgroundColorSwatches() {
    return (
        <Demo label="background color swatches">
            <div sz={{ size: 14, bg: '--ds-primary', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>primary</span>
            </div>
            <div sz={{ size: 14, bg: 'sky-400', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>sky-400</span>
            </div>
            <div sz={{ size: 14, bg: 'slate-200', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'slate-700' }}>slate-200</span>
            </div>
        </Demo>
    );
}

export function BackgroundOpacity() {
    return (
        <Demo label="{ bg: { color: 'blue-500', op: 50 } } — background with opacity">
            <div sz={{ size: 14, bg: { color: 'sky-400', op: 100 }, rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>op-100</span>
            </div>
            <div sz={{ size: 14, bg: { color: 'sky-400', op: 50 }, rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>op-50</span>
            </div>
            <div sz={{ size: 14, bg: { color: 'sky-400', op: 20 }, rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>op-20</span>
            </div>
        </Demo>
    );
}

export function LinearGradient() {
    return (
        <Demo label="linear gradient left → right">
            <div sz={{ w: 64, h: 12, bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'sky-400', to: '--ds-primary', rounded: 'sm' }} />
        </Demo>
    );
}

export function LinearGradientVia() {
    return (
        <Demo label="linear gradient with via stop — blue → purple → pink">
            <div sz={{ w: 64, h: 12, bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'sky-400', via: 'purple-400', to: 'pink-400', rounded: 'sm' }} />
        </Demo>
    );
}
