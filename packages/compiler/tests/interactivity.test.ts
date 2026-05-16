import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

describe('interactivity — accent color', () => {
    it('{ accent: "red-500" } → accent-red-500', () => {
        expect(t({ accent: 'red-500' })).toBe('accent-red-500');
    });

    it('{ accent: "#50d71e" } → accent-[#50d71e] (arbitrary)', () => {
        expect(t({ accent: '#50d71e' })).toBe('accent-[#50d71e]');
    });

    it('{ accent: "--c" } → accent-(--c) (css variable)', () => {
        expect(t({ accent: '--c' })).toBe('accent-(--c)');
    });
});

describe('interactivity — appearance', () => {
    it('{ appearance: "none" } → appearance-none', () => {
        expect(t({ appearance: 'none' })).toBe('appearance-none');
    });

    it('{ appearance: "auto" } → appearance-auto', () => {
        expect(t({ appearance: 'auto' })).toBe('appearance-auto');
    });
});

describe('interactivity — caret color', () => {
    it('{ caret: "red-500" } → caret-red-500', () => {
        expect(t({ caret: 'red-500' })).toBe('caret-red-500');
    });

    it('{ caret: "#50d71e" } → caret-[#50d71e] (arbitrary)', () => {
        expect(t({ caret: '#50d71e' })).toBe('caret-[#50d71e]');
    });

    it('{ caret: "--c" } → caret-(--c) (css variable)', () => {
        expect(t({ caret: '--c' })).toBe('caret-(--c)');
    });
});

describe('interactivity — color scheme', () => {
    it('{ scheme: "dark" } → scheme-dark', () => {
        expect(t({ scheme: 'dark' })).toBe('scheme-dark');
    });

    it('{ scheme: "light" } → scheme-light', () => {
        expect(t({ scheme: 'light' })).toBe('scheme-light');
    });

    it('{ scheme: "only-dark" } → scheme-only-dark', () => {
        expect(t({ scheme: 'only-dark' })).toBe('scheme-only-dark');
    });

    it('{ scheme: "light-dark" } → scheme-light-dark', () => {
        expect(t({ scheme: 'light-dark' })).toBe('scheme-light-dark');
    });
});

describe('interactivity — cursor', () => {
    it('{ cursor: "pointer" } → cursor-pointer', () => {
        expect(t({ cursor: 'pointer' })).toBe('cursor-pointer');
    });

    it('{ cursor: "url(h.cur),_pointer" } → cursor-[url(h.cur),_pointer] (arbitrary)', () => {
        expect(t({ cursor: 'url(h.cur),_pointer' })).toBe('cursor-[url(h.cur),_pointer]');
    });

    it('{ cursor: "--c" } → cursor-(--c) (css variable)', () => {
        expect(t({ cursor: '--c' })).toBe('cursor-(--c)');
    });
});

describe('interactivity — field sizing', () => {
    it('{ fieldSizing: "fixed" } → field-sizing-fixed', () => {
        expect(t({ fieldSizing: 'fixed' })).toBe('field-sizing-fixed');
    });

    it('{ fieldSizing: "content" } → field-sizing-content', () => {
        expect(t({ fieldSizing: 'content' })).toBe('field-sizing-content');
    });
});

describe('interactivity — pointer events', () => {
    it('{ pointerEvents: "none" } → pointer-events-none', () => {
        expect(t({ pointerEvents: 'none' })).toBe('pointer-events-none');
    });

    it('{ pointerEvents: "auto" } → pointer-events-auto', () => {
        expect(t({ pointerEvents: 'auto' })).toBe('pointer-events-auto');
    });
});

describe('interactivity — resize', () => {
    it('{ resize: "none" } → resize-none', () => {
        expect(t({ resize: 'none' })).toBe('resize-none');
    });

    it('{ resize: true } → resize', () => {
        expect(t({ resize: true })).toBe('resize');
    });

    it('{ resize: "y" } → resize-y', () => {
        expect(t({ resize: 'y' })).toBe('resize-y');
    });

    it('{ resize: "x" } → resize-x', () => {
        expect(t({ resize: 'x' })).toBe('resize-x');
    });
});

