import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform-core.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

describe('flexbox & grid — flex basis', () => {
    it('{ basis: "auto" } → basis-auto', () => {
        expect(t({ basis: 'auto' })).toBe('basis-auto');
    });

    it('{ basis: "full" } → basis-full', () => {
        expect(t({ basis: 'full' })).toBe('basis-full');
    });

    it('{ basis: 4 } → basis-4', () => {
        expect(t({ basis: 4 })).toBe('basis-4');
    });

    it('{ basis: "1/2" } → basis-1/2', () => {
        expect(t({ basis: '1/2' })).toBe('basis-1/2');
    });

    it('{ basis: "3xs" } → basis-3xs', () => {
        expect(t({ basis: '3xs' })).toBe('basis-3xs');
    });

    it('{ basis: 0 } → basis-0', () => {
        expect(t({ basis: 0 })).toBe('basis-0');
    });

    it('{ basis: "px" } → basis-px', () => {
        expect(t({ basis: 'px' })).toBe('basis-px');
    });

    it('{ basis: "14.28%" } → basis-[14.28%] (arbitrary)', () => {
        expect(t({ basis: '14.28%' })).toBe('basis-[14.28%]');
    });

    it('{ basis: "--basis" } → basis-(--basis) (css variable)', () => {
        expect(t({ basis: '--basis' })).toBe('basis-(--basis)');
    });
});

describe('flexbox & grid — flex direction', () => {
    it('{ flexDir: "row" } → flex-row', () => {
        expect(t({ flexDir: 'row' })).toBe('flex-row');
    });

    it('{ flexDir: "col-reverse" } → flex-col-reverse', () => {
        expect(t({ flexDir: 'col-reverse' })).toBe('flex-col-reverse');
    });
});

describe('flexbox & grid — flex wrap', () => {
    it('{ flexWrap: "wrap" } → flex-wrap', () => {
        expect(t({ flexWrap: 'wrap' })).toBe('flex-wrap');
    });

    it('{ flexWrap: "nowrap" } → flex-nowrap', () => {
        expect(t({ flexWrap: 'nowrap' })).toBe('flex-nowrap');
    });
});

describe('flexbox & grid — flex grow', () => {
    it('{ grow: true } → grow', () => {
        expect(t({ grow: true })).toBe('grow');
    });

    it('{ grow: 0 } → grow-0', () => {
        expect(t({ grow: 0 })).toBe('grow-0');
    });

    it('{ grow: 2.5 } → grow-2.5 (arbitrary)', () => {
        expect(t({ grow: 2.5 })).toBe('grow-2.5');
    });

    it('{ grow: "calc(1rem + 2px)" } → grow-[calc(1rem_+_2px)] (arbitrary)', () => {
        expect(t({ grow: 'calc(1rem + 2px)' })).toBe('grow-[calc(1rem_+_2px)]');
    });

    it('{ grow: "--grow" } → grow-(--grow) (css variable)', () => {
        expect(t({ grow: '--grow' })).toBe('grow-(--grow)');
    });
});

describe('flexbox & grid — flex shrink', () => {
    it('{ shrink: true } → shrink', () => {
        expect(t({ shrink: true })).toBe('shrink');
    });

    it('{ shrink: 0 } → shrink-0', () => {
        expect(t({ shrink: 0 })).toBe('shrink-0');
    });

    it('{ shrink: 2.5 } → shrink-2.5 (arbitrary)', () => {
        expect(t({ shrink: 2.5 })).toBe('shrink-2.5');
    });

    it('{ shrink: "--shrink" } → shrink-(--shrink) (css variable)', () => {
        expect(t({ shrink: '--shrink' })).toBe('shrink-(--shrink)');
    });
});

