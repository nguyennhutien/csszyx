import { useState } from 'react';
import { Demo } from '../Demo.tsx';

// zinc-600→zinc-800 gradient replaces zinc-900 (which is invisible against the panel bg)
const _SHAPE_SQUARE = { size: 16, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'zinc-600', to: 'zinc-800', shadow: 'sm', rounded: 'xl', display: 'flex', items: 'center', justify: 'center' } as const;
const _SHAPE_CIRCLE = { size: 16, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500', shadow: 'md', rounded: 'full', display: 'flex', items: 'center', justify: 'center' } as const;
const _LABEL_MUTED = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'white' } as const;
const _LABEL_SEMIBOLD = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', color: 'white' } as const;

function ShapeBox({ circle }: { circle: boolean }) {
    return (
        <div sz={circle ? _SHAPE_CIRCLE : _SHAPE_SQUARE}>
            <span sz={circle ? _LABEL_SEMIBOLD : _LABEL_MUTED}>{circle ? 'circle' : 'sq'}</span>
        </div>
    );
}

export function WidthScale() {
    const boxBase = { h: 8, rounded: 'md', display: 'flex', items: 'center', justify: 'center' } as const;
    const labelWhite = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', color: 'white' } as const;
    return (
        <Demo label="width scale — w-8, w-16, w-32">
            <div sz={{ display: 'flex', flexDir: 'col', gap: 2, items: 'start' }}>
                {/* horizontal gradient — direction to-r makes width differences more vivid */}
                <div sz={{ ...boxBase, w: 8, bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'emerald-400', to: 'cyan-400' }}>
                    <span sz={labelWhite}>w-8</span>
                </div>
                <div sz={{ ...boxBase, w: 16, bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'sky-400', to: 'indigo-500' }}>
                    <span sz={labelWhite}>w-16</span>
                </div>
                <div sz={{ ...boxBase, w: 32, bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'violet-500', to: 'fuchsia-500' }}>
                    <span sz={labelWhite}>w-32</span>
                </div>
            </div>
        </Demo>
    );
}

export function MaxWidth() {
    return (
        <Demo label="{ maxW: 'xs' } — box constrained with overflowing text truncated">
            <div sz={{ maxW: 'xs', bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'indigo-900', to: 'violet-900', rounded: 'lg', p: 4 }}>
                <span sz={{ text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'indigo-200', truncate: true, display: 'block' }}>
                    max-w-xs constrains this content to a narrow column no matter how wide the text is.
                </span>
            </div>
        </Demo>
    );
}

export function HeightScale() {
    const boxBase = { w: 16, rounded: 'md', display: 'flex', items: 'center', justify: 'center' } as const;
    const labelWhite = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', color: 'white' } as const;
    return (
        <Demo label="height scale — h-8, h-16, h-32">
            {/* vertical gradient — direction to-b makes height differences more vivid */}
            <div sz={{ ...boxBase, h: 8, bgImg: { gradient: 'linear', dir: 'to-b' }, from: 'emerald-400', to: 'cyan-400' }}>
                <span sz={labelWhite}>h-8</span>
            </div>
            <div sz={{ ...boxBase, h: 16, bgImg: { gradient: 'linear', dir: 'to-b' }, from: 'sky-400', to: 'indigo-500' }}>
                <span sz={labelWhite}>h-16</span>
            </div>
            <div sz={{ ...boxBase, h: 32, bgImg: { gradient: 'linear', dir: 'to-b' }, from: 'violet-500', to: 'fuchsia-500' }}>
                <span sz={labelWhite}>h-32</span>
            </div>
        </Demo>
    );
}

export function SizeSquareAndCircle() {
    return (
        <Demo label="{ size: 12, rounded: 'full' } — square and circle">
            <ShapeBox circle={false} />
            <ShapeBox circle={true} />
        </Demo>
    );
}

// --- Interactive: click to morph between square and circle ---
// zinc-600→zinc-800 gradient replaces zinc-900 (which is invisible against the panel bg)
const SQUARE_STYLE = { size: 24, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'zinc-600', to: 'zinc-800', rounded: 'xl', shadow: 'lg', display: 'flex', items: 'center', justify: 'center' } as const;
const CIRCLE_STYLE = { size: 24, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500', rounded: 'full', shadow: 'xl', display: 'flex', items: 'center', justify: 'center' } as const;
const SQUARE_LABEL = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'white' } as const;
const CIRCLE_LABEL = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', color: 'white' } as const;
const TOGGLE_BTN = { px: 5, py: 2, rounded: 'lg', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', bg: 'violet-600', color: 'white', cursor: 'pointer', border: true, borderColor: 'violet-500', transition: 'colors', duration: 150, hover: { bg: 'violet-700' } } as const;

export function ShapeToggle() {
    const [circle, setCircle] = useState(false);
    return (
        <Demo label="{ rounded: 'full' } — click to morph between square and circle">
            <div sz={{ display: 'flex', flexDir: 'col', items: 'center', gap: 6 }}>
                <div sz={circle ? CIRCLE_STYLE : SQUARE_STYLE}>
                    <span sz={circle ? CIRCLE_LABEL : SQUARE_LABEL}>
                        {circle ? 'circle' : 'square'}
                    </span>
                </div>
                <button sz={TOGGLE_BTN} onClick={() => setCircle(c => !c)}>
                    {circle ? 'Make square' : 'Make circle'}
                </button>
            </div>
        </Demo>
    );
}
