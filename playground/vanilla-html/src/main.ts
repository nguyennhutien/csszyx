import { transform, type SzObject } from '../../../packages/compiler/src/transform-core';

declare global {
    interface Window {
        __SZ_MANGLE_MAP__?: Record<string, string>;
    }
}

/**
 * Safe JS object literal parser for sz attributes.
 * Handles: single-quoted strings, unquoted keys, numbers, booleans,
 * nested objects. Does NOT use eval/new Function.
 *
 * Supports the subset of JS object syntax used in sz attributes:
 *   { key: 'value', nested: { a: true, b: 42 } }
 */
function parseSzAttribute(rawInput: string): Record<string, unknown> {
    // Auto-wrap: outer braces are optional — "p: 4, bg: 'blue'" is as valid as "{p: 4, bg: 'blue'}"
    const trimmed = rawInput.trim();
    let input = trimmed.startsWith('{') ? trimmed : `{${trimmed}}`;
    let pos = 0;

    function skipWhitespace() {
        while (pos < input.length && /\s/.test(input[pos])) pos++;
    }

    function parseString(quote: string): string {
        pos++; // skip opening quote
        let result = '';
        while (pos < input.length && input[pos] !== quote) {
            if (input[pos] === '\\') {
                pos++;
                if (pos < input.length) result += input[pos];
            } else {
                result += input[pos];
            }
            pos++;
        }
        pos++; // skip closing quote
        return result;
    }

    function parseKey(): string {
        skipWhitespace();
        if (input[pos] === "'" || input[pos] === '"') {
            return parseString(input[pos]);
        }
        // Unquoted key: [a-zA-Z_$@\-][a-zA-Z0-9_$@\-.]* or starts with [ for arbitrary
        let key = '';
        if (input[pos] === '[') {
            // Arbitrary variant key like [&>span]
            let depth = 0;
            while (pos < input.length) {
                if (input[pos] === '[') depth++;
                if (input[pos] === ']') depth--;
                key += input[pos];
                pos++;
                if (depth === 0) break;
            }
            return key;
        }
        while (pos < input.length && /[a-zA-Z0-9_$@\-.]/.test(input[pos])) {
            key += input[pos];
            pos++;
        }
        return key;
    }

    function parseValue(): unknown {
        skipWhitespace();
        const ch = input[pos];

        // String
        if (ch === "'" || ch === '"') {
            return parseString(ch);
        }

        // Nested object
        if (ch === '{') {
            return parseObject();
        }

        // Array (basic support)
        if (ch === '[') {
            return parseArray();
        }

        // Number, boolean, or unquoted keyword
        let token = '';
        while (pos < input.length && /[a-zA-Z0-9_.\-+]/.test(input[pos])) {
            token += input[pos];
            pos++;
        }

        if (token === 'true') return true;
        if (token === 'false') return false;
        if (token === 'null') return null;

        const num = Number(token);
        if (!isNaN(num) && token !== '') return num;

        return token;
    }

    function parseArray(): unknown[] {
        pos++; // skip [
        const arr: unknown[] = [];
        skipWhitespace();
        while (pos < input.length && input[pos] !== ']') {
            arr.push(parseValue());
            skipWhitespace();
            if (input[pos] === ',') pos++;
            skipWhitespace();
        }
        pos++; // skip ]
        return arr;
    }

    function parseObject(): Record<string, unknown> {
        pos++; // skip {
        const obj: Record<string, unknown> = {};

        skipWhitespace();
        while (pos < input.length && input[pos] !== '}') {
            const key = parseKey();
            skipWhitespace();
            if (input[pos] === ':') pos++; // skip :
            const value = parseValue();
            obj[key] = value;
            skipWhitespace();
            if (input[pos] === ',') pos++;
            skipWhitespace();
        }
        pos++; // skip }

        return obj;
    }

    skipWhitespace();
    return parseObject();
}

/**
 * Process a single element with sz attribute.
 */
function processElement(el: Element) {
    const rawValue = el.getAttribute('sz');
    if (!rawValue) return;

    // Skip already-processed elements
    if (el.hasAttribute('data-sz-processed')) return;
    el.setAttribute('data-sz-processed', '');

    try {
        const parsed = parseSzAttribute(rawValue) as SzObject;
        const mangleMap = window.__SZ_MANGLE_MAP__;
        const { className } = transform(parsed, '', mangleMap);

        if (className) {
            className.split(' ').forEach(c => {
                if (c) el.classList.add(c);
            });
        }
    } catch (e) {
        // Fallback for plain Tailwind class strings
        if (rawValue.trim() && !rawValue.includes('{')) {
            rawValue.split(/\s+/).forEach(c => {
                if (c) el.classList.add(c);
            });
        } else {
            console.error('[csszyx] Parsing error:', rawValue, e);
        }
    }

    // Clean up: remove sz attribute after compilation
    el.removeAttribute('sz');
    el.removeAttribute('data-sz-processed');
}

/**
 * Process all unprocessed [sz] elements in the document.
 */
function init() {
    document.querySelectorAll('[sz]:not([data-sz-processed])').forEach(processElement);
    document.body.classList.add('sz-ready');
}

/**
 * Process a subtree (element + its descendants) for sz attributes.
 */
function processSubtree(root: HTMLElement) {
    if (root.hasAttribute('sz')) {
        processElement(root);
    }
    root.querySelectorAll('[sz]:not([data-sz-processed])').forEach(processElement);
}

// Observe DOM for dynamically added elements
const observer = new MutationObserver((mutations) => {
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
