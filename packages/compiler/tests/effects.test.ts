import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

describe('effects — box shadow', () => {
    it('{ shadow: "md" } → shadow-md', () => {
        expect(t({ shadow: 'md' })).toBe('shadow-md');
    });

    it('{ shadow: "none" } → shadow-none', () => {
        expect(t({ shadow: 'none' })).toBe('shadow-none');
    });

    it('{ shadowColor: "blue-500" } → shadow-blue-500', () => {
        expect(t({ shadowColor: 'blue-500' })).toBe('shadow-blue-500');
    });

    it('{ shadowColor: "--my-color" } → shadow-(color:--my-color) (css variable)', () => {
        expect(t({ shadowColor: '--my-color' })).toBe('shadow-(color:--my-color)');
    });

    it('{ shadow: "0 35px 60px -15px rgba(0,0,0,0.3)" } → shadow-[0_35px_60px_-15px_rgba(0,0,0,0.3)] (arbitrary)', () => {
        expect(t({ shadow: '0 35px 60px -15px rgba(0,0,0,0.3)' })).toBe(
            'shadow-[0_35px_60px_-15px_rgba(0,0,0,0.3)]',
        );
    });

    it('{ shadow: "--s" } → shadow-(--s) (css variable)', () => {
        expect(t({ shadow: '--s' })).toBe('shadow-(--s)');
    });

    it('{ insetShadow: "sm" } → inset-shadow-sm', () => {
        expect(t({ insetShadow: 'sm' })).toBe('inset-shadow-sm');
    });

    it('{ insetShadow: "none" } → inset-shadow-none', () => {
        expect(t({ insetShadow: 'none' })).toBe('inset-shadow-none');
    });

    it('{ insetShadowColor: "blue-500" } → inset-shadow-blue-500', () => {
        expect(t({ insetShadowColor: 'blue-500' })).toBe('inset-shadow-blue-500');
    });

    it('{ insetShadowColor: "--c" } → inset-shadow-(color:--c) (css variable)', () => {
        expect(t({ insetShadowColor: '--c' })).toBe('inset-shadow-(color:--c)');
    });

    it('{ ring: 1 } → ring-1', () => {
        expect(t({ ring: 1 })).toBe('ring-1');
    });

    it('{ ring: "none" } → ring-none', () => {
        expect(t({ ring: 'none' })).toBe('ring-none');
    });

    it('{ insetRing: true } → inset-ring', () => {
        expect(t({ insetRing: true })).toBe('inset-ring');
    });

    it('{ insetRing: 1 } → inset-ring-1', () => {
        expect(t({ insetRing: 1 })).toBe('inset-ring-1');
    });

    it('{ insetRingColor: "blue-500" } → inset-ring-blue-500', () => {
        expect(t({ insetRingColor: 'blue-500' })).toBe('inset-ring-blue-500');
    });
});

describe('effects — text shadow', () => {
    it('{ textShadow: "sm" } → text-shadow-sm', () => {
        expect(t({ textShadow: 'sm' })).toBe('text-shadow-sm');
    });

    it('{ textShadow: "none" } → text-shadow-none', () => {
        expect(t({ textShadow: 'none' })).toBe('text-shadow-none');
    });

    it('{ textShadowColor: "blue-500" } → text-shadow-blue-500', () => {
        expect(t({ textShadowColor: 'blue-500' })).toBe('text-shadow-blue-500');
    });

    it('{ textShadow: "2px 2px 4px var(--tw-shadow-color)" } → text-shadow-[2px_2px_4px_var(--tw-shadow-color)] (arbitrary)', () => {
        expect(t({ textShadow: '2px 2px 4px var(--tw-shadow-color)' })).toBe(
            'text-shadow-[2px_2px_4px_var(--tw-shadow-color)]',
        );
    });
});

