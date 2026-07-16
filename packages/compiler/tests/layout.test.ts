import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

describe('layout — aspect ratio', () => {
    it('{ aspect: "auto" } → aspect-auto', () => {
        expect(t({ aspect: 'auto' })).toBe('aspect-auto');
    });

    it('{ aspect: "square" } → aspect-square', () => {
        expect(t({ aspect: 'square' })).toBe('aspect-square');
    });

    it('{ aspect: "video" } → aspect-video', () => {
        expect(t({ aspect: 'video' })).toBe('aspect-video');
    });

    it('{ aspect: "4/3" } → aspect-4/3', () => {
        expect(t({ aspect: '4/3' })).toBe('aspect-4/3');
    });

    it('{ aspect: "4/2.5" } → aspect-[4/2.5] (arbitrary decimal)', () => {
        expect(t({ aspect: '4/2.5' })).toBe('aspect-[4/2.5]');
    });

    it('{ aspect: "calc(4*3+1)/3" } → aspect-[calc(4*3+1)/3] (arbitrary calc)', () => {
        expect(t({ aspect: 'calc(4*3+1)/3' })).toBe('aspect-[calc(4*3+1)/3]');
    });

    it('{ aspect: "--my-ratio" } → aspect-(--my-ratio) (css variable)', () => {
        expect(t({ aspect: '--my-ratio' })).toBe('aspect-(--my-ratio)');
    });
});

describe('layout — columns', () => {
    it('{ columns: "auto" } → columns-auto', () => {
        expect(t({ columns: 'auto' })).toBe('columns-auto');
    });

    it('{ columns: 3 } → columns-3', () => {
        expect(t({ columns: 3 })).toBe('columns-3');
    });

    it('{ columns: "md" } → columns-md', () => {
        expect(t({ columns: 'md' })).toBe('columns-md');
    });

    it('{ columns: "14rem" } → columns-[14rem] (arbitrary)', () => {
        expect(t({ columns: '14rem' })).toBe('columns-[14rem]');
    });

    it('{ columns: "--width" } → columns-(--width) (css variable)', () => {
        expect(t({ columns: '--width' })).toBe('columns-(--width)');
    });
});

describe('layout — break after', () => {
    it('{ breakAfter: "auto" } → break-after-auto', () => {
        expect(t({ breakAfter: 'auto' })).toBe('break-after-auto');
    });

    it('{ breakAfter: "avoid" } → break-after-avoid', () => {
        expect(t({ breakAfter: 'avoid' })).toBe('break-after-avoid');
    });
});

describe('layout — break before', () => {
    it('{ breakBefore: "auto" } → break-before-auto', () => {
        expect(t({ breakBefore: 'auto' })).toBe('break-before-auto');
    });

    it('{ breakBefore: "avoid-page" } → break-before-avoid-page', () => {
        expect(t({ breakBefore: 'avoid-page' })).toBe('break-before-avoid-page');
    });
});

describe('layout — break inside', () => {
    it('{ breakInside: "auto" } → break-inside-auto', () => {
        expect(t({ breakInside: 'auto' })).toBe('break-inside-auto');
    });

    it('{ breakInside: "avoid-column" } → break-inside-avoid-column', () => {
        expect(t({ breakInside: 'avoid-column' })).toBe('break-inside-avoid-column');
    });
});

describe('layout — box decoration break', () => {
    it('{ boxDecoration: "slice" } → box-decoration-slice', () => {
        expect(t({ boxDecoration: 'slice' })).toBe('box-decoration-slice');
    });

    it('{ boxDecoration: "clone" } → box-decoration-clone', () => {
        expect(t({ boxDecoration: 'clone' })).toBe('box-decoration-clone');
    });
});

describe('layout — box sizing', () => {
    it('{ box: "border" } → box-border', () => {
        expect(t({ box: 'border' })).toBe('box-border');
    });

    it('{ box: "content" } → box-content', () => {
        expect(t({ box: 'content' })).toBe('box-content');
    });
});

