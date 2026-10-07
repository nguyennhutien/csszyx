/**
 * csszyx/browser — Standalone runtime for vanilla HTML pages.
 *
 * Bundled as IIFE (`dist/browser.iife.js`) and served via unpkg/jsdelivr CDN
 * so users can drop a single <script src="..."> tag and get sz-attribute
 * support without a bundler. Pairs with the csszyx VS Code extension which
 * provides authoring help (autocomplete, hover, syntax highlight) for the
 * same `sz="..."` attribute.
 *
 * Imports the browser-safe compiler entry (`@csszyx/compiler/browser`) which
 * skips the babel-dependent transformer pipeline and exposes only the pure
 * sz-object → className transform.
 *
 * Side-effect: on load, walks the DOM for `[sz]` elements, compiles each,
 * and installs a MutationObserver for elements added later. No exports —
 * intended for `<script>` tag use, not as an importable module.
 */

import { type SzObject, transform } from '@csszyx/compiler/browser';
import { parseSzAttribute } from './parse-sz-attribute.js';

declare global {
    /**
     *
     */
    interface Window {
        __SZ_MANGLE_MAP__?: Record<string, string>;
    }
}

/**
 * Compile one element's `sz` attribute into Tailwind class names and write
 * them onto its classList. Idempotent via the `data-sz-processed` flag, then
 * cleans both attributes off so the DOM matches what a build-time compile
 * would have produced.
 *
 * @param el Element with an `sz` attribute to process.
 */
function processElement(el: Element): void {
    const rawValue = el.getAttribute('sz');
    if (!rawValue) {
        return;
    }

    const dataset = (el as HTMLElement).dataset;
    if (dataset.szProcessed !== undefined) {
        return;
    }
    dataset.szProcessed = '';

    try {
        const parsed = parseSzAttribute(rawValue) as SzObject;
        const mangleMap = window.__SZ_MANGLE_MAP__;
        const { className } = transform(parsed, { mangleMap });

        if (className) {
            className.split(' ').forEach(c => {
                if (c) {
                    el.classList.add(c);
                }
            });
        }
    } catch (e) {
        // Fallback for a plain class list (`w-1/2 p-4`). A value with `:` is sz
        // written brace-less (`w: 1/2`, `bg: #fff`): read as classes it would
        // add `w:` and `1/2` and say nothing, so it is reported instead. This
        // also reports a class list with a variant and a stray character
        // (`hover:w-1/2`); one without (`hover:p-4`) parses as an sz object and
        // never reached the fallback anyway.
        if (rawValue.trim() && !/[{:]/.test(rawValue)) {
            rawValue.split(/\s+/).forEach(c => {
                if (c) {
                    el.classList.add(c);
                }
            });
        } else {
            console.error('[csszyx] Parsing error:', rawValue, e);
        }
    }

    el.removeAttribute('sz');
    delete dataset.szProcessed;
}

/**
 * Initial DOM walk on first load: process every `[sz]` element, then mark
 * the body `sz-ready` so the page's anti-FOUC CSS rule can reveal content.
 */
function init(): void {
    document.querySelectorAll('[sz]:not([data-sz-processed])').forEach(processElement);
    document.body.classList.add('sz-ready');
}

/**
 * Process an element AND its descendants. Used by the MutationObserver
 * callback so an inserted subtree's sz attributes are all picked up in one
 * dispatch (the observer only reports the inserted root, not each child).
 *
 * @param root Root element of the inserted subtree.
 */
function processSubtree(root: HTMLElement): void {
    if (root.hasAttribute('sz')) {
        processElement(root);
    }
    root.querySelectorAll('[sz]:not([data-sz-processed])').forEach(processElement);
}

const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
                processSubtree(node);
            }
        }
    }
});

if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => {
            init();
            observer.observe(document.body, { childList: true, subtree: true });
        });
    } else {
        init();
        observer.observe(document.body, { childList: true, subtree: true });
    }
}
