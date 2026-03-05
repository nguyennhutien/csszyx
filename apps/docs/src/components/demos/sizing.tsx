import { Demo } from '../Demo.tsx';

export function WidthScale() {
    return (
        <Demo label="width scale — w-8, w-16, w-32">
            <div sz={{ flex: true, flexDir: 'col', gap: 2, items: 'start' }}>
                <div sz={{ w: 8, h: 6, bg: 'sky-200', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                    <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-800' }}>w-8</span>
                </div>
                <div sz={{ w: 16, h: 6, bg: 'sky-300', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                    <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>w-16</span>
                </div>
                <div sz={{ w: 32, h: 6, bg: 'sky-400', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                    <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>w-32</span>
                </div>
            </div>
        </Demo>
    );
}

export function MaxWidth() {
    return (
        <Demo label="{ maxW: 'xs' } — box constrained with overflowing text truncated">
            <div sz={{ maxW: 'xs', bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', p: 3 }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary', truncate: true, block: true }}>
                    max-w-xs constrains this content to a narrow column no matter how wide the text is.
                </span>
            </div>
        </Demo>
    );
}

export function HeightScale() {
    return (
        <Demo label="height scale — h-8, h-16, h-32">
            <div sz={{ h: 8, w: 16, bg: 'sky-200', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-800' }}>h-8</span>
            </div>
            <div sz={{ h: 16, w: 16, bg: 'sky-300', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>h-16</span>
            </div>
            <div sz={{ h: 32, w: 16, bg: 'sky-400', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>h-32</span>
            </div>
        </Demo>
    );
}

export function SizeSquareAndCircle() {
    return (
        <Demo label="{ size: 12, rounded: 'full' } — square and circle">
            <div sz={{ size: 12, bg: 'sky-200', rounded: 'sm', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-800' }}>sq</span>
            </div>
            <div sz={{ size: 12, bg: '--ds-primary', rounded: 'full', flex: true, items: 'center', justify: 'center' }}>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>circle</span>
            </div>
        </Demo>
    );
}