describe('flexbox & grid — flex', () => {
    it('{ flex: 1 } → flex-1', () => {
        expect(t({ flex: 1 })).toBe('flex-1');
    });

    it('{ flex: "1/2" } → flex-1/2', () => {
        expect(t({ flex: '1/2' })).toBe('flex-1/2');
    });

    it('{ flex: "auto" } → flex-auto', () => {
        expect(t({ flex: 'auto' })).toBe('flex-auto');
    });

    it('{ flex: "initial" } → flex-initial', () => {
        expect(t({ flex: 'initial' })).toBe('flex-initial');
    });

    it('{ flex: "none" } → flex-none', () => {
        expect(t({ flex: 'none' })).toBe('flex-none');
    });

    it('{ flex: 3.5 } → flex-3.5 (arbitrary)', () => {
        expect(t({ flex: 3.5 })).toBe('flex-3.5');
    });

    it('{ flex: "2 2 0%" } → flex-[2_2_0%] (arbitrary)', () => {
        expect(t({ flex: '2 2 0%' })).toBe('flex-[2_2_0%]');
    });

    it('{ flex: "--flex" } → flex-(--flex) (css variable)', () => {
        expect(t({ flex: '--flex' })).toBe('flex-(--flex)');
    });
});

describe('flexbox & grid — order', () => {
    it('{ order: 1 } → order-1', () => {
        expect(t({ order: 1 })).toBe('order-1');
    });

    it('{ order: "first" } → order-first', () => {
        expect(t({ order: 'first' })).toBe('order-first');
    });

    it('{ order: "last" } → order-last', () => {
        expect(t({ order: 'last' })).toBe('order-last');
    });

    it('{ order: "none" } → order-none', () => {
        expect(t({ order: 'none' })).toBe('order-none');
    });

    it('{ order: -1 } → -order-1', () => {
        expect(t({ order: -1 })).toBe('-order-1');
    });

    it('{ order: "calc(100/5)" } → order-[calc(100/5)] (arbitrary)', () => {
        expect(t({ order: 'calc(100/5)' })).toBe('order-[calc(100/5)]');
    });

    it('{ order: "--order" } → order-(--order) (css variable)', () => {
        expect(t({ order: '--order' })).toBe('order-(--order)');
    });
});

describe('flexbox & grid — grid template columns', () => {
    it('{ gridCols: 3 } → grid-cols-3', () => {
        expect(t({ gridCols: 3 })).toBe('grid-cols-3');
    });

    it('{ gridCols: "none" } → grid-cols-none', () => {
        expect(t({ gridCols: 'none' })).toBe('grid-cols-none');
    });

    it('{ gridCols: "subgrid" } → grid-cols-subgrid', () => {
        expect(t({ gridCols: 'subgrid' })).toBe('grid-cols-subgrid');
    });

    it('{ gridCols: "200px" } → grid-cols-[200px] (arbitrary)', () => {
        expect(t({ gridCols: '200px' })).toBe('grid-cols-[200px]');
    });

    it('{ gridCols: "280px minmax(0,1fr)" } → grid-cols-[280px_minmax(0,1fr)] (spaces underscored)', () => {
        expect(t({ gridCols: '280px minmax(0,1fr)' })).toBe('grid-cols-[280px_minmax(0,1fr)]');
    });

    it('{ gridCols: "--grid-cols" } → grid-cols-(--grid-cols) (css variable)', () => {
        expect(t({ gridCols: '--grid-cols' })).toBe('grid-cols-(--grid-cols)');
    });
});

describe('flexbox & grid — grid template rows', () => {
    it('{ gridRows: 3 } → grid-rows-3', () => {
        expect(t({ gridRows: 3 })).toBe('grid-rows-3');
    });

    it('{ gridRows: "none" } → grid-rows-none', () => {
        expect(t({ gridRows: 'none' })).toBe('grid-rows-none');
    });

    it('{ gridRows: "subgrid" } → grid-rows-subgrid', () => {
        expect(t({ gridRows: 'subgrid' })).toBe('grid-rows-subgrid');
    });

    it('{ gridRows: "200px" } → grid-rows-[200px] (arbitrary)', () => {
        expect(t({ gridRows: '200px' })).toBe('grid-rows-[200px]');
    });

    it('{ gridRows: "--grid-rows" } → grid-rows-(--grid-rows) (css variable)', () => {
        expect(t({ gridRows: '--grid-rows' })).toBe('grid-rows-(--grid-rows)');
    });
});