describe('effects — opacity', () => {
    it('{ opacity: 50 } → opacity-50', () => {
        expect(t({ opacity: 50 })).toBe('opacity-50');
    });

    it('{ opacity: ".33" } → opacity-[.33] (arbitrary)', () => {
        expect(t({ opacity: '.33' })).toBe('opacity-[.33]');
    });

    it('{ opacity: "--o" } → opacity-(--o) (css variable)', () => {
        expect(t({ opacity: '--o' })).toBe('opacity-(--o)');
    });
});

describe('effects — mix blend mode', () => {
    it('{ mixBlend: "multiply" } → mix-blend-multiply', () => {
        expect(t({ mixBlend: 'multiply' })).toBe('mix-blend-multiply');
    });
});

describe('effects — background blend mode', () => {
    it('{ bgBlend: "multiply" } → bg-blend-multiply', () => {
        expect(t({ bgBlend: 'multiply' })).toBe('bg-blend-multiply');
    });
});

describe('effects — masking', () => {
    it('{ mask: "linear-45" } → mask-linear-45', () => {
        expect(t({ mask: 'linear-45' })).toBe('mask-linear-45');
    });

    it('{ mask: "-linear-45" } → -mask-linear-45', () => {
        expect(t({ mask: '-linear-45' })).toBe('-mask-linear-45');
    });

    it('{ mask: "radial" } → mask-radial', () => {
        expect(t({ mask: 'radial' })).toBe('mask-radial');
    });

    it('{ mask: "none" } → mask-none', () => {
        expect(t({ mask: 'none' })).toBe('mask-none');
    });

    it('{ mask: "linear-to-tr" } → mask-linear-to-tr', () => {
        expect(t({ mask: 'linear-to-tr' })).toBe('mask-linear-to-tr');
    });

    it('{ maskShape: "circle" } → mask-circle', () => {
        expect(t({ maskShape: 'circle' })).toBe('mask-circle');
    });

    it('{ mask: "url(\'/img.png\')" } → mask-[url(\'/img.png\')] (arbitrary)', () => {
        expect(t({ mask: "url('/img.png')" })).toBe("mask-[url('/img.png')]");
    });

    it('{ mask: "--my-mask" } → mask-(--my-mask) (css variable)', () => {
        expect(t({ mask: '--my-mask' })).toBe('mask-(--my-mask)');
    });

    it('{ maskSize: "cover" } → mask-cover', () => {
        expect(t({ maskSize: 'cover' })).toBe('mask-cover');
    });

    it('{ maskPos: "center" } → mask-center', () => {
        expect(t({ maskPos: 'center' })).toBe('mask-center');
    });

    it('{ maskRepeat: "repeat-x" } → mask-repeat-x', () => {
        expect(t({ maskRepeat: 'repeat-x' })).toBe('mask-repeat-x');
    });

    it('{ maskRepeat: "no-repeat" } → mask-no-repeat', () => {
        expect(t({ maskRepeat: 'no-repeat' })).toBe('mask-no-repeat');
    });

    it('{ maskOrigin: "border" } → mask-origin-border', () => {
        expect(t({ maskOrigin: 'border' })).toBe('mask-origin-border');
    });

    it('{ maskClip: "content" } → mask-clip-content', () => {
        expect(t({ maskClip: 'content' })).toBe('mask-clip-content');
    });

    it('{ maskMode: "alpha" } → mask-alpha', () => {
        expect(t({ maskMode: 'alpha' })).toBe('mask-alpha');
    });

    it('{ maskType: "alpha" } → mask-type-alpha', () => {
        expect(t({ maskType: 'alpha' })).toBe('mask-type-alpha');
    });

    it('{ maskComposite: "add" } → mask-add', () => {
        expect(t({ maskComposite: 'add' })).toBe('mask-add');
    });
});

