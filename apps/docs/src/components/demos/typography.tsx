import { Demo } from '../Demo.tsx';

// Base text style — chained into size/color variants below
const textBase = { color: 'zinc-200', fontFamily: '--ds-font-ui' } as const;
// Chained: textSmBase extends textBase with text-sm
const textSmBase = { ...textBase, text: 'sm' } as const;
// let declaration — compiler resolves both const and let with static initializers
let textLetterSpacing = { ...textSmBase, color: 'zinc-300' };

export function FontFamilies() {
    return (
        <Demo label="font families — sans, serif, mono">
            <span sz={{ fontFamily: 'sans', text: 'sm', color: 'zinc-200', px: 2 }}>Sans</span>
            <span sz={{ fontFamily: 'serif', text: 'sm', color: 'zinc-200', px: 2 }}>Serif</span>
            <span sz={{ fontFamily: 'mono', text: 'sm', color: 'zinc-200', px: 2 }}>Mono</span>
        </Demo>
    );
}

export function FontSizeScale() {
    return (
        <Demo label="font size scale — xs, sm, base, lg, xl, 2xl">
            <div sz={{ flex: true, flexDir: 'col', gap: 1, items: 'start' }}>
                {/* direct variable reference */}
                <span sz={{ ...textBase, text: 'xs' }}>text-xs: The quick brown fox</span>
                <span sz={textSmBase}>text-sm: The quick brown fox</span>
                <span sz={{ ...textBase, text: 'base' }}>text-base: The quick brown fox</span>
                <span sz={{ ...textBase, text: 'lg' }}>text-lg: The quick brown fox</span>
                <span sz={{ ...textBase, text: 'xl' }}>text-xl: The quick brown fox</span>
                <span sz={{ ...textBase, text: '2xl' }}>text-2xl: The quick</span>
            </div>
        </Demo>
    );
}

export function FontWeightScale() {
    return (
        <Demo label="font weight scale — normal, medium, semibold, bold">
            <div sz={{ flex: true, flexDir: 'col', gap: 1, items: 'start' }}>
                <span sz={{ fontWeight: 'normal', text: 'base', color: 'zinc-200' }}>Normal — The quick brown fox</span>
                <span sz={{ fontWeight: 'medium', text: 'base', color: 'zinc-200' }}>Medium — The quick brown fox</span>
                <span sz={{ fontWeight: 'semibold', text: 'base', color: 'zinc-200' }}>Semibold — The quick brown fox</span>
                <span sz={{ fontWeight: 'bold', text: 'base', color: 'zinc-200' }}>Bold — The quick brown fox</span>
            </div>
        </Demo>
    );
}

export function TextColorExamples() {
    // Chained: highlight style builds on textSmBase
    const highlight = { ...textSmBase, fontWeight: 'semibold', px: 2 } as const;
    return (
        <Demo label="text color examples">
            <span sz={{ ...highlight, color: 'violet-400' }}>primary</span>
            <span sz={{ ...highlight, color: 'sky-500' }}>sky-500</span>
            <span sz={{ ...highlight, color: 'slate-500' }}>slate-500</span>
            <span sz={{ bg: 'violet-600', color: 'white', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', px: 3, py: 1, rounded: 'lg' }}>white on violet-600</span>
        </Demo>
    );
}

export function LetterSpacing() {
    return (
        <Demo label="letter spacing — tight, normal, wide, widest">
            <div sz={{ flex: true, flexDir: 'col', gap: 1, items: 'start' }}>
                {/* let variable — resolved same as const */}
                <span sz={{ ...textLetterSpacing, tracking: 'tight' }}>tracking-tight: ABCDEFGH</span>
                <span sz={textLetterSpacing}>tracking-normal: ABCDEFGH</span>
                <span sz={{ ...textLetterSpacing, tracking: 'wide' }}>tracking-wide: ABCDEFGH</span>
                <span sz={{ ...textLetterSpacing, tracking: 'widest' }}>tracking-widest: ABCDEFGH</span>
            </div>
        </Demo>
    );
}

export function TextAlignment() {
    const alignBox = { text: 'sm', fontWeight: 'medium', color: 'zinc-200', fontFamily: '--ds-font-ui', bg: 'indigo-950', p: 2, rounded: 'lg' } as const;
    return (
        <Demo label="text alignment — left, center, right">
            <div sz={{ flex: true, flexDir: 'col', gap: 1, w: 'full', maxW: 96 }}>
                <div sz={{ ...alignBox, textAlign: 'left' }}>Left aligned text</div>
                <div sz={{ ...alignBox, textAlign: 'center' }}>Center aligned text</div>
                <div sz={{ ...alignBox, textAlign: 'right' }}>Right aligned text</div>
            </div>
        </Demo>
    );
}

export function Truncate() {
    return (
        <Demo label="{ truncate: true } — overflow text clipped with ellipsis">
            <div sz={{ w: 48, truncate: true, text: 'sm', color: 'zinc-200', fontFamily: '--ds-font-ui', bg: 'indigo-950', p: 2, rounded: 'sm' }}>
                This is a very long text string that will be truncated with an ellipsis at the edge.
            </div>
        </Demo>
    );
}
