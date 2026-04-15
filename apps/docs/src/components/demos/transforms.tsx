import { useState } from 'react';
import { Demo } from '../Demo.tsx';

// Base swatch layout
const swatchBase = { size: 16, rounded: 'xl', flex: true, items: 'center', justify: 'center' } as const;
const swatchNeutral = { ...swatchBase, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'indigo-800', to: 'violet-900', shadow: 'sm' } as const;
const swatchHighlight = { ...swatchBase, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500', shadow: 'md' } as const;
const originalHolder = { ...swatchBase, position: 'relative', border: true, borderColor: 'zinc-600', borderStyle: 'dashed' } as const;
// white labels — both swatch tiers now use dark gradient backgrounds
const labelMuted = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'white' } as const;
const labelWhite = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', color: 'white' } as const;

export function ScaleDemo() {
    return (
      <Demo label="scale — 75, 100, 125 side by side">
        <div sz={{ flex: true, gap: 8 }}>
          <div sz={originalHolder}>
            <div sz={{ ...swatchNeutral, position: 'absolute', top: '50%', left: '50%', translateX: '-50%', translateY: '-50%', scale: 75 }}>
                <span sz={labelMuted}>75</span>
            </div>
          </div>
            <div sz={{ ...swatchNeutral, scale: 100 }}>
                <span sz={labelMuted}>100</span>
          </div>
          <div sz={{ ...swatchBase, position: 'relative' }}>
            <div sz={{ ...swatchNeutral, position: 'absolute', top: '50%', left: '50%', translateX: '-50%', translateY: '-50%', scale: 125 }}>
                <span sz={labelWhite}>125</span>
            </div>
            <div sz={{ ...swatchBase, position: 'absolute', top: '50%', left: '50%', translateX: '-50%', translateY: '-50%', border: true, borderColor: {color: 'zinc-300', op: 50}, borderStyle: 'dashed' }}>
            </div>
          </div>
        </div>
        </Demo>
    );
}

export function RotateDemo() {
    return (
        <Demo label="rotate — 0, 45, 90 side by side">
            {/* Option B: conditional spread + static rotate — compiled to two className strings at build time */}
            <div sz={{ ...swatchNeutral, rotate: 0 }}>
                <span sz={labelWhite}>0°</span>
            </div>
            <div sz={{ ...swatchNeutral, rotate: 45 }}>
                <span sz={labelWhite}>45°</span>
            </div>
            <div sz={{ ...swatchNeutral, rotate: 90 }}>
                <span sz={labelWhite}>90°</span>
            </div>
        </Demo>
    );
}

export function TranslateDemo() {
    return (
        <Demo label="{ translateX: 4 } — shifted right by 1rem">
            <div sz={swatchNeutral}>
                <span sz={labelMuted}>origin</span>
        </div>
        <div sz={{ ...swatchBase, position: 'relative' }}>
            <div sz={{ ...originalHolder, position: 'absolute', top: '50%', left: '50%', translateX: '-50%', translateY: '-50%' }}></div>
            <div sz={{ ...swatchHighlight, translateX: 4 }}>
                <span sz={labelWhite}>+X 4</span>
            </div>
        </div>
        </Demo>
    );
}