describe('interactivity — scroll behavior', () => {
    it('{ scroll: "auto" } → scroll-auto', () => {
        expect(t({ scroll: 'auto' })).toBe('scroll-auto');
    });

    it('{ scroll: "smooth" } → scroll-smooth', () => {
        expect(t({ scroll: 'smooth' })).toBe('scroll-smooth');
    });
});

describe('interactivity — scroll margin', () => {
    it('{ scrollM: 4 } → scroll-m-4', () => {
        expect(t({ scrollM: 4 })).toBe('scroll-m-4');
    });

    it('{ scrollM: "px" } → scroll-m-px', () => {
        expect(t({ scrollM: 'px' })).toBe('scroll-m-px');
    });

    it('{ scrollMt: 4 } → scroll-mt-4', () => {
        expect(t({ scrollMt: 4 })).toBe('scroll-mt-4');
    });

    it('{ scrollMbs: 4 } → scroll-mbs-4', () => {
        expect(t({ scrollMbs: 4 })).toBe('scroll-mbs-4');
    });

    it('{ scrollM: -4 } → -scroll-m-4', () => {
        expect(t({ scrollM: -4 })).toBe('-scroll-m-4');
    });

    it('{ scrollM: "5px" } → scroll-m-[5px] (arbitrary)', () => {
        expect(t({ scrollM: '5px' })).toBe('scroll-m-[5px]');
    });

    it('{ scrollM: "--m" } → scroll-m-(--m) (css variable)', () => {
        expect(t({ scrollM: '--m' })).toBe('scroll-m-(--m)');
    });
});

describe('interactivity — scroll padding', () => {
    it('{ scrollP: 4 } → scroll-p-4', () => {
        expect(t({ scrollP: 4 })).toBe('scroll-p-4');
    });

    it('{ scrollP: "px" } → scroll-p-px', () => {
        expect(t({ scrollP: 'px' })).toBe('scroll-p-px');
    });

    it('{ scrollPt: 4 } → scroll-pt-4', () => {
        expect(t({ scrollPt: 4 })).toBe('scroll-pt-4');
    });

    it('{ scrollPbs: 4 } → scroll-pbs-4', () => {
        expect(t({ scrollPbs: 4 })).toBe('scroll-pbs-4');
    });

    it('{ scrollP: "5px" } → scroll-p-[5px] (arbitrary)', () => {
        expect(t({ scrollP: '5px' })).toBe('scroll-p-[5px]');
    });

    it('{ scrollP: "--p" } → scroll-p-(--p) (css variable)', () => {
        expect(t({ scrollP: '--p' })).toBe('scroll-p-(--p)');
    });
});

describe('interactivity — scroll snap align', () => {
    it('{ snapAlign: "start" } → snap-start', () => {
        expect(t({ snapAlign: 'start' })).toBe('snap-start');
    });

    it('{ snapAlign: "none" } → snap-align-none', () => {
        expect(t({ snapAlign: 'none' })).toBe('snap-align-none');
    });
});

describe('interactivity — scroll snap stop', () => {
    it('{ snapStop: "normal" } → snap-normal', () => {
        expect(t({ snapStop: 'normal' })).toBe('snap-normal');
    });

    it('{ snapStop: "always" } → snap-always', () => {
        expect(t({ snapStop: 'always' })).toBe('snap-always');
    });
});

describe('interactivity — scroll snap type', () => {
    it('{ snapType: "none" } → snap-none', () => {
        expect(t({ snapType: 'none' })).toBe('snap-none');
    });

    it('{ snapType: "x" } → snap-x', () => {
        expect(t({ snapType: 'x' })).toBe('snap-x');
    });

    it('{ snapType: "both" } → snap-both', () => {
        expect(t({ snapType: 'both' })).toBe('snap-both');
    });
});

describe('interactivity — scroll snap strictness', () => {
    it('{ snapStrictness: "mandatory" } → snap-mandatory', () => {
        expect(t({ snapStrictness: 'mandatory' })).toBe('snap-mandatory');
    });

    it('{ snapStrictness: "proximity" } → snap-proximity', () => {
        expect(t({ snapStrictness: 'proximity' })).toBe('snap-proximity');
    });
});

