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

declare global {
    /**
     *
     */
    interface Window {
        __SZ_MANGLE_MAP__?: Record<string, string>;
    }
}

/**
 * Safe JS object literal parser for sz attributes. Handles single-quoted
 * strings, unquoted keys, numbers, booleans, nested objects, and arbitrary
 * variant keys like `[&>span]`. Does NOT use eval/new Function — the runtime
 * has to be CSP-safe so it can ship through unpkg/jsdelivr to pages with
 * strict-CSP headers.
 *
 * Auto-wraps input in `{}` if missing, so both `"p: 4"` and `"{p: 4}"` parse.
 *
 * @param rawInput Raw `sz` attribute value as written in HTML.
 * @returns Parsed object representation suitable for the sz transform.
 */
function parseSzAttribute(rawInput: string): Record<string, unknown> {
    const trimmed = rawInput.trim();
    const input = trimmed.startsWith('{') ? trimmed : `{${trimmed}}`;
    let pos = 0;

    const skipWhitespace = (): void => {
        while (pos < input.length && /\s/.test(input[pos])) {
            pos++;
        }
    };

    const parseString = (quote: string): string => {
        pos++; // skip opening quote
        let result = '';
        while (pos < input.length && input[pos] !== quote) {
            if (input[pos] === '\\') {
                pos++;
                if (pos < input.length) {
                    result += input[pos];
                }
            } else {
                result += input[pos];
            }
            pos++;
        }
        pos++; // skip closing quote
        return result;
    };

    const parseKey = (): string => {
        skipWhitespace();
        if (input[pos] === "'" || input[pos] === '"') {
            return parseString(input[pos]);
        }
        let key = '';
        if (input[pos] === '[') {
            // Arbitrary variant key like [&>span] — track bracket depth.
            let depth = 0;
            while (pos < input.length) {
                if (input[pos] === '[') {
                    depth++;
                }
                if (input[pos] === ']') {
                    depth--;
                }
                key += input[pos];
                pos++;
                if (depth === 0) {
                    break;
                }
            }
            return key;
        }
        while (pos < input.length && /[\w$@\-.]/.test(input[pos])) {
            key += input[pos];
            pos++;
        }
        return key;
    };

    const parseValue = (): unknown => {
        skipWhitespace();
        const ch = input[pos];

        if (ch === "'" || ch === '"') {
            return parseString(ch);
        }
        if (ch === '{') {
            return parseObject();
        }
        if (ch === '[') {
            return parseArray();
        }

        let token = '';
        while (pos < input.length && /[\w.\-+]/.test(input[pos])) {
            token += input[pos];
            pos++;
        }

        if (token === 'true') {
            return true;
        }
        if (token === 'false') {
            return false;
        }
        if (token === 'null') {
            return null;
        }

        const num = Number(token);
        if (!Number.isNaN(num) && token !== '') {
            return num;
        }

        return token;
    };

    const parseArray = (): unknown[] => {
        pos++; // skip [
        const arr: unknown[] = [];
        skipWhitespace();
        while (pos < input.length && input[pos] !== ']') {
            arr.push(parseValue());
            skipWhitespace();
            if (input[pos] === ',') {
                pos++;
            }
            skipWhitespace();
        }
        pos++; // skip ]
        return arr;
    };

    const parseObject = (): Record<string, unknown> => {
        pos++; // skip {
        const obj: Record<string, unknown> = {};

        skipWhitespace();
        while (pos < input.length && input[pos] !== '}') {
            const key = parseKey();
            skipWhitespace();
            if (input[pos] === ':') {
                pos++;
            } // skip :
            const value = parseValue();
            obj[key] = value;
            skipWhitespace();
            if (input[pos] === ',') {
                pos++;
            }
            skipWhitespace();
        }
        pos++; // skip }

        return obj;
    };

    skipWhitespace();
    return parseObject();
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

    if (el.hasAttribute('data-sz-processed')) {
        return;
    }
    el.setAttribute('data-sz-processed', '');

    try {
        const parsed = parseSzAttribute(rawValue) as SzObject;
        const mangleMap = window.__SZ_MANGLE_MAP__;
        const { className } = transform(parsed, '', mangleMap);

        if (className) {
            className.split(' ').forEach(c => {
                if (c) {
                    el.classList.add(c);
                }
            });
        }
    } catch (e) {
        // Fallback: treat raw value as plain Tailwind class string when not object-shaped.
        if (rawValue.trim() && !rawValue.includes('{')) {
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
    el.removeAttribute('data-sz-processed');
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
