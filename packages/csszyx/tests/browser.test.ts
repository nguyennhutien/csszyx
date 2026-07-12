// @vitest-environment jsdom
/**
 * The standalone CDN runtime has no exports (it is a `<script>`-tag IIFE), so
 * it is exercised through its load-time side effect: importing the module walks
 * the current DOM, compiles every `[sz]` element, and installs a
 * MutationObserver for later insertions. Each test resets the module registry
 * so a fresh import re-runs that walk against the DOM it just set up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// transform is fail-safe and never throws for real input, so the runtime's
// graceful-degradation path is unreachable without help. Wrap the real
// transform and let one test flip it to throwing; every other test runs the
// genuine compile.
const control = vi.hoisted(() => ({ throwOnTransform: false }));
vi.mock('@csszyx/compiler/browser', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler/browser')>();
    return {
        ...actual,
        transform: (...args: Parameters<typeof actual.transform>) => {
            if (control.throwOnTransform) {
                throw new Error('compile boom');
            }
            return actual.transform(...args);
        },
    };
});

async function loadRuntime(): Promise<void> {
    await import('../src/browser.js');
}

beforeEach(() => {
    vi.resetModules();
    control.throwOnTransform = false;
    document.body.innerHTML = '';
    document.body.className = '';
    window.__SZ_MANGLE_MAP__ = undefined;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('csszyx/browser standalone runtime', () => {
    it('compiles object and brace-less sz attributes and marks the body ready', async () => {
        document.body.innerHTML =
            '<div id="a" sz="{p: 4}"></div><span id="b" sz="color: \'red-500\'"></span>';
        await loadRuntime();

        const a = document.getElementById('a');
        const b = document.getElementById('b');
        expect(a?.className).toContain('p-4');
        // Brace-less input is auto-wrapped before parsing.
        expect(b?.className).toContain('text-red-500');
        // Processed attributes are cleaned off so the DOM matches a build compile.
        expect(a?.hasAttribute('sz')).toBe(false);
        expect(a?.hasAttribute('data-sz-processed')).toBe(false);
        expect(document.body.classList.contains('sz-ready')).toBe(true);
    });

    it('parses strings, numbers, booleans, null, arrays, nested objects and bracket keys', async () => {
        document.body.innerHTML =
            `<div id="v" sz="{p: 4, on: true, off: false, gap: null, ` +
            `list: [1, 'two', 3], hover: {m: 2}, [&>span]: {p: 1}}"></div>`;
        await loadRuntime();

        const v = document.getElementById('v');
        // The CSP-safe parser handled every value shape without throwing, and
        // the element was compiled and cleaned.
        expect(v?.hasAttribute('sz')).toBe(false);
        expect(v?.className.length ?? 0).toBeGreaterThan(0);
    });

    it('leaves an element without an sz value untouched', async () => {
        document.body.innerHTML = '<div id="n"></div><div id="e" sz=""></div>';
        await loadRuntime();
        expect(document.getElementById('n')?.className).toBe('');
        expect(document.getElementById('e')?.className).toBe('');
    });

    it('routes class names through a window mangle map when present', async () => {
        window.__SZ_MANGLE_MAP__ = { 'p-4': 'zq' };
        document.body.innerHTML = '<div id="m" sz="{p: 4}"></div>';
        await loadRuntime();
        expect(document.getElementById('m')?.className).toContain('zq');
    });

    it('compiles elements inserted after load through the MutationObserver', async () => {
        await loadRuntime();

        const wrapper = document.createElement('section');
        wrapper.innerHTML = '<div class="child" sz="{m: 2}"></div>';
        wrapper.setAttribute('sz', '{p: 1}');
        document.body.appendChild(wrapper);
        // The observer callback runs on a microtask after the mutation.
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(wrapper.className).toContain('p-1');
        expect(wrapper.querySelector('.child')?.className).toContain('m-2');
        expect(wrapper.hasAttribute('sz')).toBe(false);
    });

    it('falls back to raw classes on a compile failure, and logs an object one', async () => {
        // Brace-less values degrade to plain Tailwind classes; an object-shaped
        // one is logged rather than silently dropped.
        control.throwOnTransform = true;
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        document.body.innerHTML =
            '<div id="plain" sz="flex gap-2"></div><div id="obj" sz="{p: 4}"></div>';
        await loadRuntime();

        const plain = document.getElementById('plain');
        expect(plain?.className).toContain('flex');
        expect(plain?.className).toContain('gap-2');
        expect(errorLog).toHaveBeenCalled();
    });

    it('defers the initial walk to DOMContentLoaded while the document is loading', async () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
        await loadRuntime();
        document.body.innerHTML = '<div id="late" sz="{p: 4}"></div>';
        window.dispatchEvent(new Event('DOMContentLoaded'));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(document.getElementById('late')?.className).toContain('p-4');
    });
});

describe('parser character edges', () => {
    it('handles escaped characters inside quoted strings and quoted keys', async () => {
        document.body.innerHTML = `<div id="esc" sz="{'bg': 'red-500', title: 'it\\\\'s'}"></div>`;
        await loadRuntime();
        const esc = document.getElementById('esc');
        expect(esc?.hasAttribute('sz')).toBe(false);
        expect(esc?.className).toContain('bg-red-500');
    });

    it('skips an element already marked as processed', async () => {
        document.body.innerHTML = '<div id="done" sz="{p: 4}" data-sz-processed></div>';
        await loadRuntime();
        // The guard leaves the marked element untouched.
        expect(document.getElementById('done')?.className).toBe('');
    });
});
