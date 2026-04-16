/**
 * Tests for the CSSOM injector module.
 * Uses a simulated CSSStyleSheet environment.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, injectRule, isInjected, resolveTier, TIER_ORDER } from '../src/injector.js';

// ── Mock constructable stylesheets ────────────────────────────────────────────

/**
 *
 */
class MockCSSStyleSheet {
    cssRules: Array<{ cssText: string }> = [];
    /**
     * @param text - CSS rule text to insert
     * @param index - position in cssRules at which to insert the rule
     */
    insertRule(text: string, index: number): void {
        this.cssRules.splice(index, 0, { cssText: text });
    }
}

// Track the current value of adoptedStyleSheets via the mock document object.
// The injector does `document.adoptedStyleSheets = [...]` (assignment), so we
// must use a getter/setter to capture that and update mockAdoptedSheets in place.
let _adoptedSheets: MockCSSStyleSheet[] = [];
const mockAdoptedSheets: MockCSSStyleSheet[] = [];

const mockDocument = {
    get adoptedStyleSheets() { return _adoptedSheets; },
    set adoptedStyleSheets(val: MockCSSStyleSheet[]) {
        _adoptedSheets = val;
        // Keep mockAdoptedSheets in sync so tests can reference it
        mockAdoptedSheets.length = 0;
        mockAdoptedSheets.push(...val);
    },
    head: { appendChild: vi.fn() },
    createElement: vi.fn(() => ({
        id: '',
        remove: vi.fn(),
        sheet: { insertRule: vi.fn(), cssRules: [] },
    })),
};

