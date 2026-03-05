import { Demo } from '../Demo.tsx';

export function BorderRadiusScale() {
    return (
        <Demo label="border radius scale — none, sm, md, lg, full">
            <div sz={{ size: 12, bg: 'sky-200', rounded: 'none', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-800' }}>none</span>
            </div>
            <div sz={{ size: 12, bg: 'sky-300', rounded: 'md', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>md</span>
            </div>
            <div sz={{ size: 12, bg: 'sky-400', rounded: 'xl', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>xl</span>
            </div>
            <div sz={{ size: 12, bg: '--ds-primary', rounded: 'full', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>full</span>
            </div>
        </Demo>
    );
}

export function BorderWidthScale() {
    return (
        <Demo label="border width — 1, 2, 4">
            <div sz={{ w: 16, h: 12, border: true, borderColor: 'sky-400', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>1</span>
            </div>
            <div sz={{ w: 16, h: 12, border: 2, borderColor: 'sky-400', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>2</span>
            </div>
            <div sz={{ w: 16, h: 12, border: 4, borderColor: 'sky-400', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>4</span>
            </div>
        </Demo>
    );
}

export function BorderStyles() {
    return (
        <Demo label="border styles — solid, dashed, dotted">
            <div sz={{ w: 20, h: 10, border: 2, borderStyle: 'solid', borderColor: 'sky-400', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>solid</span>
            </div>
            <div sz={{ w: 20, h: 10, border: 2, borderStyle: 'dashed', borderColor: 'sky-400', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>dashed</span>
            </div>
            <div sz={{ w: 20, h: 10, border: 2, borderStyle: 'dotted', borderColor: 'sky-400', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>dotted</span>
            </div>
        </Demo>
    );
}

export function RingDemo() {
    return (
        <Demo label="ring-2 with ring-offset-2">
            <button sz={{ px: 4, py: 2, bg: '--ds-primary', color: 'white', rounded: 'md', ring: 2, ringColor: '--ds-primary', ringOffset: 2, ringOffsetColor: 'white', text: 'sm', fontFamily: '--ds-font-ui' }}>
                ring-2 + offset-2
            </button>
        </Demo>
    );
}

export function DivideY() {
    return (
        <Demo label="{ divideY: true } — horizontal dividers between rows">
            <div sz={{ divideY: true, divideColor: 'sky-200', w: 48, bg: '--ds-primary-faint', rounded: 'sm' }}>
                <div sz={{ py: 2, px: 3, text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>Row one</div>
                <div sz={{ py: 2, px: 3, text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>Row two</div>
                <div sz={{ py: 2, px: 3, text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>Row three</div>
            </div>
        </Demo>
    );
}
