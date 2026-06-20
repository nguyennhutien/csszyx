import { useState } from 'react';
import { Demo } from '../Demo.tsx';

// Pulse dots — chained from _pulseDotBase, indigo/violet/pink palette
const _pulseDotBase = { rounded: 'full', animate: 'pulse' } as const;
const pulseDot1 = { ..._pulseDotBase, size: 10, bg: 'indigo-500' } as const;
const pulseDot2 = { ..._pulseDotBase, size: 10, bg: 'violet-500', animationDelay: 480 } as const;
const pulseDot3 = { ..._pulseDotBase, size: 10, bg: 'pink-500', animationDelay: 960 } as const;

// Bounce dots — chained from _bounceDotBase
const _bounceDotBase = { size: 4, rounded: 'full', animate: 'bounce' } as const;
const bounceDot1 = { ..._bounceDotBase, bg: 'indigo-500' } as const;
const bounceDot2 = { ..._bounceDotBase, bg: 'violet-500', animationDelay: 100 } as const;
const bounceDot3 = { ..._bounceDotBase, bg: 'pink-400', animationDelay: 200 } as const;

export function TransitionColors() {
    const btnBase = { px: 5, py: 2, rounded: 'md', transition: 'colors', duration: 200, text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold' } as const;
    return (
        <Demo label="{ transition: 'colors', duration: 200 } — hover to see color change">
            <button sz={{ ...btnBase, bg: 'violet-600', color: 'white', hover: { bg: 'pink-500' } }}>
                hover me
            </button>
            <button sz={{ ...btnBase, bg: 'zinc-800', color: 'zinc-300', border: true, borderColor: 'zinc-600', shadow: 'sm', hover: { bg: 'indigo-600', borderColor: 'indigo-500', color: 'white', shadow: 'md' } }}>
                hover me
            </button>
        </Demo>
    );
}

export function AnimateSpin() {
    return (
        <Demo label="{ animate: 'spin' } — continuous rotation">
            <div sz={{ size: 8, border: 4, borderColor: 'indigo-900', borderT: 4, rounded: 'full', animate: 'spin', borderTColor: 'indigo-500' }} />
        </Demo>
    );
}

export function AnimatePulse() {
    return (
        <Demo label="{ animate: 'pulse' } — staggered delay: 0, 150, 300ms">
            <div sz={pulseDot1} />
            <div sz={pulseDot2} />
            <div sz={pulseDot3} />
        </Demo>
    );
}

export function AnimateBounce() {
    return (
        <Demo label="{ animate: 'bounce' } — staggered loading indicator">
            <div sz={{ display: 'flex', gap: 2, items: 'end', h: 12 }}>
                <div sz={bounceDot1} />
                <div sz={bounceDot2} />
                <div sz={bounceDot3} />
            </div>
        </Demo>
    );
}

// --- Interactive: ease-out vs spring comparison ---
const COL = { display: 'flex', flexDir: 'col', items: 'center', gap: 5 } as const;
// sz={{ ...BOX_X, scale: state ? 75 : 100 }} — pre-plugin resolves the spread at build time
// and generates a template literal; Pass 1.5 mangles the static quasi parts in SSR bundles.
const BOX_A = { size: 20, rounded: 'xl', bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'sky-400',    to: 'indigo-500',  transition: 'transform', duration: 700, ease: 'out'               } as const;
const BOX_B = { size: 20, rounded: 'xl', bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500', transition: 'transform', duration: 700, ease: '--ease-spring'      } as const;
const BOX_C = { size: 20, rounded: 'xl', bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'rose-400',   to: 'pink-500',   transition: 'transform', duration: 700, ease: '--custom-backinout' } as const;
const EASE_BTN = { px: 5, py: 2, rounded: 'lg', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', bg: 'indigo-950', color: 'indigo-300', cursor: 'pointer', border: true, borderColor: 'indigo-700', transition: 'colors', duration: 150, hover: { bg: 'indigo-900', color: 'white' } } as const;
const SPRING_BTN = { px: 5, py: 2, rounded: 'lg', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', bg: 'violet-950', color: 'violet-300', cursor: 'pointer', border: true, borderColor: 'violet-700', transition: 'colors', duration: 150, hover: { bg: 'violet-900', color: 'white' } } as const;
const BACKINOUT_BTN = { px: 5, py: 2, rounded: 'lg', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'semibold', bg: 'rose-950', color: 'rose-400', cursor: 'pointer', border: true, borderColor: 'rose-800', transition: 'colors', duration: 150, hover: { bg: 'rose-900', color: 'white' } } as const;

export function TransitionCompare() {
    const [shrunkA, setShrunkA] = useState(false);
    const [shrunkB, setShrunkB] = useState(false);
    const [shrunkC, setShrunkC] = useState(false);
    return (
        <Demo
            label="ease-out vs spring vs backout — click Trigger to compare"
            // hint="spring uses a linear() curve with control points to simulate a bounce overshoot"
        >
            <div sz={{ display: 'flex', gap: 12 }}>
                {/* ease-out column */}
                <div sz={COL}>
                    <span sz={{ text: 'xs', tracking: 'wider', fontFamily: 'mono', fontWeight: 'semibold', color: 'indigo-400' }}>EASE-OUT</span>
                    <div sz={{ ...BOX_A, scale: shrunkA ? 75 : 100 }} />
                    <button sz={EASE_BTN} onClick={() => setShrunkA(s => !s)}>Trigger</button>
                </div>
                {/* spring bounce column */}
                <div sz={COL}>
                    <span sz={{ text: 'xs', tracking: 'wider', fontFamily: 'mono', fontWeight: 'semibold', color: 'violet-400' }}>SPRING BOUNCE</span>
                    <div sz={{ ...BOX_B, scale: shrunkB ? 75 : 100 }} />
                    <button sz={SPRING_BTN} onClick={() => setShrunkB(s => !s)}>Trigger</button>
                </div>
                {/* backinout bounce column */}
                <div sz={COL}>
                    <span sz={{ text: 'xs', tracking: 'wider', fontFamily: 'mono', fontWeight: 'semibold', color: 'pink-400' }}>BACKINOUT BOUNCE</span>
                    <div sz={{ ...BOX_C, scale: shrunkC ? 75 : 100 }} />
                    <button sz={BACKINOUT_BTN} onClick={() => setShrunkC(s => !s)}>Trigger</button>
                </div>
            </div>
        </Demo>
    );
}
