import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform-core.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

describe('borders — border radius', () => {
    it('{ rounded: "sm" } → rounded-sm', () => {
        expect(t({ rounded: 'sm' })).toBe('rounded-sm');
    });

    it('{ rounded: "none" } → rounded-none', () => {
        expect(t({ rounded: 'none' })).toBe('rounded-none');
    });

    it('{ roundedT: "sm" } → rounded-t-sm', () => {
        expect(t({ roundedT: 'sm' })).toBe('rounded-t-sm');
    });

    it('{ roundedR: "sm" } → rounded-r-sm', () => {
        expect(t({ roundedR: 'sm' })).toBe('rounded-r-sm');
    });

    it('{ roundedB: "sm" } → rounded-b-sm', () => {
        expect(t({ roundedB: 'sm' })).toBe('rounded-b-sm');
    });

    it('{ roundedL: "sm" } → rounded-l-sm', () => {
        expect(t({ roundedL: 'sm' })).toBe('rounded-l-sm');
    });

    it('{ roundedTl: "sm" } → rounded-tl-sm', () => {
        expect(t({ roundedTl: 'sm' })).toBe('rounded-tl-sm');
    });

    it('{ roundedTr: "sm" } → rounded-tr-sm', () => {
        expect(t({ roundedTr: 'sm' })).toBe('rounded-tr-sm');
    });

    it('{ roundedBr: "sm" } → rounded-br-sm', () => {
        expect(t({ roundedBr: 'sm' })).toBe('rounded-br-sm');
    });

    it('{ roundedBl: "sm" } → rounded-bl-sm', () => {
        expect(t({ roundedBl: 'sm' })).toBe('rounded-bl-sm');
    });

    it('{ roundedS: "sm" } → rounded-s-sm', () => {
        expect(t({ roundedS: 'sm' })).toBe('rounded-s-sm');
    });

    it('{ roundedE: "sm" } → rounded-e-sm', () => {
        expect(t({ roundedE: 'sm' })).toBe('rounded-e-sm');
    });

    it('{ roundedSs: "sm" } → rounded-ss-sm', () => {
        expect(t({ roundedSs: 'sm' })).toBe('rounded-ss-sm');
    });

    it('{ roundedSe: "sm" } → rounded-se-sm', () => {
        expect(t({ roundedSe: 'sm' })).toBe('rounded-se-sm');
    });

    it('{ roundedEs: "sm" } → rounded-es-sm', () => {
        expect(t({ roundedEs: 'sm' })).toBe('rounded-es-sm');
    });

    it('{ roundedEe: "sm" } → rounded-ee-sm', () => {
        expect(t({ roundedEe: 'sm' })).toBe('rounded-ee-sm');
    });

    it('{ rounded: "5px" } → rounded-[5px] (arbitrary)', () => {
        expect(t({ rounded: '5px' })).toBe('rounded-[5px]');
    });

    it('{ rounded: "--r" } → rounded-(--r) (css variable)', () => {
        expect(t({ rounded: '--r' })).toBe('rounded-(--r)');
    });
});

describe('borders — border width', () => {
    it('{ border: true } → border', () => {
        expect(t({ border: true })).toBe('border');
    });

    it('{ border: 2 } → border-2', () => {
        expect(t({ border: 2 })).toBe('border-2');
    });

    it('{ borderX: 2 } → border-x-2', () => {
        expect(t({ borderX: 2 })).toBe('border-x-2');
    });

    it('{ borderY: 2 } → border-y-2', () => {
        expect(t({ borderY: 2 })).toBe('border-y-2');
    });

    it('{ borderT: 2 } → border-t-2', () => {
        expect(t({ borderT: 2 })).toBe('border-t-2');
    });

    it('{ borderR: 2 } → border-r-2', () => {
        expect(t({ borderR: 2 })).toBe('border-r-2');
    });

    it('{ borderB: 2 } → border-b-2', () => {
        expect(t({ borderB: 2 })).toBe('border-b-2');
    });

    it('{ borderL: 2 } → border-l-2', () => {
        expect(t({ borderL: 2 })).toBe('border-l-2');
    });

    it('{ borderS: 2 } → border-s-2', () => {
        expect(t({ borderS: 2 })).toBe('border-s-2');
    });

    it('{ borderE: 2 } → border-e-2', () => {
        expect(t({ borderE: 2 })).toBe('border-e-2');
    });

    it('{ borderBs: 2 } → border-bs-2', () => {
        expect(t({ borderBs: 2 })).toBe('border-bs-2');
    });

    it('{ borderBe: 2 } → border-be-2', () => {
        expect(t({ borderBe: 2 })).toBe('border-be-2');
    });

    it('{ border: "3px" } → border-[3px] (arbitrary)', () => {
        expect(t({ border: '3px' })).toBe('border-[3px]');
    });

    it('{ border: "--w" } → border-(--w) (css variable)', () => {
        expect(t({ border: '--w' })).toBe('border-(--w)');
    });

    it('{ border: "var(--w)" } → border-[var(--w)] (written out, not shorthand)', () => {
        // The two spellings of the same variable take different routes on
        // purpose: a bare `--w` becomes Tailwind's variable shorthand, while
        // one already written as `var(...)` is passed through as an arbitrary
        // value. Both emit the same CSS, so nothing here fails loudly if the
        // second one starts collapsing into the first — which is why the
        // boundary is pinned rather than left to the shorthand case alone.
        expect(t({ border: 'var(--w)' })).toBe('border-[var(--w)]');
    });
});