describe('interactivity — touch action', () => {
    it('{ touch: "auto" } → touch-auto', () => {
        expect(t({ touch: 'auto' })).toBe('touch-auto');
    });

    it('{ touch: "pan-x" } → touch-pan-x', () => {
        expect(t({ touch: 'pan-x' })).toBe('touch-pan-x');
    });
});

describe('interactivity — user select', () => {
    it('{ select: "none" } → select-none', () => {
        expect(t({ select: 'none' })).toBe('select-none');
    });

    it('{ select: "auto" } → select-auto', () => {
        expect(t({ select: 'auto' })).toBe('select-auto');
    });

    it('{ select: "text" } → select-text', () => {
        expect(t({ select: 'text' })).toBe('select-text');
    });

    it('{ select: "all" } → select-all', () => {
        expect(t({ select: 'all' })).toBe('select-all');
    });
});

describe('interactivity — will change', () => {
    it('{ willChange: "auto" } → will-change-auto', () => {
        expect(t({ willChange: 'auto' })).toBe('will-change-auto');
    });

    it('{ willChange: "scroll" } → will-change-scroll', () => {
        expect(t({ willChange: 'scroll' })).toBe('will-change-scroll');
    });

    it('{ willChange: "<v>" } → will-change-[<v>] (arbitrary)', () => {
        expect(t({ willChange: '<v>' })).toBe('will-change-[<v>]');
    });

    it('{ willChange: "--c" } → will-change-(--c) (css variable)', () => {
        expect(t({ willChange: '--c' })).toBe('will-change-(--c)');
    });
});

describe('interactivity — scroll margin (remaining directions)', () => {
    it('{ scrollMr: 4 } → scroll-mr-4', () => {
        expect(t({ scrollMr: 4 })).toBe('scroll-mr-4');
    });
    it('{ scrollMb: 4 } → scroll-mb-4', () => {
        expect(t({ scrollMb: 4 })).toBe('scroll-mb-4');
    });
    it('{ scrollMl: 4 } → scroll-ml-4', () => {
        expect(t({ scrollMl: 4 })).toBe('scroll-ml-4');
    });
    it('{ scrollMs: 4 } → scroll-ms-4', () => {
        expect(t({ scrollMs: 4 })).toBe('scroll-ms-4');
    });
    it('{ scrollMe: 4 } → scroll-me-4', () => {
        expect(t({ scrollMe: 4 })).toBe('scroll-me-4');
    });
    it('{ scrollMx: 4 } → scroll-mx-4', () => {
        expect(t({ scrollMx: 4 })).toBe('scroll-mx-4');
    });
    it('{ scrollMy: 4 } → scroll-my-4', () => {
        expect(t({ scrollMy: 4 })).toBe('scroll-my-4');
    });
});

describe('interactivity — scroll padding (remaining directions)', () => {
    it('{ scrollPr: 4 } → scroll-pr-4', () => {
        expect(t({ scrollPr: 4 })).toBe('scroll-pr-4');
    });
    it('{ scrollPb: 4 } → scroll-pb-4', () => {
        expect(t({ scrollPb: 4 })).toBe('scroll-pb-4');
    });
    it('{ scrollPl: 4 } → scroll-pl-4', () => {
        expect(t({ scrollPl: 4 })).toBe('scroll-pl-4');
    });
    it('{ scrollPs: 4 } → scroll-ps-4', () => {
        expect(t({ scrollPs: 4 })).toBe('scroll-ps-4');
    });
    it('{ scrollPe: 4 } → scroll-pe-4', () => {
        expect(t({ scrollPe: 4 })).toBe('scroll-pe-4');
    });
    it('{ scrollPx: 4 } → scroll-px-4', () => {
        expect(t({ scrollPx: 4 })).toBe('scroll-px-4');
    });
    it('{ scrollPy: 4 } → scroll-py-4', () => {
        expect(t({ scrollPy: 4 })).toBe('scroll-py-4');
    });
});
