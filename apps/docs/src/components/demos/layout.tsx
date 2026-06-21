import { Demo } from '../Demo.tsx';

// zinc-700→zinc-800 gradient replaces zinc-900 (which is invisible against the panel bg)
const item = { p: 3, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'zinc-700', to: 'zinc-800', rounded: 'md', text: 'sm', fontFamily: '--ds-font-ui', weight: 'medium', color: 'white' } as const;
const label = { text: 'sm', fontFamily: '--ds-font-ui', weight: 'medium', color: 'white' } as const;

export function FlexRow() {
    return (
        <Demo label="{ display: 'flex' } — children laid out in a row">
            <div sz={{ display: 'flex', gap: 3 }}>
                <div sz={item}>A</div>
                <div sz={item}>B</div>
                <div sz={item}>C</div>
            </div>
        </Demo>
    );
}

export function BlockVsInlineBlock() {
    return (
        <Demo label="{ display: 'block' } vs { display: 'inline-block' }">
            <div sz={{ w: 48 }}>
                <div sz={{ ...item, display: 'block', mb: 1 }}>block (full width)</div>
                <span sz={{ ...item, p: 2, display: 'inline-block' }}>inline</span>
                <span sz={{ ...item, p: 2, display: 'inline-block', ml: 1 }}>block</span>
            </div>
        </Demo>
    );
}

export function AbsoluteOverlay() {
    return (
        <Demo label="relative parent + absolute child overlay">
            <div sz={{ position: 'relative', w: 40, h: 24, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'zinc-700', to: 'zinc-800', rounded: 'lg', shadow: 'sm' }}>
                <div sz={{ position: 'absolute', inset: 0, display: 'flex', items: 'center', justify: 'center' }}>
                    <span sz={label}>parent</span>
                </div>
                <div sz={{ position: 'absolute', top: 0, right: 0, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500', rounded: 'lg', px: 1.5, py: 0.5 }}>
                    <span sz={{ ...label, color: 'white' }}>abs</span>
                </div>
            </div>
        </Demo>
    );
}

export function OverflowHidden() {
    return (
        <Demo label="{ overflow: 'hidden' } — long text clipped to box">
            <div sz={{ w: 40, h: 12, overflow: 'hidden', bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'zinc-700', to: 'zinc-800', rounded: 'lg', p: 2 }}>
                <span sz={label}>
                    This text is intentionally long and will be clipped by overflow-hidden at the box boundary.
                </span>
            </div>
        </Demo>
    );
}

export function ZIndex() {
    return (
        <Demo label="z-index — higher z stacks on top">
            <div sz={{ position: 'relative', w: 48, h: 24 }}>
                <div sz={{ position: 'absolute', top: 0, left: 0, z: 10, w: 32, h: 20, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'zinc-700', to: 'zinc-800', shadow: 'sm', rounded: 'lg', display: 'flex', items: 'center', justify: 'center' }}>
                    <span sz={label}>z-10</span>
                </div>
                <div sz={{ position: 'absolute', top: 4, left: 10, z: 20, w: 32, h: 20, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500', shadow: 'md', rounded: 'lg', display: 'flex', items: 'center', justify: 'center' }}>
                    <span sz={{ ...label, color: 'white' }}>z-20 (top)</span>
                </div>
            </div>
        </Demo>
    );
}

export function AspectRatio() {
    return (
        <Demo label="aspect ratio comparison">
            <div sz={{ aspect: 'square', w: 16, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500', rounded: 'lg', display: 'flex', items: 'center', justify: 'center' }}>
                <span sz={label}>1:1</span>
            </div>
            <div sz={{ aspect: 'video', w: 24, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'sky-400', to: 'indigo-500', rounded: 'lg', display: 'flex', items: 'center', justify: 'center' }}>
                <span sz={label}>16:9</span>
            </div>
        </Demo>
    );
}
