import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform-core.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

describe('spacing — padding', () => {
    it('{ p: 4 } → p-4', () => {
        expect(t({ p: 4 })).toBe('p-4');
    });

    it('{ px: 2 } → px-2', () => {
        expect(t({ px: 2 })).toBe('px-2');
    });

    it('{ py: 8 } → py-8', () => {
        expect(t({ py: 8 })).toBe('py-8');
    });

    it('{ pt: 1 } → pt-1', () => {
        expect(t({ pt: 1 })).toBe('pt-1');
    });

    it('{ pr: 2 } → pr-2', () => {
        expect(t({ pr: 2 })).toBe('pr-2');
    });

    it('{ pb: 3 } → pb-3', () => {
        expect(t({ pb: 3 })).toBe('pb-3');
    });

    it('{ pl: 4 } → pl-4', () => {
        expect(t({ pl: 4 })).toBe('pl-4');
    });

    it('{ ps: 5 } → ps-5 (logical start)', () => {
        expect(t({ ps: 5 })).toBe('ps-5');
    });

    it('{ pe: 6 } → pe-6 (logical end)', () => {
        expect(t({ pe: 6 })).toBe('pe-6');
    });

    it('{ pbs: 7 } → pbs-7 (block start)', () => {
        expect(t({ pbs: 7 })).toBe('pbs-7');
    });

    it('{ pbe: 8 } → pbe-8 (block end)', () => {
        expect(t({ pbe: 8 })).toBe('pbe-8');
    });

    it('{ p: "px" } → p-px', () => {
        expect(t({ p: 'px' })).toBe('p-px');
    });

    it('{ p: "5px" } → p-[5px] (arbitrary)', () => {
        expect(t({ p: '5px' })).toBe('p-[5px]');
    });

    it('{ p: "--p" } → p-(--p) (css variable)', () => {
        expect(t({ p: '--p' })).toBe('p-(--p)');
    });
});

describe('spacing — margin', () => {
    it('{ m: 4 } → m-4', () => {
        expect(t({ m: 4 })).toBe('m-4');
    });

    it('{ mx: 2 } → mx-2', () => {
        expect(t({ mx: 2 })).toBe('mx-2');
    });

    it('{ my: 8 } → my-8', () => {
        expect(t({ my: 8 })).toBe('my-8');
    });

    it('{ mt: 1 } → mt-1', () => {
        expect(t({ mt: 1 })).toBe('mt-1');
    });

    it('{ mr: 2 } → mr-2', () => {
        expect(t({ mr: 2 })).toBe('mr-2');
    });

    it('{ mb: 3 } → mb-3', () => {
        expect(t({ mb: 3 })).toBe('mb-3');
    });

    it('{ ml: 4 } → ml-4', () => {
        expect(t({ ml: 4 })).toBe('ml-4');
    });

    it('{ ms: 5 } → ms-5 (logical start)', () => {
        expect(t({ ms: 5 })).toBe('ms-5');
    });

    it('{ me: 6 } → me-6 (logical end)', () => {
        expect(t({ me: 6 })).toBe('me-6');
    });

    it('{ mbs: 7 } → mbs-7 (block start)', () => {
        expect(t({ mbs: 7 })).toBe('mbs-7');
    });

    it('{ mbe: 8 } → mbe-8 (block end)', () => {
        expect(t({ mbe: 8 })).toBe('mbe-8');
    });

    it('{ m: -4 } → -m-4 (negative)', () => {
        expect(t({ m: -4 })).toBe('-m-4');
    });

    it('{ mt: -2 } → -mt-2 (negative)', () => {
        expect(t({ mt: -2 })).toBe('-mt-2');
    });

    it('{ m: "px" } → m-px', () => {
        expect(t({ m: 'px' })).toBe('m-px');
    });

    it('{ m: "-px" } → -m-px (negative string)', () => {
        expect(t({ m: '-px' })).toBe('-m-px');
    });

    it('{ m: "auto" } → m-auto', () => {
        expect(t({ m: 'auto' })).toBe('m-auto');
    });

    it('{ m: "5px" } → m-[5px] (arbitrary)', () => {
        expect(t({ m: '5px' })).toBe('m-[5px]');
    });

    it('{ m: "--m" } → m-(--m) (css variable)', () => {
        expect(t({ m: '--m' })).toBe('m-(--m)');
    });
});

describe('spacing — space between', () => {
    it('{ spaceX: 4 } → space-x-4', () => {
        expect(t({ spaceX: 4 })).toBe('space-x-4');
    });

    it('{ spaceY: 2 } → space-y-2', () => {
        expect(t({ spaceY: 2 })).toBe('space-y-2');
    });

    it('{ spaceXReverse: true } → space-x-reverse', () => {
        expect(t({ spaceXReverse: true })).toBe('space-x-reverse');
    });

    it('{ spaceYReverse: true } → space-y-reverse', () => {
        expect(t({ spaceYReverse: true })).toBe('space-y-reverse');
    });

    it('{ spaceX: -4 } → -space-x-4 (negative)', () => {
        expect(t({ spaceX: -4 })).toBe('-space-x-4');
    });

    it('{ spaceY: -2 } → -space-y-2 (negative)', () => {
        expect(t({ spaceY: -2 })).toBe('-space-y-2');
    });

    it('{ spaceX: "px" } → space-x-px', () => {
        expect(t({ spaceX: 'px' })).toBe('space-x-px');
    });

    it('{ spaceY: "px" } → space-y-px', () => {
        expect(t({ spaceY: 'px' })).toBe('space-y-px');
    });

    it('{ spaceX: "5px" } → space-x-[5px] (arbitrary)', () => {
        expect(t({ spaceX: '5px' })).toBe('space-x-[5px]');
    });

    it('{ spaceX: "--space" } → space-x-(--space) (css variable)', () => {
        expect(t({ spaceX: '--space' })).toBe('space-x-(--space)');
    });
});
