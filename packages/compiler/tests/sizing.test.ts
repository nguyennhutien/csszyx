import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

describe('sizing — width', () => {
    it('{ w: 96 } → w-96', () => {
        expect(t({ w: 96 })).toBe('w-96');
    });

    it('{ w: "px" } → w-px', () => {
        expect(t({ w: 'px' })).toBe('w-px');
    });

    it('{ w: "1/2" } → w-1/2', () => {
        expect(t({ w: '1/2' })).toBe('w-1/2');
    });

    it('{ w: "full" } → w-full', () => {
        expect(t({ w: 'full' })).toBe('w-full');
    });

    it('{ w: "screen" } → w-screen', () => {
        expect(t({ w: 'screen' })).toBe('w-screen');
    });

    it('{ w: "svw" } → w-svw', () => {
        expect(t({ w: 'svw' })).toBe('w-svw');
    });

    it('{ w: "min" } → w-min', () => {
        expect(t({ w: 'min' })).toBe('w-min');
    });

    it('{ w: "auto" } → w-auto', () => {
        expect(t({ w: 'auto' })).toBe('w-auto');
    });

    it('{ w: "27px" } → w-[27px] (arbitrary)', () => {
        expect(t({ w: '27px' })).toBe('w-[27px]');
    });

    it('{ w: "--w" } → w-(--w) (css variable)', () => {
        expect(t({ w: '--w' })).toBe('w-(--w)');
    });
});

describe('sizing — min width', () => {
    it('{ minW: 96 } → min-w-96', () => {
        expect(t({ minW: 96 })).toBe('min-w-96');
    });

    it('{ minW: "px" } → min-w-px', () => {
        expect(t({ minW: 'px' })).toBe('min-w-px');
    });

    it('{ minW: "1/2" } → min-w-1/2', () => {
        expect(t({ minW: '1/2' })).toBe('min-w-1/2');
    });

    it('{ minW: "full" } → min-w-full', () => {
        expect(t({ minW: 'full' })).toBe('min-w-full');
    });

    it('{ minW: "min" } → min-w-min', () => {
        expect(t({ minW: 'min' })).toBe('min-w-min');
    });

    it('{ minW: "3px" } → min-w-[3px] (arbitrary)', () => {
        expect(t({ minW: '3px' })).toBe('min-w-[3px]');
    });

    it('{ minW: "--w" } → min-w-(--w) (css variable)', () => {
        expect(t({ minW: '--w' })).toBe('min-w-(--w)');
    });
});

describe('sizing — max width', () => {
    it('{ maxW: 96 } → max-w-96', () => {
        expect(t({ maxW: 96 })).toBe('max-w-96');
    });

    it('{ maxW: "px" } → max-w-px', () => {
        expect(t({ maxW: 'px' })).toBe('max-w-px');
    });

    it('{ maxW: "full" } → max-w-full', () => {
        expect(t({ maxW: 'full' })).toBe('max-w-full');
    });

    it('{ maxW: "none" } → max-w-none', () => {
        expect(t({ maxW: 'none' })).toBe('max-w-none');
    });

    it('{ maxW: "prose" } → max-w-prose', () => {
        expect(t({ maxW: 'prose' })).toBe('max-w-prose');
    });

    it('{ maxW: "md" } → max-w-md (breakpoint)', () => {
        expect(t({ maxW: 'md' })).toBe('max-w-md');
    });

    it('{ maxW: "screen-md" } → max-w-screen-md (screen breakpoint)', () => {
        expect(t({ maxW: 'screen-md' })).toBe('max-w-screen-md');
    });

    it('{ maxW: "3px" } → max-w-[3px] (arbitrary)', () => {
        expect(t({ maxW: '3px' })).toBe('max-w-[3px]');
    });

    it('{ maxW: "--w" } → max-w-(--w) (css variable)', () => {
        expect(t({ maxW: '--w' })).toBe('max-w-(--w)');
    });
});

describe('sizing — height', () => {
    it('{ h: 96 } → h-96', () => {
        expect(t({ h: 96 })).toBe('h-96');
    });

    it('{ h: "px" } → h-px', () => {
        expect(t({ h: 'px' })).toBe('h-px');
    });

    it('{ h: "1/2" } → h-1/2', () => {
        expect(t({ h: '1/2' })).toBe('h-1/2');
    });

    it('{ h: "full" } → h-full', () => {
        expect(t({ h: 'full' })).toBe('h-full');
    });

    it('{ h: "screen" } → h-screen', () => {
        expect(t({ h: 'screen' })).toBe('h-screen');
    });

    it('{ h: "auto" } → h-auto', () => {
        expect(t({ h: 'auto' })).toBe('h-auto');
    });

    it('{ h: "3px" } → h-[3px] (arbitrary)', () => {
        expect(t({ h: '3px' })).toBe('h-[3px]');
    });

    it('{ h: "--h" } → h-(--h) (css variable)', () => {
        expect(t({ h: '--h' })).toBe('h-(--h)');
    });
});