beforeEach(() => {
    _adoptedSheets = [];
    mockAdoptedSheets.length = 0;

    vi.stubGlobal('CSSStyleSheet', MockCSSStyleSheet);
    vi.stubGlobal('document', mockDocument);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

// ── resolveTier ───────────────────────────────────────────────────────────────

describe('resolveTier', () => {
    it('returns base for non-breakpoint class', () => {
        expect(resolveTier('p-4')).toBe('base');
        expect(resolveTier('bg-blue-500')).toBe('base');
        expect(resolveTier('flex')).toBe('base');
    });

    it('returns base for hover variant (not a breakpoint)', () => {
        expect(resolveTier('hover:bg-blue-500')).toBe('base');
    });

    it('returns base for dark variant', () => {
        expect(resolveTier('dark:bg-gray-900')).toBe('base');
    });

    it('returns sm for sm:p-4', () => {
        expect(resolveTier('sm:p-4')).toBe('sm');
    });

    it('returns lg for lg:p-8', () => {
        expect(resolveTier('lg:p-8')).toBe('lg');
    });

    it('returns max-sm for max-sm:p-4', () => {
        expect(resolveTier('max-sm:p-4')).toBe('max-sm');
    });

    it('returns first breakpoint segment for stacked sm:hover:', () => {
        expect(resolveTier('sm:hover:bg-blue-600')).toBe('sm');
    });
});

// ── TIER_ORDER ────────────────────────────────────────────────────────────────

describe('TIER_ORDER cascade ordering', () => {
    it('has 21 tiers', () => {
        expect(TIER_ORDER).toHaveLength(21);
    });

    it('base is first (index 0)', () => {
        expect(TIER_ORDER[0]).toBe('base');
    });

    it('sm comes before md comes before lg (ascending min-width)', () => {
        const smIdx = TIER_ORDER.indexOf('sm');
        const mdIdx = TIER_ORDER.indexOf('md');
        const lgIdx = TIER_ORDER.indexOf('lg');
        expect(smIdx).toBeLessThan(mdIdx);
        expect(mdIdx).toBeLessThan(lgIdx);
    });

    it('max-2xl comes before max-sm (descending for max-width)', () => {
        // max-sm must have HIGHER index (later in array = wins at small viewport)
        const max2xlIdx = TIER_ORDER.indexOf('max-2xl');
        const maxSmIdx = TIER_ORDER.indexOf('max-sm');
        expect(max2xlIdx).toBeLessThan(maxSmIdx);
    });

    it('container @sm before @md before @lg', () => {
        const smIdx = TIER_ORDER.indexOf('@sm');
        const mdIdx = TIER_ORDER.indexOf('@md');
        const lgIdx = TIER_ORDER.indexOf('@lg');
        expect(smIdx).toBeLessThan(mdIdx);
        expect(mdIdx).toBeLessThan(lgIdx);
    });

    it('@max-2xl comes before @max-sm', () => {
        const max2xlIdx = TIER_ORDER.indexOf('@max-2xl');
        const maxSmIdx = TIER_ORDER.indexOf('@max-sm');
        expect(max2xlIdx).toBeLessThan(maxSmIdx);
    });
});

// ── injectRule ────────────────────────────────────────────────────────────────

describe('injectRule', () => {
    it('initializes 21 adopted stylesheets on first inject', () => {
        injectRule('p-4', '.p-4 { padding: calc(var(--spacing) * 4) }', 'base');
        expect(mockAdoptedSheets).toHaveLength(21);
    });

    it('injects rule into correct sheet by tier', () => {
        injectRule('p-4', '.p-4 { padding: 1rem }', 'base');
        injectRule('sm:p-4', '.sm\\:p-4 { padding: 1rem }', 'sm');

        // Base sheet is index 0, sm sheet is index 1
        const baseSheet = mockAdoptedSheets[0] as unknown as MockCSSStyleSheet;
        const smSheet = mockAdoptedSheets[1] as unknown as MockCSSStyleSheet;

        expect(baseSheet.cssRules.some(r => r.cssText.includes('.p-4'))).toBe(true);
        expect(smSheet.cssRules.length).toBeGreaterThan(0);
    });

    it('wraps non-base tier rules in @media', () => {
        injectRule('sm:p-4', '.sm\\:p-4 { padding: 1rem }', 'sm');

        const smSheet = mockAdoptedSheets[1] as unknown as MockCSSStyleSheet;
        const rule = smSheet.cssRules[0];
        expect(rule.cssText).toContain('@media');
        expect(rule.cssText).toContain('40rem');
    });

    it('wraps max-sm tier in max-width media query', () => {
        injectRule('max-sm:p-4', '.max-sm\\:p-4 { padding: 1rem }', 'max-sm');

        const maxSmIdx = TIER_ORDER.indexOf('max-sm');
        const maxSmSheet = mockAdoptedSheets[maxSmIdx] as unknown as MockCSSStyleSheet;
        expect(maxSmSheet.cssRules[0].cssText).toContain('max-width');
    });

    it('does not double-inject same class', () => {
        injectRule('p-4', '.p-4 { padding: 1rem }', 'base');
        injectRule('p-4', '.p-4 { padding: 1rem }', 'base'); // duplicate

        const baseSheet = mockAdoptedSheets[0] as unknown as MockCSSStyleSheet;
        const p4Rules = baseSheet.cssRules.filter(r => r.cssText.includes('.p-4'));
        expect(p4Rules).toHaveLength(1);
    });

    it('isInjected returns true after inject', () => {
        expect(isInjected('p-4')).toBe(false);
        injectRule('p-4', '.p-4 { padding: 1rem }', 'base');
        expect(isInjected('p-4')).toBe(true);
    });

    it('marks class as injected even when cssRule is empty (unknown class)', () => {
        injectRule('unknown-class', '', 'base');
        expect(isInjected('unknown-class')).toBe(true);
    });
});

// ── cleanup ───────────────────────────────────────────────────────────────────

describe('cleanup', () => {
    it('removes all csszyx sheets from adoptedStyleSheets', () => {
        injectRule('p-4', '.p-4 { padding: 1rem }', 'base');
        expect(mockAdoptedSheets).toHaveLength(21);

        cleanup();
        expect(mockAdoptedSheets).toHaveLength(0);
    });

    it('clears injected cache', () => {
        injectRule('p-4', '.p-4 { padding: 1rem }', 'base');
        expect(isInjected('p-4')).toBe(true);

        cleanup();
        expect(isInjected('p-4')).toBe(false);
    });

    it('allows re-injection after cleanup', () => {
        injectRule('p-4', '.p-4 { padding: 1rem }', 'base');
        cleanup();

        // Re-init happens on next inject
        injectRule('p-4', '.p-4 { padding: 1rem }', 'base');
        expect(isInjected('p-4')).toBe(true);
        expect(mockAdoptedSheets).toHaveLength(21);
    });
});