describe('borders — border color', () => {
    it('{ borderColor: "red-500" } → border-red-500', () => {
        expect(t({ borderColor: 'red-500' })).toBe('border-red-500');
    });

    it('{ borderColor: { color: "red-500", op: 50 } } → border-red-500/50', () => {
        expect(t({ borderColor: { color: 'red-500', op: 50 } })).toBe('border-red-500/50');
    });

    it('{ borderTColor: "red-500" } → border-t-red-500', () => {
        expect(t({ borderTColor: 'red-500' })).toBe('border-t-red-500');
    });

    it('{ borderRColor: "red-500" } → border-r-red-500', () => {
        expect(t({ borderRColor: 'red-500' })).toBe('border-r-red-500');
    });

    it('{ borderBColor: "red-500" } → border-b-red-500', () => {
        expect(t({ borderBColor: 'red-500' })).toBe('border-b-red-500');
    });

    it('{ borderLColor: "red-500" } → border-l-red-500', () => {
        expect(t({ borderLColor: 'red-500' })).toBe('border-l-red-500');
    });

    it('{ borderXColor: "red-500" } → border-x-red-500', () => {
        expect(t({ borderXColor: 'red-500' })).toBe('border-x-red-500');
    });

    it('{ borderYColor: "red-500" } → border-y-red-500', () => {
        expect(t({ borderYColor: 'red-500' })).toBe('border-y-red-500');
    });

    it('{ borderColor: "#50d71e" } → border-[#50d71e] (arbitrary)', () => {
        expect(t({ borderColor: '#50d71e' })).toBe('border-[#50d71e]');
    });

    it('{ borderColor: "--c" } → border-(--c) (css variable)', () => {
        expect(t({ borderColor: '--c' })).toBe('border-(--c)');
    });
});

describe('borders — border style', () => {
    it('{ borderStyle: "solid" } → border-solid', () => {
        expect(t({ borderStyle: 'solid' })).toBe('border-solid');
    });

    it('{ borderStyle: "dashed" } → border-dashed', () => {
        expect(t({ borderStyle: 'dashed' })).toBe('border-dashed');
    });

    it('{ borderStyle: "dotted" } → border-dotted', () => {
        expect(t({ borderStyle: 'dotted' })).toBe('border-dotted');
    });

    it('{ borderStyle: "double" } → border-double', () => {
        expect(t({ borderStyle: 'double' })).toBe('border-double');
    });

    it('{ borderStyle: "hidden" } → border-hidden', () => {
        expect(t({ borderStyle: 'hidden' })).toBe('border-hidden');
    });

    it('{ borderStyle: "none" } → border-none', () => {
        expect(t({ borderStyle: 'none' })).toBe('border-none');
    });
});

describe('borders — divide width', () => {
    it('{ divideX: true } → divide-x', () => {
        expect(t({ divideX: true })).toBe('divide-x');
    });

    it('{ divideX: 2 } → divide-x-2', () => {
        expect(t({ divideX: 2 })).toBe('divide-x-2');
    });

    it('{ divideXReverse: true } → divide-x-reverse', () => {
        expect(t({ divideXReverse: true })).toBe('divide-x-reverse');
    });

    it('{ divideY: true } → divide-y', () => {
        expect(t({ divideY: true })).toBe('divide-y');
    });

    it('{ divideY: 2 } → divide-y-2', () => {
        expect(t({ divideY: 2 })).toBe('divide-y-2');
    });

    it('{ divideYReverse: true } → divide-y-reverse', () => {
        expect(t({ divideYReverse: true })).toBe('divide-y-reverse');
    });

    it('{ divideX: "3px" } → divide-x-[3px] (arbitrary)', () => {
        expect(t({ divideX: '3px' })).toBe('divide-x-[3px]');
    });

    it('{ divideX: "--w" } → divide-x-(--w) (css variable)', () => {
        expect(t({ divideX: '--w' })).toBe('divide-x-(--w)');
    });
});