describe('sizing — min height', () => {
    it('{ minH: 96 } → min-h-96', () => {
        expect(t({ minH: 96 })).toBe('min-h-96');
    });

    it('{ minH: "full" } → min-h-full', () => {
        expect(t({ minH: 'full' })).toBe('min-h-full');
    });

    it('{ minH: "screen" } → min-h-screen', () => {
        expect(t({ minH: 'screen' })).toBe('min-h-screen');
    });

    it('{ minH: "3px" } → min-h-[3px] (arbitrary)', () => {
        expect(t({ minH: '3px' })).toBe('min-h-[3px]');
    });
});

describe('sizing — max height', () => {
    it('{ maxH: 96 } → max-h-96', () => {
        expect(t({ maxH: 96 })).toBe('max-h-96');
    });

    it('{ maxH: "full" } → max-h-full', () => {
        expect(t({ maxH: 'full' })).toBe('max-h-full');
    });

    it('{ maxH: "screen" } → max-h-screen', () => {
        expect(t({ maxH: 'screen' })).toBe('max-h-screen');
    });

    it('{ maxH: "3px" } → max-h-[3px] (arbitrary)', () => {
        expect(t({ maxH: '3px' })).toBe('max-h-[3px]');
    });
});

describe('sizing — size', () => {
    it('{ size: 16 } → size-16', () => {
        expect(t({ size: 16 })).toBe('size-16');
    });

    it('{ size: "px" } → size-px', () => {
        expect(t({ size: 'px' })).toBe('size-px');
    });

    it('{ size: "1/2" } → size-1/2', () => {
        expect(t({ size: '1/2' })).toBe('size-1/2');
    });

    it('{ size: "full" } → size-full', () => {
        expect(t({ size: 'full' })).toBe('size-full');
    });

    it('{ size: "3px" } → size-[3px] (arbitrary)', () => {
        expect(t({ size: '3px' })).toBe('size-[3px]');
    });

    it('{ size: "--s" } → size-(--s) (css variable)', () => {
        expect(t({ size: '--s' })).toBe('size-(--s)');
    });
});

describe('sizing — block size (logical height)', () => {
    it('{ blockSize: 16 } → block-16', () => {
        expect(t({ blockSize: 16 })).toBe('block-16');
    });

    it('{ blockSize: "full" } → block-full', () => {
        expect(t({ blockSize: 'full' })).toBe('block-full');
    });

    it('{ minBlockSize: 4 } → min-block-4', () => {
        expect(t({ minBlockSize: 4 })).toBe('min-block-4');
    });

    it('{ maxBlockSize: 8 } → max-block-8', () => {
        expect(t({ maxBlockSize: 8 })).toBe('max-block-8');
    });

    it('{ blockSize: "--bs" } → block-(--bs) (css variable)', () => {
        expect(t({ blockSize: '--bs' })).toBe('block-(--bs)');
    });
});

describe('sizing — inline size (logical width)', () => {
    it('{ inlineSize: 16 } → inline-16', () => {
        expect(t({ inlineSize: 16 })).toBe('inline-16');
    });

    it('{ inlineSize: "full" } → inline-full', () => {
        expect(t({ inlineSize: 'full' })).toBe('inline-full');
    });

    it('{ minInlineSize: 4 } → min-inline-4', () => {
        expect(t({ minInlineSize: 4 })).toBe('min-inline-4');
    });

    it('{ maxInlineSize: 8 } → max-inline-8', () => {
        expect(t({ maxInlineSize: 8 })).toBe('max-inline-8');
    });

    it('{ inlineSize: "--is" } → inline-(--is) (css variable)', () => {
        expect(t({ inlineSize: '--is' })).toBe('inline-(--is)');
    });
});

describe('sizing — utilities', () => {
    it('{ container: true } → container', () => {
        expect(t({ container: true })).toBe('container');
    });

    it('{ prose: true } → prose', () => {
        expect(t({ prose: true })).toBe('prose');
    });

    it('{ prose: "lg" } → prose-lg', () => {
        expect(t({ prose: 'lg' })).toBe('prose-lg');
    });

    it('{ proseInvert: true } → prose-invert', () => {
        expect(t({ proseInvert: true })).toBe('prose-invert');
    });
});
