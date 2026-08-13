import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform-core.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

describe('tables — border collapse', () => {
    it('{ borderCollapse: "collapse" } → border-collapse', () => {
        expect(t({ borderCollapse: 'collapse' })).toBe('border-collapse');
    });

    it('{ borderCollapse: "separate" } → border-separate', () => {
        expect(t({ borderCollapse: 'separate' })).toBe('border-separate');
    });
});

describe('tables — border spacing', () => {
    it('{ borderSpacing: 4 } → border-spacing-4', () => {
        expect(t({ borderSpacing: 4 })).toBe('border-spacing-4');
    });

    it('{ borderSpacing: "px" } → border-spacing-px', () => {
        expect(t({ borderSpacing: 'px' })).toBe('border-spacing-px');
    });

    it('{ borderSpacing: 0.5 } → border-spacing-0.5', () => {
        expect(t({ borderSpacing: 0.5 })).toBe('border-spacing-0.5');
    });

    it('{ borderSpacingX: 4 } → border-spacing-x-4', () => {
        expect(t({ borderSpacingX: 4 })).toBe('border-spacing-x-4');
    });

    it('{ borderSpacing: "3px" } → border-spacing-[3px] (arbitrary)', () => {
        expect(t({ borderSpacing: '3px' })).toBe('border-spacing-[3px]');
    });

    it('{ borderSpacing: "--s" } → border-spacing-(--s) (css variable)', () => {
        expect(t({ borderSpacing: '--s' })).toBe('border-spacing-(--s)');
    });
});

describe('tables — table layout', () => {
    it('{ tableLayout: "auto" } → table-auto', () => {
        expect(t({ tableLayout: 'auto' })).toBe('table-auto');
    });

    it('{ tableLayout: "fixed" } → table-fixed', () => {
        expect(t({ tableLayout: 'fixed' })).toBe('table-fixed');
    });
});

describe('tables — caption side', () => {
    it('{ caption: "top" } → caption-top', () => {
        expect(t({ caption: 'top' })).toBe('caption-top');
    });

    it('{ caption: "bottom" } → caption-bottom', () => {
        expect(t({ caption: 'bottom' })).toBe('caption-bottom');
    });
});

describe('misc utilities — svg fill', () => {
    it('{ fill: "red-500" } → fill-red-500', () => {
        expect(t({ fill: 'red-500' })).toBe('fill-red-500');
    });

    it('{ fill: "none" } → fill-none', () => {
        expect(t({ fill: 'none' })).toBe('fill-none');
    });

    it('{ fill: "inherit" } → fill-inherit', () => {
        expect(t({ fill: 'inherit' })).toBe('fill-inherit');
    });

    it('{ fill: "current" } → fill-current', () => {
        expect(t({ fill: 'current' })).toBe('fill-current');
    });

    it('{ fill: "transparent" } → fill-transparent', () => {
        expect(t({ fill: 'transparent' })).toBe('fill-transparent');
    });

    it('{ fill: "#50d71e" } → fill-[#50d71e] (arbitrary)', () => {
        expect(t({ fill: '#50d71e' })).toBe('fill-[#50d71e]');
    });

    it('{ fill: "--c" } → fill-(--c) (css variable)', () => {
        expect(t({ fill: '--c' })).toBe('fill-(--c)');
    });
});

describe('misc utilities — svg stroke', () => {
    it('{ stroke: "red-500" } → stroke-red-500', () => {
        expect(t({ stroke: 'red-500' })).toBe('stroke-red-500');
    });

    it('{ stroke: "none" } → stroke-none', () => {
        expect(t({ stroke: 'none' })).toBe('stroke-none');
    });

    it('{ stroke: "inherit" } → stroke-inherit', () => {
        expect(t({ stroke: 'inherit' })).toBe('stroke-inherit');
    });

    it('{ stroke: "current" } → stroke-current', () => {
        expect(t({ stroke: 'current' })).toBe('stroke-current');
    });

    it('{ stroke: "transparent" } → stroke-transparent', () => {
        expect(t({ stroke: 'transparent' })).toBe('stroke-transparent');
    });

    it('{ stroke: "#50d71e" } → stroke-[#50d71e] (arbitrary)', () => {
        expect(t({ stroke: '#50d71e' })).toBe('stroke-[#50d71e]');
    });

    it('{ stroke: "--c" } → stroke-(--c) (css variable)', () => {
        expect(t({ stroke: '--c' })).toBe('stroke-(--c)');
    });
});

describe('misc utilities — svg stroke width', () => {
    it('{ strokeWidth: 2 } → stroke-2', () => {
        expect(t({ strokeWidth: 2 })).toBe('stroke-2');
    });

    it('{ strokeWidth: 0.5 } → stroke-0.5', () => {
        expect(t({ strokeWidth: 0.5 })).toBe('stroke-0.5');
    });

    it('{ strokeWidth: "0.5rem" } → stroke-[0.5rem] (arbitrary css unit)', () => {
        expect(t({ strokeWidth: '0.5rem' })).toBe('stroke-[0.5rem]');
    });

    it('{ strokeWidth: "--w" } → stroke-(--w) (css variable)', () => {
        expect(t({ strokeWidth: '--w' })).toBe('stroke-(--w)');
    });
});

describe('misc utilities — accessibility forced color adjust', () => {
    it('{ forcedColorAdjust: "auto" } → forced-color-adjust-auto', () => {
        expect(t({ forcedColorAdjust: 'auto' })).toBe('forced-color-adjust-auto');
    });

    it('{ forcedColorAdjust: "none" } → forced-color-adjust-none', () => {
        expect(t({ forcedColorAdjust: 'none' })).toBe('forced-color-adjust-none');
    });
});

// Since `srOnly` and `notSrOnly` are usually handled as generic booleans or mapped explicitly,
// adding basic tests based on typical Tailwind usage.
describe('misc utilities — accessibility screen readers', () => {
    it('{ srOnly: true } → sr-only', () => {
        expect(t({ srOnly: true })).toBe('sr-only');
    });

    it('{ notSrOnly: true } → not-sr-only', () => {
        expect(t({ notSrOnly: true })).toBe('not-sr-only');
    });
});

describe('tables — border spacing Y axis', () => {
    it('{ borderSpacingY: 4 } → border-spacing-y-4', () => {
        expect(t({ borderSpacingY: 4 })).toBe('border-spacing-y-4');
    });
});