describe('filters — filter', () => {
    it('{ filter: "none" } → filter-none', () => {
        expect(t({ filter: 'none' })).toBe('filter-none');
    });

    it('{ blur: true } → blur', () => {
        expect(t({ blur: true })).toBe('blur');
    });

    it('{ blur: "sm" } → blur-sm', () => {
        expect(t({ blur: 'sm' })).toBe('blur-sm');
    });

    it('{ brightness: 150 } → brightness-150', () => {
        expect(t({ brightness: 150 })).toBe('brightness-150');
    });

    it('{ contrast: 50 } → contrast-50', () => {
        expect(t({ contrast: 50 })).toBe('contrast-50');
    });

    it('{ dropShadow: "md" } → drop-shadow-md', () => {
        expect(t({ dropShadow: 'md' })).toBe('drop-shadow-md');
    });

    it('{ dropShadowColor: "red-500" } → drop-shadow-red-500', () => {
        expect(t({ dropShadowColor: 'red-500' })).toBe('drop-shadow-red-500');
    });

    it('{ grayscale: true } → grayscale', () => {
        expect(t({ grayscale: true })).toBe('grayscale');
    });

    it('{ hueRotate: 90 } → hue-rotate-90', () => {
        expect(t({ hueRotate: 90 })).toBe('hue-rotate-90');
    });

    it('{ hueRotate: -15 } → -hue-rotate-15', () => {
        expect(t({ hueRotate: -15 })).toBe('-hue-rotate-15');
    });

    it('{ invert: true } → invert', () => {
        expect(t({ invert: true })).toBe('invert');
    });

    it('{ saturate: 200 } → saturate-200', () => {
        expect(t({ saturate: 200 })).toBe('saturate-200');
    });

    it('{ sepia: true } → sepia', () => {
        expect(t({ sepia: true })).toBe('sepia');
    });
});

describe('filters — backdrop filter', () => {
    it('{ backdropFilter: "none" } → backdrop-filter-none', () => {
        expect(t({ backdropFilter: 'none' })).toBe('backdrop-filter-none');
    });

    it('{ backdropBlur: "sm" } → backdrop-blur-sm', () => {
        expect(t({ backdropBlur: 'sm' })).toBe('backdrop-blur-sm');
    });

    it('{ backdropBrightness: 150 } → backdrop-brightness-150', () => {
        expect(t({ backdropBrightness: 150 })).toBe('backdrop-brightness-150');
    });

    it('{ backdropContrast: 50 } → backdrop-contrast-50', () => {
        expect(t({ backdropContrast: 50 })).toBe('backdrop-contrast-50');
    });

    it('{ backdropGrayscale: true } → backdrop-grayscale', () => {
        expect(t({ backdropGrayscale: true })).toBe('backdrop-grayscale');
    });

    it('{ backdropHueRotate: 90 } → backdrop-hue-rotate-90', () => {
        expect(t({ backdropHueRotate: 90 })).toBe('backdrop-hue-rotate-90');
    });

    it('{ backdropHueRotate: -15 } → -backdrop-hue-rotate-15', () => {
        expect(t({ backdropHueRotate: -15 })).toBe('-backdrop-hue-rotate-15');
    });

    it('{ backdropInvert: true } → backdrop-invert', () => {
        expect(t({ backdropInvert: true })).toBe('backdrop-invert');
    });

    it('{ backdropOpacity: 50 } → backdrop-opacity-50', () => {
        expect(t({ backdropOpacity: 50 })).toBe('backdrop-opacity-50');
    });

    it('{ backdropSaturate: 200 } → backdrop-saturate-200', () => {
        expect(t({ backdropSaturate: 200 })).toBe('backdrop-saturate-200');
    });

    it('{ backdropSepia: true } → backdrop-sepia', () => {
        expect(t({ backdropSepia: true })).toBe('backdrop-sepia');
    });
});

describe('effects — ring offset', () => {
    it('{ ringOffset: 2 } → ring-offset-2', () => {
        expect(t({ ringOffset: 2 })).toBe('ring-offset-2');
    });

    it('{ ringOffset: "4px" } → ring-offset-[4px] (arbitrary)', () => {
        expect(t({ ringOffset: '4px' })).toBe('ring-offset-[4px]');
    });
});
