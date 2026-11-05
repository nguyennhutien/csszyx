import { act, createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applySzVars, patchSzVars } from '../src/index.js';
import { useSzVars } from '../src/react.js';

// React 19 act() requires this flag to be set in a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
    document.documentElement.removeAttribute('style');
});

describe('applySzVars', () => {
    it('applies vars, auto-prefixing keys and stringifying values', () => {
        const el = document.createElement('div');
        applySzVars({ 'form-bg': '#fff', 'form-p': 24 }, el);
        expect(el.style.getPropertyValue('--form-bg')).toBe('#fff');
        expect(el.style.getPropertyValue('--form-p')).toBe('24');
    });

    it('leaves an already-prefixed key untouched (no double prefix)', () => {
        const el = document.createElement('div');
        applySzVars({ '--ready': 'x' }, el);
        expect(el.style.getPropertyValue('--ready')).toBe('x');
        expect(el.style.getPropertyValue('----ready')).toBe('');
    });

    it('defaults the target to document.documentElement', () => {
        applySzVars({ root: '1' });
        expect(document.documentElement.style.getPropertyValue('--root')).toBe('1');
    });

    it('cleanup removes exactly the applied properties and nothing else', () => {
        const el = document.createElement('div');
        el.style.setProperty('--keep', 'me');
        const cleanup = applySzVars({ a: '1', b: '2' }, el);
        cleanup();
        expect(el.style.getPropertyValue('--a')).toBe('');
        expect(el.style.getPropertyValue('--b')).toBe('');
        expect(el.style.getPropertyValue('--keep')).toBe('me');
    });
});

describe('patchSzVars', () => {
    it('sets prefixed properties on the target', () => {
        const el = document.createElement('div');
        patchSzVars({ x: 1, '--y': 2 }, el);
        expect(el.style.getPropertyValue('--x')).toBe('1');
        expect(el.style.getPropertyValue('--y')).toBe('2');
    });

    it('defaults the target to document.documentElement', () => {
        patchSzVars({ z: 'zz' });
        expect(document.documentElement.style.getPropertyValue('--z')).toBe('zz');
    });
});

/**
 * Sets vars on `:root`, no ref given.
 *
 * @returns Nothing to render.
 */
function RootProbe() {
    useSzVars({ hook: 'ran' });
    return null;
}

/**
 * Sets vars on `:root`, for the document that has none yet.
 *
 * @returns Nothing to render.
 */
function DetachedProbe() {
    useSzVars({ detached: 'value' });
    return null;
}

/**
 * Sets vars on its own element.
 *
 * @param props - The value of `--pad`.
 * @param props.pad - The value.
 * @returns The element.
 */
function RefProbe({ pad }: { pad: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useSzVars({ pad }, ref);
    return createElement('div', { ref });
}

describe('useSzVars', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('applies vars to :root when no ref is passed', () => {
        act(() => root.render(createElement(RootProbe)));
        expect(document.documentElement.style.getPropertyValue('--hook')).toBe('ran');
    });

    it('waits for a target when the document has no root element', () => {
        const html = document.documentElement;
        const missingRoot = vi
            .spyOn(document, 'documentElement', 'get')
            .mockReturnValue(null as unknown as HTMLElement);
        try {
            act(() => root.render(createElement(DetachedProbe)));
            expect(html.style.getPropertyValue('--detached')).toBe('');
        } finally {
            missingRoot.mockRestore();
        }
        act(() => root.render(createElement(DetachedProbe)));
        expect(html.style.getPropertyValue('--detached')).toBe('value');
    });

    it('applies vars to the ref element and re-applies when they change', () => {
        act(() => root.render(createElement(RefProbe, { pad: '4' })));
        const div = container.querySelector('div');
        expect(div?.style.getPropertyValue('--pad')).toBe('4');
        act(() => root.render(createElement(RefProbe, { pad: '8' })));
        expect(div?.style.getPropertyValue('--pad')).toBe('8');
    });
});
