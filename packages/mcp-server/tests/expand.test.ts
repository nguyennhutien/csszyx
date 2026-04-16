import { describe, expect, it } from 'vitest';

import { handleExpand } from '../src/tools/expand';

describe('csszyx_expand', () => {
    it('expands basic props', () => {
        const data = JSON.parse(handleExpand({ sz: { p: 4, bg: 'blue-500' } }).content[0].text);
        expect(data.className).toContain('p-4');
        expect(data.className).toContain('bg-blue-500');
        expect(data.classCount).toBe(2);
    });

    it('expands hover variant', () => {
        const data = JSON.parse(handleExpand({ sz: { p: 4, hover: { bg: 'blue-700' } } }).content[0].text);
        expect(data.className).toContain('hover:bg-blue-700');
        expect(data.classCount).toBe(2);
    });

    it('expands responsive variant (sm, md, lg)', () => {
        const data = JSON.parse(handleExpand({ sz: { sm: { text: 'lg' }, lg: { text: '2xl' } } }).content[0].text);
        expect(data.className).toContain('sm:text-lg');
        expect(data.className).toContain('lg:text-2xl');
    });

    it('expands boolean shorthand', () => {
        const data = JSON.parse(handleExpand({ sz: { flex: true, items: 'center' } }).content[0].text);
        expect(data.className).toContain('flex');
        expect(data.className).toContain('items-center');
    });

    it('expands arbitrary value', () => {
        const data = JSON.parse(handleExpand({ sz: { w: '[123px]' } }).content[0].text);
        expect(data.className).toContain('w-[123px]');
    });

    it('expands css escape-hatch', () => {
        const data = JSON.parse(handleExpand({ sz: { css: { writingMode: 'vertical-lr' } } }).content[0].text);
        expect(data.className).toContain('[writing-mode:vertical-lr]');
    });

    it('returns empty className for empty object', () => {
        const data = JSON.parse(handleExpand({ sz: {} }).content[0].text);
        expect(data.className).toBe('');
        expect(data.classCount).toBe(0);
    });
});