describe('flexbox & grid — grid column', () => {
    it('{ col: "auto" } → col-auto', () => {
        expect(t({ col: 'auto' })).toBe('col-auto');
    });

    it('{ colSpan: 2 } → col-span-2', () => {
        expect(t({ colSpan: 2 })).toBe('col-span-2');
    });

    it('{ colSpan: "full" } → col-span-full', () => {
        expect(t({ colSpan: 'full' })).toBe('col-span-full');
    });

    it('{ colStart: 2 } → col-start-2', () => {
        expect(t({ colStart: 2 })).toBe('col-start-2');
    });

    it('{ colStart: -1 } → -col-start-1', () => {
        expect(t({ colStart: -1 })).toBe('-col-start-1');
    });

    it('{ colStart: "auto" } → col-start-auto', () => {
        expect(t({ colStart: 'auto' })).toBe('col-start-auto');
    });

    it('{ colEnd: 3 } → col-end-3', () => {
        expect(t({ colEnd: 3 })).toBe('col-end-3');
    });

    it('{ colEnd: -1 } → -col-end-1', () => {
        expect(t({ colEnd: -1 })).toBe('-col-end-1');
    });

    it('{ colEnd: "auto" } → col-end-auto', () => {
        expect(t({ colEnd: 'auto' })).toBe('col-end-auto');
    });

    it('{ col: 2 } → col-2', () => {
        expect(t({ col: 2 })).toBe('col-2');
    });

    it('{ col: -1 } → -col-1', () => {
        expect(t({ col: -1 })).toBe('-col-1');
    });

    it('{ colSpan: "--col-span" } → col-span-(--col-span) (css variable)', () => {
        expect(t({ colSpan: '--col-span' })).toBe('col-span-(--col-span)');
    });
});

describe('flexbox & grid — grid row', () => {
    it('{ row: "auto" } → row-auto', () => {
        expect(t({ row: 'auto' })).toBe('row-auto');
    });

    it('{ rowSpan: 2 } → row-span-2', () => {
        expect(t({ rowSpan: 2 })).toBe('row-span-2');
    });

    it('{ rowSpan: "full" } → row-span-full', () => {
        expect(t({ rowSpan: 'full' })).toBe('row-span-full');
    });

    it('{ rowStart: 2 } → row-start-2', () => {
        expect(t({ rowStart: 2 })).toBe('row-start-2');
    });

    it('{ rowStart: -1 } → -row-start-1', () => {
        expect(t({ rowStart: -1 })).toBe('-row-start-1');
    });

    it('{ rowStart: "auto" } → row-start-auto', () => {
        expect(t({ rowStart: 'auto' })).toBe('row-start-auto');
    });

    it('{ rowEnd: 3 } → row-end-3', () => {
        expect(t({ rowEnd: 3 })).toBe('row-end-3');
    });

    it('{ rowEnd: -1 } → -row-end-1', () => {
        expect(t({ rowEnd: -1 })).toBe('-row-end-1');
    });

    it('{ rowEnd: "auto" } → row-end-auto', () => {
        expect(t({ rowEnd: 'auto' })).toBe('row-end-auto');
    });

    it('{ row: 2 } → row-2', () => {
        expect(t({ row: 2 })).toBe('row-2');
    });

    it('{ row: -1 } → -row-1', () => {
        expect(t({ row: -1 })).toBe('-row-1');
    });

    it('{ rowSpan: "--row-span" } → row-span-(--row-span) (css variable)', () => {
        expect(t({ rowSpan: '--row-span' })).toBe('row-span-(--row-span)');
    });
});

