import { Demo } from '../Demo.tsx';

const item = { p: 2, rounded: 'md', text: 'sm', fontFamily: '--ds-font-ui', weight: 'medium', color: 'white' } as const;
const gradient = { bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500' } as const;
const label = { text: 'xs', fontFamily: '--ds-font-ui', weight: 'medium', color: 'zinc-500' } as const;

export function PaddingScale() {
    return (
        <Demo label="padding scale — p-2, p-4, p-8">
            <div sz={{ ...item, ...gradient, p: 2 }}>p-2</div>
            <div sz={{ ...item, ...gradient, p: 4 }}>p-4</div>
            <div sz={{ ...item, ...gradient, p: 8 }}>p-8</div>
        </Demo>
    );
}

export function AsymmetricPadding() {
    return (
        <Demo label="{ px: 8, py: 2 } — asymmetric padding">
            <button sz={{ px: 8, py: 2, color: 'white', rounded: 'lg', text: 'sm', fontFamily: '--ds-font-ui', ...gradient }}>
                Button
            </button>
        </Demo>
    );
}

export function MarginAuto() {
    return (
        <Demo label="{ mx: 'auto' } — horizontally centered box">
            <div sz={{ w: 'full', maxW: 96, h: 40, bg: 'zinc-800', rounded: 'lg' }}>
                <div sz={{ mx: 'auto', w: 24, rounded: 'lg', py: 2, text: 'sm', fontFamily: '--ds-font-ui', weight: 'medium', color: 'white', textAlign: 'center', ...gradient }}>
                    mx-auto
                </div>
            </div>
        </Demo>
    );
}

export function SpaceX() {
    return (
        <Demo label="spaceX scale — 1, 4, 8">
            <div sz={{ display: 'flex', flexDir: 'col', gap: 3 }}>
                <div sz={{ display: 'flex', spaceX: 1, items: 'center' }}>
                    <div sz={{ ...item, ...gradient }}>A</div>
                    <div sz={{ ...item, ...gradient }}>B</div>
                    <div sz={{ ...item, ...gradient }}>C</div>
                    <span sz={{ ...label, ml: 2 }}>spaceX-1</span>
                </div>
                <div sz={{ display: 'flex', spaceX: 4, items: 'center' }}>
                    <div sz={{ ...item, ...gradient }}>A</div>
                    <div sz={{ ...item, ...gradient }}>B</div>
                    <div sz={{ ...item, ...gradient }}>C</div>
                    <span sz={{ ...label, ml: 2 }}>spaceX-4</span>
                </div>
                <div sz={{ display: 'flex', spaceX: 8, items: 'center' }}>
                    <div sz={{ ...item, ...gradient }}>A</div>
                    <div sz={{ ...item, ...gradient }}>B</div>
                    <div sz={{ ...item, ...gradient }}>C</div>
                    <span sz={{ ...label, ml: 2 }}>spaceX-8</span>
                </div>
            </div>
        </Demo>
    );
}

export function SpaceY() {
    return (
        <Demo label="spaceY scale — 1, 4, 8">
            <div sz={{ display: 'flex', gap: 6, items: 'start' }}>
                <div>
                    <div sz={{ spaceY: 1, w: 20 }}>
                        <div sz={{ ...item, textAlign: 'center', ...gradient }}>A</div>
                        <div sz={{ ...item, textAlign: 'center', ...gradient }}>B</div>
                        <div sz={{ ...item, textAlign: 'center', ...gradient }}>C</div>
                    </div>
                    <div sz={{ ...label, textAlign: 'center', mt: 2 }}>spaceY-1</div>
                </div>
                <div>
                    <div sz={{ spaceY: 4, w: 20 }}>
                        <div sz={{ ...item, textAlign: 'center', ...gradient }}>A</div>
                        <div sz={{ ...item, textAlign: 'center', ...gradient }}>B</div>
                        <div sz={{ ...item, textAlign: 'center', ...gradient }}>C</div>
                    </div>
                    <div sz={{ ...label, textAlign: 'center', mt: 2 }}>spaceY-4</div>
                </div>
                <div>
                    <div sz={{ spaceY: 8, w: 20 }}>
                        <div sz={{ ...item, textAlign: 'center', ...gradient }}>A</div>
                        <div sz={{ ...item, textAlign: 'center', ...gradient }}>B</div>
                        <div sz={{ ...item, textAlign: 'center', ...gradient }}>C</div>
                    </div>
                    <div sz={{ ...label, textAlign: 'center', mt: 2 }}>spaceY-8</div>
                </div>
            </div>
        </Demo>
    );
}