describe('layout — display', () => {
    it('{ display: "block" } → block', () => {
        expect(t({ display: 'block' })).toBe('block');
    });

    it('{ display: "inline-block" } → inline-block', () => {
        expect(t({ display: 'inline-block' })).toBe('inline-block');
    });

    it('{ display: "flex" } → flex', () => {
        expect(t({ display: 'flex' })).toBe('flex');
    });

    it('{ display: "grid" } → grid', () => {
        expect(t({ display: 'grid' })).toBe('grid');
    });

    it('{ display: "none" } → hidden', () => {
        expect(t({ display: 'none' })).toBe('hidden');
    });

    it('{ srOnly: true } → sr-only (handled also in misc.test.ts)', () => {
        expect(t({ srOnly: true })).toBe('sr-only');
    });
});

describe('layout — floats', () => {
    it('{ float: "right" } → float-right', () => {
        expect(t({ float: 'right' })).toBe('float-right');
    });

    it('{ float: "start" } → float-start', () => {
        expect(t({ float: 'start' })).toBe('float-start');
    });
});

describe('layout — clear', () => {
    it('{ clear: "left" } → clear-left', () => {
        expect(t({ clear: 'left' })).toBe('clear-left');
    });

    it('{ clear: "both" } → clear-both', () => {
        expect(t({ clear: 'both' })).toBe('clear-both');
    });
});

describe('layout — isolation', () => {
    it('{ isolation: "isolate" } → isolate', () => {
        expect(t({ isolation: 'isolate' })).toBe('isolate');
    });

    it('{ isolation: "auto" } → isolation-auto', () => {
        expect(t({ isolation: 'auto' })).toBe('isolation-auto');
    });
});

describe('layout — object fit', () => {
    it('{ objectFit: "cover" } → object-cover', () => {
        expect(t({ objectFit: 'cover' })).toBe('object-cover');
    });

    it('{ objectFit: "contain" } → object-contain', () => {
        expect(t({ objectFit: 'contain' })).toBe('object-contain');
    });
});

describe('layout — object position', () => {
    it('{ objectPos: "top-left" } → object-top-left', () => {
        expect(t({ objectPos: 'top-left' })).toBe('object-top-left');
    });

    it('{ objectPos: "center" } → object-center', () => {
        expect(t({ objectPos: 'center' })).toBe('object-center');
    });

    it('{ objectPos: "50% 50%" } → object-[50%_50%] (arbitrary)', () => {
        expect(t({ objectPos: '50% 50%' })).toBe('object-[50%_50%]');
    });

    it('{ objectPos: "--pos" } → object-(--pos) (css variable)', () => {
        expect(t({ objectPos: '--pos' })).toBe('object-(--pos)');
    });
});

describe('layout — overflow', () => {
    it('{ overflow: "auto" } → overflow-auto', () => {
        expect(t({ overflow: 'auto' })).toBe('overflow-auto');
    });

    it('{ overflow: "hidden" } → overflow-hidden', () => {
        expect(t({ overflow: 'hidden' })).toBe('overflow-hidden');
    });

    it('{ overflowX: "hidden" } → overflow-x-hidden', () => {
        expect(t({ overflowX: 'hidden' })).toBe('overflow-x-hidden');
    });

    it('{ overflowY: "scroll" } → overflow-y-scroll', () => {
        expect(t({ overflowY: 'scroll' })).toBe('overflow-y-scroll');
    });
});

describe('layout — overscroll behavior', () => {
    it('{ overscroll: "auto" } → overscroll-auto', () => {
        expect(t({ overscroll: 'auto' })).toBe('overscroll-auto');
    });

    it('{ overscrollX: "none" } → overscroll-x-none', () => {
        expect(t({ overscrollX: 'none' })).toBe('overscroll-x-none');
    });

    it('{ overscrollY: "contain" } → overscroll-y-contain', () => {
        expect(t({ overscrollY: 'contain' })).toBe('overscroll-y-contain');
    });
});

describe('layout — position', () => {
    it('{ position: "static" } → static', () => {
        expect(t({ position: 'static' })).toBe('static');
    });

    it('{ position: "absolute" } → absolute', () => {
        expect(t({ position: 'absolute' })).toBe('absolute');
    });

    it('{ position: "relative" } → relative', () => {
        expect(t({ position: 'relative' })).toBe('relative');
    });
});