describe('flexbox & grid — grid auto flow', () => {
    it('{ gridFlow: "row" } → grid-flow-row', () => {
        expect(t({ gridFlow: 'row' })).toBe('grid-flow-row');
    });

    it('{ gridFlow: "col-dense" } → grid-flow-col-dense', () => {
        expect(t({ gridFlow: 'col-dense' })).toBe('grid-flow-col-dense');
    });
});

describe('flexbox & grid — grid auto columns', () => {
    it('{ autoCols: 12 } → auto-cols-12 (Tailwind v4.3.2 spacing)', () => {
        expect(t({ autoCols: 12 })).toBe('auto-cols-12');
    });

    it('{ autoCols: "auto" } → auto-cols-auto', () => {
        expect(t({ autoCols: 'auto' })).toBe('auto-cols-auto');
    });

    it('{ autoCols: "min" } → auto-cols-min', () => {
        expect(t({ autoCols: 'min' })).toBe('auto-cols-min');
    });

    it('{ autoCols: "max" } → auto-cols-max', () => {
        expect(t({ autoCols: 'max' })).toBe('auto-cols-max');
    });

    it('{ autoCols: "fr" } → auto-cols-fr', () => {
        expect(t({ autoCols: 'fr' })).toBe('auto-cols-fr');
    });

    it('{ autoCols: "minmax(0,2fr)" } → auto-cols-[minmax(0,2fr)] (arbitrary)', () => {
        expect(t({ autoCols: 'minmax(0,2fr)' })).toBe('auto-cols-[minmax(0,2fr)]');
    });

    it('{ autoCols: "--auto-cols" } → auto-cols-(--auto-cols) (css variable)', () => {
        expect(t({ autoCols: '--auto-cols' })).toBe('auto-cols-(--auto-cols)');
    });
});

describe('flexbox & grid — grid auto rows', () => {
    it('{ autoRows: 16 } → auto-rows-16 (Tailwind v4.3.2 spacing)', () => {
        expect(t({ autoRows: 16 })).toBe('auto-rows-16');
    });

    it('{ autoRows: "auto" } → auto-rows-auto', () => {
        expect(t({ autoRows: 'auto' })).toBe('auto-rows-auto');
    });

    it('{ autoRows: "min" } → auto-rows-min', () => {
        expect(t({ autoRows: 'min' })).toBe('auto-rows-min');
    });

    it('{ autoRows: "max" } → auto-rows-max', () => {
        expect(t({ autoRows: 'max' })).toBe('auto-rows-max');
    });

    it('{ autoRows: "fr" } → auto-rows-fr', () => {
        expect(t({ autoRows: 'fr' })).toBe('auto-rows-fr');
    });

    it('{ autoRows: "minmax(0,2fr)" } → auto-rows-[minmax(0,2fr)] (arbitrary)', () => {
        expect(t({ autoRows: 'minmax(0,2fr)' })).toBe('auto-rows-[minmax(0,2fr)]');
    });

    it('{ autoRows: "--auto-rows" } → auto-rows-(--auto-rows) (css variable)', () => {
        expect(t({ autoRows: '--auto-rows' })).toBe('auto-rows-(--auto-rows)');
    });
});

describe('flexbox & grid — gap', () => {
    it('{ gap: 4 } → gap-4', () => {
        expect(t({ gap: 4 })).toBe('gap-4');
    });

    it('{ gap: "24px" } → gap-[24px] (arbitrary)', () => {
        expect(t({ gap: '24px' })).toBe('gap-[24px]');
    });

    it('{ gap: "--gap" } → gap-(--gap) (css variable)', () => {
        expect(t({ gap: '--gap' })).toBe('gap-(--gap)');
    });

    it('{ gapX: 4 } → gap-x-4', () => {
        expect(t({ gapX: 4 })).toBe('gap-x-4');
    });

    it('{ gapY: 4 } → gap-y-4', () => {
        expect(t({ gapY: 4 })).toBe('gap-y-4');
    });
});