describe('borders — divide color', () => {
    it('{ divideColor: "red-500" } → divide-red-500', () => {
        expect(t({ divideColor: 'red-500' })).toBe('divide-red-500');
    });

    it('{ divideColor: { color: "red-500", op: 50 } } → divide-red-500/50', () => {
        expect(t({ divideColor: { color: 'red-500', op: 50 } })).toBe('divide-red-500/50');
    });

    it('{ divideColor: "#50d71e" } → divide-[#50d71e] (arbitrary)', () => {
        expect(t({ divideColor: '#50d71e' })).toBe('divide-[#50d71e]');
    });

    it('{ divideColor: "--c" } → divide-(--c) (css variable)', () => {
        expect(t({ divideColor: '--c' })).toBe('divide-(--c)');
    });
});

describe('borders — divide style', () => {
    it('{ divideStyle: "solid" } → divide-solid', () => {
        expect(t({ divideStyle: 'solid' })).toBe('divide-solid');
    });

    it('{ divideStyle: "dashed" } → divide-dashed', () => {
        expect(t({ divideStyle: 'dashed' })).toBe('divide-dashed');
    });

    it('{ divideStyle: "dotted" } → divide-dotted', () => {
        expect(t({ divideStyle: 'dotted' })).toBe('divide-dotted');
    });

    it('{ divideStyle: "double" } → divide-double', () => {
        expect(t({ divideStyle: 'double' })).toBe('divide-double');
    });

    it('{ divideStyle: "none" } → divide-none', () => {
        expect(t({ divideStyle: 'none' })).toBe('divide-none');
    });
});

describe('borders — outline width', () => {
    it('{ outline: 1 } → outline-1', () => {
        expect(t({ outline: 1 })).toBe('outline-1');
    });

    it('{ outline: "3px" } → outline-[3px] (arbitrary)', () => {
        expect(t({ outline: '3px' })).toBe('outline-[3px]');
    });

    it('{ outline: "--w" } → outline-(--w) (css variable)', () => {
        expect(t({ outline: '--w' })).toBe('outline-(--w)');
    });
});

describe('borders — outline color', () => {
    it('{ outlineColor: "red-500" } → outline-red-500', () => {
        expect(t({ outlineColor: 'red-500' })).toBe('outline-red-500');
    });

    it('{ outlineColor: "#50d71e" } → outline-[#50d71e] (arbitrary)', () => {
        expect(t({ outlineColor: '#50d71e' })).toBe('outline-[#50d71e]');
    });

    it('{ outlineColor: "--c" } → outline-(--c) (css variable)', () => {
        expect(t({ outlineColor: '--c' })).toBe('outline-(--c)');
    });
});

describe('borders — outline style', () => {
    it('{ outline: "none" } → outline-none', () => {
        expect(t({ outline: 'none' })).toBe('outline-none');
    });

    it('{ outlineStyle: "solid" } → outline-solid', () => {
        expect(t({ outlineStyle: 'solid' })).toBe('outline-solid');
    });

    it('{ outlineStyle: "dashed" } → outline-dashed', () => {
        expect(t({ outlineStyle: 'dashed' })).toBe('outline-dashed');
    });

    it('{ outlineStyle: "dotted" } → outline-dotted', () => {
        expect(t({ outlineStyle: 'dotted' })).toBe('outline-dotted');
    });

    it('{ outlineStyle: "double" } → outline-double', () => {
        expect(t({ outlineStyle: 'double' })).toBe('outline-double');
    });

    it('{ outlineStyle: "hidden" } → outline-hidden', () => {
        expect(t({ outlineStyle: 'hidden' })).toBe('outline-hidden');
    });
});

describe('borders — outline offset', () => {
    it('{ outlineOffset: 0 } → outline-offset-0', () => {
        expect(t({ outlineOffset: 0 })).toBe('outline-offset-0');
    });

    it('{ outlineOffset: "3px" } → outline-offset-[3px] (arbitrary)', () => {
        expect(t({ outlineOffset: '3px' })).toBe('outline-offset-[3px]');
    });

    it('{ outlineOffset: "--o" } → outline-offset-(--o) (css variable)', () => {
        expect(t({ outlineOffset: '--o' })).toBe('outline-offset-(--o)');
    });
});
