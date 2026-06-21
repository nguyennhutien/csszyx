/**
 * Purify an UNTRUSTED sz object before it reaches the runtime CSS pipeline.
 *
 * csszyx's `dynamic()` / `useSz` accept sz objects that an app may build from
 * untrusted data (a JSON-driven UI, a CMS schema). Such input controls both the
 * KEYS and the VALUES of the object, which opens three holes the rest of the
 * stack only partially closes: an unknown key produces dead CSS or, via a key
 * like `__proto__`, pollutes the prototype; an unsafe value injects an extra CSS
 * declaration (UI redress / exfil) into the same rule; deep nesting overflows
 * the stack. `purifySz` is the opt-in boundary that drops all three.
 *
 * It is allowlist-based: only keys the compiler actually understands
 * (`SZ_KEY_CATEGORY`, generated from the compiler tables) and valid variant keys
 * survive; every string value must pass {@link isSafeCssValue}; forbidden keys
 * are skipped; depth is bounded by the shared `MAX_SZ_DEPTH`. In `strict` mode
 * (default) it additionally drops values carrying `url()` / `image-set()` /
 * `@import` / `expression()` — vectors the authored-path emitter intentionally
 * allows but which are exfil/legacy risks for untrusted input.
 *
 * Pure, framework-agnostic. Compiled/authored sz does NOT need this — it is for
 * the untrusted runtime boundary only.
 */
import {
    getVariantPrefix,
    KNOWN_VARIANTS,
    MAX_SZ_DEPTH,
    SPECIAL_VARIANTS,
    SzDepthError,
    isForbiddenSzKey,
    type SzObject,
    type SzValue,
} from '@csszyx/compiler/browser';
import { isSafeCssValue } from './css-sanitize.js';
import { SZ_KEY_CATEGORY } from './sz-allowlist.generated.js';

/** Values that are exfil/legacy risks for untrusted input (stripped in strict mode). */
const DANGEROUS_VALUE_RE = /url\s*\(|image-set\s*\(|@import|expression\s*\(/i;

export interface PurifySzOptions {
    /**
     * When true (default), also reject values containing `url()`/`image-set()`/
     * `@import`/`expression()`. These are legitimate for AUTHORED sz but are
     * exfiltration / legacy vectors when the value is attacker-controlled.
     */
    strict?: boolean;
    /** Called for each dropped key/value with its dotted path and a reason. */
    onDrop?: (path: string, reason: string) => void;
}

/**
 * Whether `key` is a valid variant key (a nested-object selector like `hover`,
 * `md`, `dark`, `@container`, `group-hover`, `aria-[…]`, `[&>*]`). Reuses the
 * compiler's own variant tables so the grammar never drifts.
 */
function isVariantKey(key: string): boolean {
    if (KNOWN_VARIANTS.has(key) || KNOWN_VARIANTS.has(getVariantPrefix(key))) {
        return true;
    }
    if (SPECIAL_VARIANTS.has(key) || SPECIAL_VARIANTS.has(getVariantPrefix(key))) {
        return true;
    }
    // Arbitrary variants: @container/@max-[…], [&:hover]/[&>*], functional
    // variants with an arbitrary param, and group-/peer- compositions.
    if (key.startsWith('@')) return true;
    if (key.startsWith('[') && key.endsWith(']')) return true;
    if (/^(?:group|peer)-/.test(key)) return true;
    if (/^[a-z][a-z-]*-\[.*\]$/.test(key)) return true; // min-[…], aria-[…], data-[…]
    return false;
}

/** Is `value` safe to keep as a CSS value under the current strictness? */
function isValueSafe(value: string, strict: boolean): boolean {
    if (!isSafeCssValue(value)) return false;
    if (strict && DANGEROUS_VALUE_RE.test(value)) return false;
    return true;
}

const DROP = Symbol('drop');

/**
 * Sanitize a single sz value (scalar, array, or property-sub-object). Numbers /
 * booleans / null are safe as-is (not string sinks); strings are validated;
 * objects/arrays are walked, validating every string and skipping forbidden
 * keys WITHOUT applying the top-level key allowlist (sub-keys like `color`/`op`
 * of `bg` are property-specific, not standalone sz keys).
 */
function purifyValue(
    value: SzValue,
    strict: boolean,
    onDrop: PurifySzOptions['onDrop'],
    path: string,
    depth: number,
): SzValue | typeof DROP {
    if (typeof value === 'string') {
        if (isValueSafe(value, strict)) return value;
        onDrop?.(path, 'unsafe-value');
        return DROP;
    }
    if (value === null || typeof value !== 'object') {
        return value; // number / boolean / undefined — not a string sink
    }
    if (depth >= MAX_SZ_DEPTH) throw new SzDepthError();
    if (Array.isArray(value)) {
        const out: SzValue[] = [];
        for (let i = 0; i < value.length; i++) {
            const cleaned = purifyValue(
                value[i] as SzValue,
                strict,
                onDrop,
                `${path}[${i}]`,
                depth + 1,
            );
            if (cleaned !== DROP) out.push(cleaned);
        }
        return out as unknown as SzValue;
    }
    return sanitizeObject(value as SzObject, strict, onDrop, path, depth + 1, false);
}

/**
 * Walk an sz object. At the boundary (`applyKeyAllowlist === true`) unknown
 * top-level/variant keys are dropped; inside a property sub-object it only
 * sanitizes values + skips forbidden keys.
 */
function sanitizeObject(
    input: SzObject,
    strict: boolean,
    onDrop: PurifySzOptions['onDrop'],
    path: string,
    depth: number,
    applyKeyAllowlist: boolean,
): SzObject {
    if (depth > MAX_SZ_DEPTH) throw new SzDepthError();
    const out: SzObject = {};
    for (const [key, value] of Object.entries(input)) {
        const keyPath = path ? `${path}.${key}` : key;
        if (isForbiddenSzKey(key)) {
            onDrop?.(keyPath, 'forbidden-key');
            continue;
        }
        if (applyKeyAllowlist && !SZ_KEY_CATEGORY.has(key)) {
            if (
                isVariantKey(key) &&
                value !== null &&
                typeof value === 'object' &&
                !Array.isArray(value)
            ) {
                const cleaned = sanitizeObject(
                    value as SzObject,
                    strict,
                    onDrop,
                    keyPath,
                    depth + 1,
                    true,
                );
                if (Object.keys(cleaned).length > 0) out[key] = cleaned;
                continue;
            }
            onDrop?.(keyPath, 'unknown-key');
            continue;
        }
        const cleaned = purifyValue(value as SzValue, strict, onDrop, keyPath, depth);
        if (cleaned !== DROP) out[key] = cleaned;
    }
    return out;
}

/**
 * Return a cleaned copy of `sz` safe to pass to `dynamic()` / `useSz` from
 * untrusted input. Drops unknown keys, unsafe values, and prototype-polluting
 * keys; bounds nesting depth. See {@link PurifySzOptions}.
 *
 * @param sz - the untrusted sz object.
 * @param options - strictness + drop reporting.
 * @returns a new sz object containing only allowed keys and safe values.
 */
export function purifySz(sz: SzObject, options: PurifySzOptions = {}): SzObject {
    if (!sz || typeof sz !== 'object' || Array.isArray(sz)) return {};
    const strict = options.strict ?? true;
    return sanitizeObject(sz, strict, options.onDrop, '', 0, true);
}
