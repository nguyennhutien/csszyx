import { Demo } from '../Demo.tsx';

export function ScaleDemo() {
    return (
        <Demo label="scale — 90, 100, 110 side by side">
            <div sz={{ size: 12, bg: 'sky-300', rounded: 'sm', scale: 90, flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>90</span>
            </div>
            <div sz={{ size: 12, bg: 'sky-400', rounded: 'sm', scale: 100, flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>100</span>
            </div>
            <div sz={{ size: 12, bg: '--ds-primary', rounded: 'sm', scale: 110, flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>110</span>
            </div>
        </Demo>
    );
}

export function RotateDemo() {
    return (
        <Demo label="rotate — 0, 45, 90 side by side">
            <div sz={{ size: 12, bg: 'sky-300', rounded: 'sm', rotate: 0, flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>0</span>
            </div>
            <div sz={{ size: 12, bg: 'sky-400', rounded: 'sm', rotate: 45, flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>45</span>
            </div>
            <div sz={{ size: 12, bg: '--ds-primary', rounded: 'sm', rotate: 90, flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>90</span>
            </div>
        </Demo>
    );
}

export function TranslateDemo() {
    return (
        <Demo label="{ translateX: 4 } — shifted right by 1rem">
            <div sz={{ size: 12, bg: 'sky-200', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-800' }}>origin</span>
            </div>
            <div sz={{ size: 12, bg: '--ds-primary', rounded: 'sm', translateX: 4, flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>+X 4</span>
            </div>
        </Demo>
    );
}

export function SkewDemo() {
    return (
        <Demo label="skewX — 0 vs skewX-6">
            <div sz={{ px: 4, py: 3, bg: 'sky-200', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-800' }}>no skew</span>
            </div>
            <div sz={{ px: 4, py: 3, bg: '--ds-primary', rounded: 'sm', skewX: 6, flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>skewX-6</span>
            </div>
        </Demo>
    );
}

export function TransformStyle3D() {
    return (
        <Demo label="{ rotateY: 45, transformStyle: '3d' } — 3D rotation">
            <div sz={{ size: 16, bg: 'sky-300', rounded: 'sm', rotateY: 45, transformStyle: '3d', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>rotateY-45</span>
            </div>
        </Demo>
    );
}