describe('layout — top / right / bottom / left (placement)', () => {
    it('{ inset: 4 } → inset-4', () => {
        expect(t({ inset: 4 })).toBe('inset-4');
    });

    it('{ inset: -4 } → -inset-4', () => {
        expect(t({ inset: -4 })).toBe('-inset-4');
    });

    it('{ inset: "1/2" } → inset-1/2', () => {
        expect(t({ inset: '1/2' })).toBe('inset-1/2');
    });

    it('{ inset: "-1/2" } → -inset-1/2', () => {
        expect(t({ inset: '-1/2' })).toBe('-inset-1/2');
    });

    it('{ inset: "px" } → inset-px', () => {
        expect(t({ inset: 'px' })).toBe('inset-px');
    });

    it('{ inset: "-px" } → -inset-px', () => {
        expect(t({ inset: '-px' })).toBe('-inset-px');
    });

    it('{ inset: "27px" } → inset-[27px] (arbitrary)', () => {
        expect(t({ inset: '27px' })).toBe('inset-[27px]');
    });

    it('{ inset: "--inset" } → inset-(--inset) (css variable)', () => {
        expect(t({ inset: '--inset' })).toBe('inset-(--inset)');
    });

    it('{ insetX: 4 } → inset-x-4', () => {
        expect(t({ insetX: 4 })).toBe('inset-x-4');
    });

    it('{ insetY: -4 } → -inset-y-4', () => {
        expect(t({ insetY: -4 })).toBe('-inset-y-4');
    });

    it('{ start: 4 } → inset-s-4', () => {
        expect(t({ start: 4 })).toBe('inset-s-4');
    });

    it('{ insetS: 4 } → inset-s-4', () => {
        expect(t({ insetS: 4 })).toBe('inset-s-4');
    });

    it('{ end: 4 } → inset-e-4', () => {
        expect(t({ end: 4 })).toBe('inset-e-4');
    });

    it('{ insetE: 4 } → inset-e-4', () => {
        expect(t({ insetE: 4 })).toBe('inset-e-4');
    });

    it('{ top: 4 } → top-4', () => {
        expect(t({ top: 4 })).toBe('top-4');
    });

    it('{ top: -4 } → -top-4', () => {
        expect(t({ top: -4 })).toBe('-top-4');
    });

    it('{ top: "-1px" } → top-[-1px] (arbitrary string)', () => {
        expect(t({ top: '-1px' })).toBe('top-[-1px]');
    });

    it('{ top: "--offset" } → top-(--offset) (css variable)', () => {
        expect(t({ top: '--offset' })).toBe('top-(--offset)');
    });

    it('{ right: 4 } → right-4', () => {
        expect(t({ right: 4 })).toBe('right-4');
    });

    it('{ bottom: -4 } → -bottom-4', () => {
        expect(t({ bottom: -4 })).toBe('-bottom-4');
    });

    it('{ left: "4px" } → left-[4px]', () => {
        expect(t({ left: '4px' })).toBe('left-[4px]');
    });
});

describe('layout — visibility', () => {
    it('{ visibility: "visible" } → visible', () => {
        expect(t({ visibility: 'visible' })).toBe('visible');
    });

    it('{ visibility: "hidden" } → invisible', () => {
        expect(t({ visibility: 'hidden' })).toBe('invisible');
    });

    it('{ visibility: "collapse" } → collapse', () => {
        expect(t({ visibility: 'collapse' })).toBe('collapse');
    });
});

describe('layout — z-index', () => {
    it('{ z: 10 } → z-10', () => {
        expect(t({ z: 10 })).toBe('z-10');
    });

    it('{ z: -10 } → -z-10', () => {
        expect(t({ z: -10 })).toBe('-z-10');
    });

    it('{ z: "auto" } → z-auto', () => {
        expect(t({ z: 'auto' })).toBe('z-auto');
    });

    it('{ z: "calc(var(--index) + 1)" } → z-[calc(var(--index)_+_1)] (arbitrary)', () => {
        expect(t({ z: 'calc(var(--index) + 1)' })).toBe('z-[calc(var(--index)_+_1)]');
    });

    it('{ z: "--my-z" } → z-(--my-z) (css variable)', () => {
        expect(t({ z: '--my-z' })).toBe('z-(--my-z)');
    });
});
