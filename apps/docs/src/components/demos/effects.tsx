import { Demo } from '../Demo.tsx';

export function BoxShadowScale() {
    return (
        <Demo label="box shadow scale — sm, md, xl">
            <div sz={{ size: 14, bg: 'white', shadow: 'sm', rounded: 'md', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-text-muted' }}>sm</span>
            </div>
            <div sz={{ size: 14, bg: 'white', shadow: 'md', rounded: 'md', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-text-muted' }}>md</span>
            </div>
            <div sz={{ size: 14, bg: 'white', shadow: 'xl', rounded: 'md', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-text-muted' }}>xl</span>
            </div>
        </Demo>
    );
}

export function OpacityScale() {
    return (
        <Demo label="opacity — 100, 50, 25">
            <div sz={{ size: 14, bg: '--ds-primary', rounded: 'md', opacity: 100, flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>100</span>
            </div>
            <div sz={{ size: 14, bg: '--ds-primary', rounded: 'md', opacity: 50, flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>50</span>
            </div>
            <div sz={{ size: 14, bg: '--ds-primary', rounded: 'md', opacity: 25, flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>25</span>
            </div>
        </Demo>
    );
}

export function BlurScale() {
    return (
        <Demo label="blur scale — none, sm, md">
            <div sz={{ size: 14, bg: 'sky-400', rounded: 'md', blur: 'none', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>none</span>
            </div>
            <div sz={{ size: 14, bg: 'sky-400', rounded: 'md', blur: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>sm</span>
            </div>
            <div sz={{ size: 14, bg: 'sky-400', rounded: 'md', blur: 'md', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>md</span>
            </div>
        </Demo>
    );
}

export function GrayscaleFilter() {
    return (
        <Demo label="grayscale filter — color vs grayscale">
            <div sz={{ size: 14, bg: 'sky-400', rounded: 'md', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>color</span>
            </div>
            <div sz={{ size: 14, bg: 'sky-400', rounded: 'md', grayscale: true, flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>grayscale</span>
            </div>
            <div sz={{ size: 14, bg: 'sky-400', rounded: 'md', sepia: true, flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>sepia</span>
            </div>
        </Demo>
    );
}