export function SkewDemo() {
    const skewBase = { px: 6, py: 4, rounded: 'xl', flex: true, items: 'center', justify: 'center' } as const;
    const skewNeutral = { ...skewBase, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'indigo-800', to: 'violet-900', shadow: 'sm' } as const;
    return (
        <Demo label="skewX — 0 vs skewX-6">
            <div sz={skewNeutral}>
                <span sz={labelMuted}>no skew</span>
            </div>
            <div sz={{ ...skewBase, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500', shadow: 'md', skewX: 6 }}>
                <span sz={labelWhite}>skewX-6</span>
            </div>
        </Demo>
    );
}

export function TransformStyle3D() {
    // "Photo card" — making a physical-card rotation obvious: at 0° you see the full face,
    // at 45° it visibly narrows in 3D space, at 75° it's nearly edge-on.
    // perspective MUST be on the parent — it sets the viewer's distance from the scene.
    const PBOX = { perspective: '400px' } as const;
    const CARD = { w: 24, rounded: 'lg', bg: 'white', shadow: '2xl', overflow: 'hidden', transformStyle: '3d', flex: true, flexDir: 'col' } as const;
    const PHOTO = { w: 'full', h: 20, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-400', to: 'fuchsia-500' } as const;
    const INFO = { px: 3, py: 2 } as const;
    const TITLE = { text: 'xs', fontWeight: 'semibold', color: 'zinc-700', fontFamily: '--ds-font-ui' } as const;
    const SUB = { text: 'xs', color: 'zinc-400', fontFamily: '--ds-font-ui' } as const;
    const DEG = { text: 'xs', color: 'zinc-400', fontFamily: '--ds-font-mono' } as const;

    return (
        <Demo label="{ rotateY, transformStyle: '3d' } — perspective on parent makes depth visible">
            <div sz={{ flex: true, gap: 8, items: 'end' }}>
                <div sz={{ flex: true, flexDir: 'col', items: 'center', gap: 3 }}>
                    <div sz={PBOX}>
                        <div sz={{ ...CARD, rotateY: 0 }}>
                            <div sz={PHOTO} />
                            <div sz={INFO}>
                                <div sz={TITLE}>Front face</div>
                                <div sz={SUB}>full width</div>
                            </div>
                        </div>
                    </div>
                    <span sz={DEG}>rotateY: 0</span>
                </div>

                <div sz={{ flex: true, flexDir: 'col', items: 'center', gap: 3 }}>
                    <div sz={PBOX}>
                        <div sz={{ ...CARD, rotateY: 45 }}>
                            <div sz={PHOTO} />
                            <div sz={INFO}>
                                <div sz={TITLE}>Turning…</div>
                                <div sz={SUB}>narrowing</div>
                            </div>
                        </div>
                    </div>
                    <span sz={DEG}>rotateY: 45</span>
                </div>

                <div sz={{ flex: true, flexDir: 'col', items: 'center', gap: 3 }}>
                    <div sz={PBOX}>
                        <div sz={{ ...CARD, rotateY: 75 }}>
                            <div sz={PHOTO} />
                            <div sz={INFO}>
                                <div sz={TITLE}>Edge-on</div>
                                <div sz={SUB}>almost flat</div>
                            </div>
                        </div>
                    </div>
                    <span sz={DEG}>rotateY: 75</span>
                </div>
            </div>
        </Demo>
    );
}

// --- Interactive: click to step through rotation ---
const ROTATE_STEPS = [0, 45, 90, 135, 180] as const;
const ROTATE_CLASSES = ['rotate-0', 'rotate-45', 'rotate-90', 'rotate-135', 'rotate-180'] as const;
const ROT_BOX = { size: 20, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500', rounded: '2xl', flex: true, items: 'center', justify: 'center', shadow: 'xl', transition: 'transform', duration: 400, ease: 'cubic-bezier(0.34,1.56,0.64,1)' } as const;
const ROT_LABEL = { text: 'base', fontFamily: '--ds-font-ui', fontWeight: 'bold', color: 'white' } as const;
const ROT_BTN = { px: 5, py: 2, rounded: 'lg', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', bg: 'violet-600', color: 'white', cursor: 'pointer', border: true, borderColor: 'violet-500', transition: 'colors', duration: 150, hover: { bg: 'violet-700' } } as const;

export function RotateInteractive() {
    const [idx, setIdx] = useState(0);
    const deg = ROTATE_STEPS[idx];
    const next = ROTATE_STEPS[(idx + 1) % ROTATE_STEPS.length];
    return (
        <Demo
            label="click to rotate — steps through 0 → 45 → 90 → 135 → 180"
            hint="className drives the animation — sz {{ rotate }} compiles each step statically at build time"
        >
            <div sz={{ flex: true, flexDir: 'col', items: 'center', gap: 6 }}>
                <div sz={ROT_BOX} className={ROTATE_CLASSES[idx]}>
                    <span sz={ROT_LABEL}>{deg}°</span>
                </div>
                <button sz={ROT_BTN} onClick={() => setIdx(i => (i + 1) % ROTATE_STEPS.length)}>
                    Rotate to {next}°
                </button>
            </div>
        </Demo>
    );
}