describe('flexbox & grid — justify content', () => {
    it('{ justify: "normal" } → justify-normal', () => {
        expect(t({ justify: 'normal' })).toBe('justify-normal');
    });

    it('{ justify: "between" } → justify-between', () => {
        expect(t({ justify: 'between' })).toBe('justify-between');
    });

    it('{ justify: "center-safe" } → justify-center-safe', () => {
        expect(t({ justify: 'center-safe' })).toBe('justify-center-safe');
    });
});

describe('flexbox & grid — justify items', () => {
    it('{ justifyItems: "start" } → justify-items-start', () => {
        expect(t({ justifyItems: 'start' })).toBe('justify-items-start');
    });

    it('{ justifyItems: "center-safe" } → justify-items-center-safe', () => {
        expect(t({ justifyItems: 'center-safe' })).toBe('justify-items-center-safe');
    });
});

describe('flexbox & grid — justify self', () => {
    it('{ justifySelf: "auto" } → justify-self-auto', () => {
        expect(t({ justifySelf: 'auto' })).toBe('justify-self-auto');
    });

    it('{ justifySelf: "end-safe" } → justify-self-end-safe', () => {
        expect(t({ justifySelf: 'end-safe' })).toBe('justify-self-end-safe');
    });
});

describe('flexbox & grid — align content', () => {
    it('{ alignContent: "normal" } → content-normal', () => {
        expect(t({ alignContent: 'normal' })).toBe('content-normal');
    });

    it('{ alignContent: "between" } → content-between', () => {
        expect(t({ alignContent: 'between' })).toBe('content-between');
    });

    it('{ alignContent: "center" } → content-center', () => {
        expect(t({ alignContent: 'center' })).toBe('content-center');
    });

    it('{ alignContent: "stretch" } → content-stretch', () => {
        expect(t({ alignContent: 'stretch' })).toBe('content-stretch');
    });

    it('alignContent + content on same object — no collision', () => {
        // This was impossible before: a single sz object could not express both
        // align-content (layout) and CSS content property (pseudo-element) simultaneously.
        const result = t({ alignContent: 'between', content: "''" });
        expect(result).toContain('content-between');
        expect(result).toContain("content-['']");
    });
});

describe('flexbox & grid — align items', () => {
    it('{ items: "start" } → items-start', () => {
        expect(t({ items: 'start' })).toBe('items-start');
    });

    it('{ items: "center" } → items-center', () => {
        expect(t({ items: 'center' })).toBe('items-center');
    });

    it('{ items: "center-safe" } → items-center-safe', () => {
        expect(t({ items: 'center-safe' })).toBe('items-center-safe');
    });

    it('{ items: "baseline-last" } → items-baseline-last', () => {
        expect(t({ items: 'baseline-last' })).toBe('items-baseline-last');
    });
});

describe('flexbox & grid — align self', () => {
    it('{ self: "auto" } → self-auto', () => {
        expect(t({ self: 'auto' })).toBe('self-auto');
    });

    it('{ self: "stretch" } → self-stretch', () => {
        expect(t({ self: 'stretch' })).toBe('self-stretch');
    });
});

describe('flexbox & grid — place content', () => {
    it('{ placeContent: "center" } → place-content-center', () => {
        expect(t({ placeContent: 'center' })).toBe('place-content-center');
    });

    it('{ placeContent: "between" } → place-content-between', () => {
        expect(t({ placeContent: 'between' })).toBe('place-content-between');
    });
});

describe('flexbox & grid — place items', () => {
    it('{ placeItems: "start" } → place-items-start', () => {
        expect(t({ placeItems: 'start' })).toBe('place-items-start');
    });

    it('{ placeItems: "stretch" } → place-items-stretch', () => {
        expect(t({ placeItems: 'stretch' })).toBe('place-items-stretch');
    });
});

describe('flexbox & grid — place self', () => {
    it('{ placeSelf: "auto" } → place-self-auto', () => {
        expect(t({ placeSelf: 'auto' })).toBe('place-self-auto');
    });

    it('{ placeSelf: "stretch" } → place-self-stretch', () => {
        expect(t({ placeSelf: 'stretch' })).toBe('place-self-stretch');
    });
});
