import { Demo } from '../Demo.tsx';

export function TransitionColors() {
    return (
        <Demo label="{ transition: 'colors', duration: 200 } — hover to see color change">
            <button sz={{ px: 5, py: 2, bg: '--ds-primary', color: 'white', rounded: 'md', transition: 'colors', duration: 200, text: 'sm', fontFamily: '--ds-font-ui' }}>
                transition-colors
            </button>
            <button sz={{ px: 5, py: 2, bg: '--ds-primary', color: 'white', rounded: 'md', transition: 'shadow', duration: 300, shadow: 'md', text: 'sm', fontFamily: '--ds-font-ui' }}>
                transition-shadow
            </button>
        </Demo>
    );
}

export function AnimateSpin() {
    return (
        <Demo label="{ animate: 'spin' } — continuous rotation">
            <div sz={{ size: 8, border: 4, borderColor: '--ds-primary-light', borderT: 4, rounded: 'full', animate: 'spin' }} style={{ borderTopColor: 'var(--ds-primary)' }} />
        </Demo>
    );
}

export function AnimatePulse() {
    return (
        <Demo label="{ animate: 'pulse' } — pulsing elements with staggered delay">
            <div sz={{ size: 10, bg: '--ds-primary', rounded: 'full', animate: 'pulse', opacity: 100 }} />
            <div sz={{ size: 10, bg: 'sky-400', rounded: 'full', animate: 'pulse', delay: 150 }} />
            <div sz={{ size: 10, bg: 'sky-300', rounded: 'full', animate: 'pulse', delay: 300 }} />
        </Demo>
    );
}

export function AnimateBounce() {
    return (
        <Demo label="{ animate: 'bounce' } — bouncing indicator">
            <div sz={{ flex: true, gap: 2, items: 'end', h: 12 }}>
                <div sz={{ size: 4, bg: '--ds-primary', rounded: 'full', animate: 'bounce' }} />
                <div sz={{ size: 4, bg: 'sky-400', rounded: 'full', animate: 'bounce', delay: 100 }} />
                <div sz={{ size: 4, bg: 'sky-300', rounded: 'full', animate: 'bounce', delay: 200 }} />
            </div>
        </Demo>
    );
}
