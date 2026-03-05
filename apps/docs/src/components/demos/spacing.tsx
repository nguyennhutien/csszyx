import { Demo } from '../Demo.tsx';

export function PaddingScale() {
    return (
        <Demo label="padding scale — p-2, p-4, p-8">
            <div sz={{ p: 2, bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>p-2</div>
            <div sz={{ p: 4, bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>p-4</div>
            <div sz={{ p: 8, bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>p-8</div>
        </Demo>
    );
}

export function AsymmetricPadding() {
    return (
        <Demo label="{ px: 8, py: 2 } — asymmetric padding">
            <button sz={{ px: 8, py: 2, bg: '--ds-primary', color: 'white', rounded: 'sm', text: 'sm', fontFamily: '--ds-font-ui' }}>
                Button
            </button>
        </Demo>
    );
}

export function MarginAuto() {
    return (
        <Demo label="{ mx: 'auto' } — horizontally centered box">
            <div sz={{ w: 48, bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm' }}>
                <div sz={{ mx: 'auto', w: 24, bg: '--ds-primary', rounded: 'sm', py: 2, text: 'xs', fontFamily: '--ds-font-ui', color: 'white', textAlign: 'center' }}>
                    mx-auto
                </div>
            </div>
        </Demo>
    );
}

export function SpaceX() {
    return (
        <Demo label="{ spaceX: 4 } — horizontal space between three items">
            <div sz={{ flex: true, spaceX: 4 }}>
                <div sz={{ p: 3, bg: 'sky-100', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>Item 1</div>
                <div sz={{ p: 3, bg: 'sky-100', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>Item 2</div>
                <div sz={{ p: 3, bg: 'sky-100', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>Item 3</div>
            </div>
        </Demo>
    );
}

export function SpaceY() {
    return (
        <Demo label="{ spaceY: 2 } — vertical space between stacked items">
            <div sz={{ spaceY: 2, w: 40 }}>
                <div sz={{ p: 2, bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>Row 1</div>
                <div sz={{ p: 2, bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>Row 2</div>
                <div sz={{ p: 2, bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>Row 3</div>
            </div>
        </Demo>
    );
}
