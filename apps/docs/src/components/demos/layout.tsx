import { Demo } from '../Demo.tsx';

export function FlexRow() {
    return (
        <Demo label="flex: true — children laid out in a row">
            <div sz={{ flex: true, gap: 3 }}>
                <div sz={{ p: 3, bg: 'sky-100', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>A</div>
                <div sz={{ p: 3, bg: 'sky-100', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>B</div>
                <div sz={{ p: 3, bg: 'sky-100', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>C</div>
            </div>
        </Demo>
    );
}

export function BlockVsInlineBlock() {
    return (
        <Demo label="block: true vs inlineBlock: true">
            <div sz={{ w: 48 }}>
                <div sz={{ block: true, bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', p: 2, text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary', mb: 1 }}>block (full width)</div>
                <span sz={{ inlineBlock: true, bg: 'sky-100', rounded: 'sm', p: 2, text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>inline</span>
                <span sz={{ inlineBlock: true, bg: 'sky-100', rounded: 'sm', p: 2, text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700', ml: 1 }}>block</span>
            </div>
        </Demo>
    );
}

export function AbsoluteOverlay() {
    return (
        <Demo label="relative parent + absolute child overlay">
            <div sz={{ relative: true, w: 32, h: 20, bg: 'sky-100', rounded: 'sm', border: true, borderColor: 'sky-200' }}>
                <div sz={{ absolute: true, inset: 0, flex: true, items: 'center', justify: 'center' }}>
                    <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>parent</span>
                </div>
                <div sz={{ absolute: true, top: 0, right: 0, bg: '--ds-primary', rounded: 'sm', px: 1.5, py: 0.5 }}>
                    <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>abs</span>
                </div>
            </div>
        </Demo>
    );
}

export function OverflowHidden() {
    return (
        <Demo label="{ overflow: 'hidden' } — long text clipped to box">
            <div sz={{ w: 40, h: 12, overflow: 'hidden', bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', p: 2 }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>
                    This text is intentionally long and will be clipped by overflow-hidden at the box boundary.
                </span>
            </div>
        </Demo>
    );
}

export function ZIndex() {
    return (
        <Demo label="z-index — higher z stacks on top">
            <div sz={{ relative: true, w: 40, h: 20 }}>
                <div sz={{ absolute: true, top: 0, left: 0, z: 10, w: 28, h: 16, bg: 'sky-200', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                    <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-800' }}>z-10</span>
                </div>
                <div sz={{ absolute: true, top: 4, left: 8, z: 20, w: 28, h: 16, bg: '--ds-primary', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                    <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>z-20 (top)</span>
                </div>
            </div>
        </Demo>
    );
}

export function AspectRatio() {
    return (
        <Demo label="aspect ratio comparison">
            <div sz={{ aspect: 'square', w: 16, bg: 'sky-100', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>1:1</span>
            </div>
            <div sz={{ aspect: 'video', w: 24, bg: '--ds-primary-faint', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>16:9</span>
            </div>
        </Demo>
    );
}
