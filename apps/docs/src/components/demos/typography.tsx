import { Demo } from '../Demo.tsx';

export function FontFamilies() {
    return (
        <Demo label="font families — sans, serif, mono">
            <span sz={{ fontFamily: 'sans', text: 'sm', color: '--ds-text', px: 2 }}>Sans</span>
            <span sz={{ fontFamily: 'serif', text: 'sm', color: '--ds-text', px: 2 }}>Serif</span>
            <span sz={{ fontFamily: 'mono', text: 'sm', color: '--ds-text', px: 2 }}>Mono</span>
        </Demo>
    );
}

export function FontSizeScale() {
    return (
        <Demo label="font size scale — xs, sm, base, lg, xl, 2xl">
            <div sz={{ flex: true, flexDir: 'col', gap: 1, items: 'start' }}>
                <span sz={{ text: 'xs', color: '--ds-text', fontFamily: '--ds-font-ui' }}>text-xs: The quick brown fox</span>
                <span sz={{ text: 'sm', color: '--ds-text', fontFamily: '--ds-font-ui' }}>text-sm: The quick brown fox</span>
                <span sz={{ text: 'base', color: '--ds-text', fontFamily: '--ds-font-ui' }}>text-base: The quick brown fox</span>
                <span sz={{ text: 'lg', color: '--ds-text', fontFamily: '--ds-font-ui' }}>text-lg: The quick brown fox</span>
                <span sz={{ text: 'xl', color: '--ds-text', fontFamily: '--ds-font-ui' }}>text-xl: The quick brown fox</span>
                <span sz={{ text: '2xl', color: '--ds-text', fontFamily: '--ds-font-ui' }}>text-2xl: The quick</span>
            </div>
        </Demo>
    );
}

export function FontWeightScale() {
    return (
        <Demo label="font weight scale — normal, medium, semibold, bold">
            <div sz={{ flex: true, flexDir: 'col', gap: 1, items: 'start' }}>
                <span sz={{ fontWeight: 'normal', text: 'base', color: '--ds-text' }}>Normal — The quick brown fox</span>
                <span sz={{ fontWeight: 'medium', text: 'base', color: '--ds-text' }}>Medium — The quick brown fox</span>
                <span sz={{ fontWeight: 'semibold', text: 'base', color: '--ds-text' }}>Semibold — The quick brown fox</span>
                <span sz={{ fontWeight: 'bold', text: 'base', color: '--ds-text' }}>Bold — The quick brown fox</span>
            </div>
        </Demo>
    );
}

export function TextColorExamples() {
    return (
        <Demo label="text color examples">
            <span sz={{ color: '--ds-primary', text: 'sm', fontFamily: '--ds-font-ui', px: 2 }}>primary</span>
            <span sz={{ color: 'sky-500', text: 'sm', fontFamily: '--ds-font-ui', px: 2 }}>sky-500</span>
            <span sz={{ color: 'slate-500', text: 'sm', fontFamily: '--ds-font-ui', px: 2 }}>slate-500</span>
            <span sz={{ bg: '--ds-primary', color: 'white', text: 'sm', fontFamily: '--ds-font-ui', px: 2, rounded: 'sm' }}>white on primary</span>
        </Demo>
    );
}

export function LetterSpacing() {
    return (
        <Demo label="letter spacing — tight, normal, wide, widest">
            <div sz={{ flex: true, flexDir: 'col', gap: 1, items: 'start' }}>
                <span sz={{ tracking: 'tight', text: 'sm', color: '--ds-text', fontFamily: '--ds-font-ui' }}>tracking-tight: ABCDEFGH</span>
                <span sz={{ text: 'sm', color: '--ds-text', fontFamily: '--ds-font-ui' }}>tracking-normal: ABCDEFGH</span>
                <span sz={{ tracking: 'wide', text: 'sm', color: '--ds-text', fontFamily: '--ds-font-ui' }}>tracking-wide: ABCDEFGH</span>
                <span sz={{ tracking: 'widest', text: 'sm', color: '--ds-text', fontFamily: '--ds-font-ui' }}>tracking-widest: ABCDEFGH</span>
            </div>
        </Demo>
    );
}

export function TextAlignment() {
    return (
        <Demo label="text alignment — left, center, right">
            <div sz={{ flex: true, flexDir: 'col', gap: 1, w: 48 }}>
                <div sz={{ textAlign: 'left', text: 'xs', color: '--ds-text', fontFamily: '--ds-font-ui', bg: '--ds-primary-faint', p: 1.5, rounded: 'sm' }}>Left aligned text</div>
                <div sz={{ textAlign: 'center', text: 'xs', color: '--ds-text', fontFamily: '--ds-font-ui', bg: '--ds-primary-faint', p: 1.5, rounded: 'sm' }}>Center aligned text</div>
                <div sz={{ textAlign: 'right', text: 'xs', color: '--ds-text', fontFamily: '--ds-font-ui', bg: '--ds-primary-faint', p: 1.5, rounded: 'sm' }}>Right aligned text</div>
            </div>
        </Demo>
    );
}

export function Truncate() {
    return (
        <Demo label="{ truncate: true } — overflow text clipped with ellipsis">
            <div sz={{ w: 48, truncate: true, text: 'sm', color: '--ds-text', fontFamily: '--ds-font-ui', bg: '--ds-primary-faint', p: 2, rounded: 'sm' }}>
                This is a very long text string that will be truncated with an ellipsis at the edge.
            </div>
        </Demo>
    );
}
