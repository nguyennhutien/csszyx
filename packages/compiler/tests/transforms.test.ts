import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

describe('transforms — rotate', () => {
    it('{ rotate: 45 } → rotate-45', () => {
        expect(t({ rotate: 45 })).toBe('rotate-45');
    });

    it('{ rotate: -45 } → -rotate-45 (negative angle)', () => {
        expect(t({ rotate: -45 })).toBe('-rotate-45');
    });

    it('{ rotateX: 45 } → rotate-x-45', () => {
        expect(t({ rotateX: 45 })).toBe('rotate-x-45');
    });

    it('{ rotateY: 90 } → rotate-y-90', () => {
        expect(t({ rotateY: 90 })).toBe('rotate-y-90');
    });

    it('{ rotateZ: 180 } → rotate-z-180', () => {
        expect(t({ rotateZ: 180 })).toBe('rotate-z-180');
    });

    it('{ rotate: "1.2rad" } → rotate-[1.2rad] (arbitrary)', () => {
        expect(t({ rotate: '1.2rad' })).toBe('rotate-[1.2rad]');
    });

    it('{ rotate: "--r" } → rotate-(--r) (css variable)', () => {
        expect(t({ rotate: '--r' })).toBe('rotate-(--r)');
    });
});

describe('transforms — scale', () => {
    it('{ scale: 50 } → scale-50', () => {
        expect(t({ scale: 50 })).toBe('scale-50');
    });

    it('{ scaleX: 50 } → scale-x-50', () => {
        expect(t({ scaleX: 50 })).toBe('scale-x-50');
    });

    it('{ scaleY: 50 } → scale-y-50', () => {
        expect(t({ scaleY: 50 })).toBe('scale-y-50');
    });

    it('{ scaleZ: 50 } → scale-z-50', () => {
        expect(t({ scaleZ: 50 })).toBe('scale-z-50');
    });

    it('{ scale3d: true } → scale-3d', () => {
        expect(t({ scale3d: true })).toBe('scale-3d');
    });

    it('{ scale: "1.5" } → scale-[1.5] (arbitrary)', () => {
        expect(t({ scale: '1.5' })).toBe('scale-[1.5]');
    });

    it('{ scale: "--s" } → scale-(--s) (css variable)', () => {
        expect(t({ scale: '--s' })).toBe('scale-(--s)');
    });
});

describe('transforms — skew', () => {
    it('{ skewX: 12 } → skew-x-12', () => {
        expect(t({ skewX: 12 })).toBe('skew-x-12');
    });

    it('{ skewY: 12 } → skew-y-12', () => {
        expect(t({ skewY: 12 })).toBe('skew-y-12');
    });

    it('{ skewX: "5deg" } → skew-x-[5deg] (arbitrary)', () => {
        expect(t({ skewX: '5deg' })).toBe('skew-x-[5deg]');
    });
});

describe('transforms — translate', () => {
    it('{ translateX: 4 } → translate-x-4', () => {
        expect(t({ translateX: 4 })).toBe('translate-x-4');
    });

    it('{ translateX: "px" } → translate-x-px', () => {
        expect(t({ translateX: 'px' })).toBe('translate-x-px');
    });

    it('{ translateX: "1/2" } → translate-x-1/2', () => {
        expect(t({ translateX: '1/2' })).toBe('translate-x-1/2');
    });

    it('{ translateY: 4 } → translate-y-4', () => {
        expect(t({ translateY: 4 })).toBe('translate-y-4');
    });

    it('{ translateY: "px" } → translate-y-px', () => {
        expect(t({ translateY: 'px' })).toBe('translate-y-px');
    });

    it('{ translateY: "1/2" } → translate-y-1/2', () => {
        expect(t({ translateY: '1/2' })).toBe('translate-y-1/2');
    });

    it('{ translateZ: 4 } → translate-z-4', () => {
        expect(t({ translateZ: 4 })).toBe('translate-z-4');
    });

    it('{ translateX: "full" } → translate-x-full', () => {
        expect(t({ translateX: 'full' })).toBe('translate-x-full');
    });

    it('{ translateY: "full" } → translate-y-full', () => {
        expect(t({ translateY: 'full' })).toBe('translate-y-full');
    });

    it('{ translate3d: true } → translate-3d', () => {
        expect(t({ translate3d: true })).toBe('translate-3d');
    });

    it('{ translateX: "5px" } → translate-x-[5px] (arbitrary)', () => {
        expect(t({ translateX: '5px' })).toBe('translate-x-[5px]');
    });

    it('{ translateX: "--t" } → translate-x-(--t) (css variable)', () => {
        expect(t({ translateX: '--t' })).toBe('translate-x-(--t)');
    });
});

describe('transforms — transform origin', () => {
    it('{ origin: "top" } → origin-top', () => {
        expect(t({ origin: 'top' })).toBe('origin-top');
    });

    it('{ origin: "top-right" } → origin-top-right', () => {
        expect(t({ origin: 'top-right' })).toBe('origin-top-right');
    });

    it('{ origin: "33%_75%" } → origin-[33%_75%] (arbitrary)', () => {
        expect(t({ origin: '33%_75%' })).toBe('origin-[33%_75%]');
    });

    it('{ origin: "--o" } → origin-(--o) (css variable)', () => {
        expect(t({ origin: '--o' })).toBe('origin-(--o)');
    });
});

describe('transforms — transform style', () => {
    it('{ transformStyle: "flat" } → transform-flat', () => {
        expect(t({ transformStyle: 'flat' })).toBe('transform-flat');
    });

    it('{ transformStyle: "3d" } → transform-3d', () => {
        expect(t({ transformStyle: '3d' })).toBe('transform-3d');
    });
});

describe('transforms — backface visibility', () => {
    it('{ backface: "visible" } → backface-visible', () => {
        expect(t({ backface: 'visible' })).toBe('backface-visible');
    });

    it('{ backface: "hidden" } → backface-hidden', () => {
        expect(t({ backface: 'hidden' })).toBe('backface-hidden');
    });
});

describe('transforms — perspective', () => {
    it('{ perspective: "xs" } → perspective-xs', () => {
        expect(t({ perspective: 'xs' })).toBe('perspective-xs');
    });

    it('{ perspective: "500px" } → perspective-[500px] (arbitrary)', () => {
        expect(t({ perspective: '500px' })).toBe('perspective-[500px]');
    });

    it('{ perspective: "--p" } → perspective-(--p) (css variable)', () => {
        expect(t({ perspective: '--p' })).toBe('perspective-(--p)');
    });
});

describe('transforms — perspective origin', () => {
    it('{ perspectiveOrigin: "top" } → perspective-origin-top', () => {
        expect(t({ perspectiveOrigin: 'top' })).toBe('perspective-origin-top');
    });

    it('{ perspectiveOrigin: "25%_25%" } → perspective-origin-[25%_25%] (arbitrary)', () => {
        expect(t({ perspectiveOrigin: '25%_25%' })).toBe('perspective-origin-[25%_25%]');
    });
});

describe('transforms — transform', () => {
    it('{ transform: "none" } → transform-none', () => {
        expect(t({ transform: 'none' })).toBe('transform-none');
    });
});
