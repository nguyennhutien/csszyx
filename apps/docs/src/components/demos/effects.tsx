import { Demo } from '../Demo.tsx';

const LABEL_WHITE = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', color: 'white' } as const;

// Base swatch layout — chained into neutral and primary tier variants below
const swatchBase = { size: 24, rounded: 'xl', flex: true, items: 'center', justify: 'center' } as const;
const swatchPrimary = { ...swatchBase, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500' } as const;

// Shadow swatch — white bg so box-shadow is visible against the dark panel
const shadowSwatch = { size: 24, rounded: 'xl', bg: 'white', flex: true, items: 'center', justify: 'center' } as const;
const LABEL_DARK = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', color: 'zinc-700' } as const;

export function BoxShadowScale() {
    return (
        <Demo label="box shadow scale — sm, md, xl" bg="white">
            <div sz={{ ...shadowSwatch, shadow: 'sm' }}>
                <span sz={LABEL_DARK}>sm</span>
            </div>
            <div sz={{ ...shadowSwatch, shadow: 'md' }}>
                <span sz={LABEL_DARK}>md</span>
            </div>
            <div sz={{ ...shadowSwatch, shadow: 'xl' }}>
                <span sz={LABEL_DARK}>xl</span>
            </div>
        </Demo>
    );
}

export function OpacityScale() {
    // label below the box — opacity applies to the entire box including its children
    const col = { flex: true, flexDir: 'col', items: 'center', gap: 2 } as const;
    return (
        <Demo label="opacity — 100, 50, 25">
            <div sz={col}>
                <div sz={{ ...swatchPrimary, opacity: 100 }} />
                <span sz={LABEL_WHITE}>100</span>
            </div>
            <div sz={col}>
                <div sz={{ ...swatchPrimary, opacity: 50 }} />
                <span sz={LABEL_WHITE}>50</span>
            </div>
            <div sz={col}>
                <div sz={{ ...swatchPrimary, opacity: 25 }} />
                <span sz={LABEL_WHITE}>25</span>
            </div>
        </Demo>
    );
}

export function BlurScale() {
    // label below the box — blur filter applies to the box, text stays sharp outside
    const col = { flex: true, flexDir: 'col', items: 'center', gap: 2 } as const;
    return (
        <Demo label="blur scale — none, sm, md">
            <div sz={col}>
                <div sz={{ ...swatchPrimary, blur: 'none' }} />
                <span sz={LABEL_WHITE}>none</span>
            </div>
            <div sz={col}>
                <div sz={{ ...swatchPrimary, blur: 'sm' }} />
                <span sz={LABEL_WHITE}>sm</span>
            </div>
            <div sz={col}>
                <div sz={{ ...swatchPrimary, blur: 'md' }} />
                <span sz={LABEL_WHITE}>md</span>
            </div>
        </Demo>
    );
}

export function GrayscaleFilter() {
    return (
        <Demo label="grayscale filter — color vs grayscale">
            {/* direct variable reference — no override needed */}
            <div sz={swatchPrimary}>
                <span sz={LABEL_WHITE}>color</span>
            </div>
            <div sz={{ ...swatchPrimary, invert: true }}>
                <span sz={LABEL_WHITE}>invert</span>
            </div>
            <div sz={{ ...swatchPrimary, grayscale: true }}>
                <span sz={LABEL_WHITE}>grayscale</span>
            </div>
            <div sz={{ ...swatchPrimary, sepia: true }}>
                <span sz={LABEL_WHITE}>sepia</span>
            </div>
        </Demo>
    );
}
