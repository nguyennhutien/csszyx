import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

describe('transitions & animation — transition property', () => {
    it('{ transition: "none" } → transition-none', () => {
        expect(t({ transition: 'none' })).toBe('transition-none');
    });

    it('{ transition: true } → transition', () => {
        expect(t({ transition: true })).toBe('transition');
    });

    it('{ transition: "colors" } → transition-colors', () => {
        expect(t({ transition: 'colors' })).toBe('transition-colors');
    });

    it('{ transition: "opacity" } → transition-opacity (arbitrary)', () => {
        expect(t({ transition: 'opacity' })).toBe('transition-opacity');
    });
});

describe('transitions & animation — transition behavior', () => {
    it('{ transitionBehavior: "discrete" } → transition-discrete', () => {
        expect(t({ transitionBehavior: 'discrete' })).toBe('transition-discrete');
    });

    it('{ transitionBehavior: "normal" } → transition-normal', () => {
        expect(t({ transitionBehavior: 'normal' })).toBe('transition-normal');
    });
});

describe('transitions & animation — transition duration', () => {
    it('{ duration: 150 } → duration-150', () => {
        expect(t({ duration: 150 })).toBe('duration-150');
    });

    it('{ duration: 0 } → duration-0', () => {
        expect(t({ duration: 0 })).toBe('duration-0');
    });
});

describe('transitions & animation — transition timing function', () => {
    it('{ ease: "in" } → ease-in', () => {
        expect(t({ ease: 'in' })).toBe('ease-in');
    });

    it('{ ease: "cubic-bezier(0.4,0,0.2,1)" } → ease-[cubic-bezier(0.4,0,0.2,1)] (arbitrary)', () => {
        expect(t({ ease: 'cubic-bezier(0.4,0,0.2,1)' })).toBe('ease-[cubic-bezier(0.4,0,0.2,1)]');
    });

    it('{ ease: "--e" } → ease-(--e) (css variable)', () => {
        expect(t({ ease: '--e' })).toBe('ease-(--e)');
    });
});

describe('transitions & animation — transition delay', () => {
    it('{ delay: 150 } → delay-150', () => {
        expect(t({ delay: 150 })).toBe('delay-150');
    });

    it('{ delay: 0 } → delay-0', () => {
        expect(t({ delay: 0 })).toBe('delay-0');
    });
});

describe('transitions & animation — animation', () => {
    it('{ animate: "none" } → animate-none', () => {
        expect(t({ animate: 'none' })).toBe('animate-none');
    });

    it('{ animate: "spin" } → animate-spin', () => {
        expect(t({ animate: 'spin' })).toBe('animate-spin');
    });

    it('{ animate: "spin_1s_linear_infinite" } → animate-[spin_1s_linear_infinite] (arbitrary)', () => {
        expect(t({ animate: 'spin_1s_linear_infinite' })).toBe('animate-[spin_1s_linear_infinite]');
    });
});

describe('transitions & animation — animation delay', () => {
    it('{ animationDelay: 150 } → [animation-delay:150ms]', () => {
        expect(t({ animationDelay: 150 })).toBe('[animation-delay:150ms]');
    });

    it('{ animationDelay: 0 } → [animation-delay:0ms]', () => {
        expect(t({ animationDelay: 0 })).toBe('[animation-delay:0ms]');
    });

    it('{ animationDelay: 300 } → [animation-delay:300ms]', () => {
        expect(t({ animationDelay: 300 })).toBe('[animation-delay:300ms]');
    });

    it('{ animationDelay: "0.5s" } → [animation-delay:0.5s] (string passthrough)', () => {
        expect(t({ animationDelay: '0.5s' })).toBe('[animation-delay:0.5s]');
    });

    it('{ animate: "pulse", animationDelay: 150 } → combined', () => {
        const result = t({ animate: 'pulse', animationDelay: 150 });
        expect(result).toContain('animate-pulse');
        expect(result).toContain('[animation-delay:150ms]');
    });

    it('animationDelay is independent from transition delay', () => {
        // delay → transition-delay, animationDelay → animation-delay — must not collide
        const result = t({ delay: 200, animationDelay: 150 });
        expect(result).toContain('delay-200');
        expect(result).toContain('[animation-delay:150ms]');
    });
});
