/**
 * szv() — variant-based sz object factory.
 *
 * CVA-equivalent but returns sz objects instead of className strings,
 * keeping DX consistent with the sz prop throughout. Use with the sz prop
 * (build-time transform) or with sz() from @csszyx/dynamic (runtime injection).
 *
 * @module @csszyx/runtime/variants
 */

import type { SzObject } from '@csszyx/compiler/browser';
import { isForbiddenSzKey, MAX_SZ_DEPTH, SzDepthError } from '@csszyx/compiler/browser';
import { devWarn } from './dev-warn.js';

/**
 *
 */
type VariantSchema = Record<string, Record<string, SzObject>>;

/**
 *
 */
type VariantSelection<V extends VariantSchema> = {
    [K in keyof V]?: keyof V[K] | null | undefined;
};

/**
 * Configuration for a variant component: base styles, variants, and defaults.
 * `variants` is optional — a base-only config is a legitimate way to declare
 * one compiled-and-extracted class bundle for reuse.
 */
interface SzvConfig<V extends VariantSchema> {
    base?: SzObject;
    variants?: V;
    defaultVariants?: Partial<VariantSelection<V>>;
}

/**
 * Deep merge two SzObjects. Last-write-wins per key at each level.
 * Nested variant objects (e.g. hover, dark, sm) are recursively merged
 * so base hover styles are not lost when a variant adds its own hover.
 *
 * @param {SzObject} target - Base object to merge into
 * @param {SzObject} source - Object whose values take precedence
 * @param {number} depth - Current recursion depth (for depth bounding)
 * @returns {SzObject} New merged object (target and source are not mutated)
 */
function deepMerge(target: SzObject, source: SzObject, depth = 0): SzObject {
    if (depth >= MAX_SZ_DEPTH) {
        throw new SzDepthError();
    }
    const result: SzObject = { ...target };
    for (const key of Object.keys(source)) {
        // Skip prototype-polluting keys — source may be JSON-derived (a runtime
        // variant schema), where an own `__proto__` key would poison the prototype.
        if (isForbiddenSzKey(key)) {
            continue;
        }
        const sv = source[key];
        const tv = target[key];
        if (
            sv !== null &&
            sv !== undefined &&
            typeof sv === 'object' &&
            !Array.isArray(sv) &&
            tv !== null &&
            tv !== undefined &&
            typeof tv === 'object' &&
            !Array.isArray(tv)
        ) {
            result[key] = deepMerge(tv as SzObject, sv as SzObject, depth + 1);
        } else {
            result[key] = sv;
        }
    }
    return result;
}

/**
 * A non-null, non-array object — the only shape a szv config / variant value may
 * take. A primitive or array at a variant slot is a structural mistake.
 *
 * @param value - The value to test.
 * @returns true if `value` is a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate every value within one szv variant dimension.
 *
 * @param dimension Variant dimension name.
 * @param values Candidate variant-value table.
 */
function validateVariantDimension(dimension: string, values: unknown): void {
    if (!isPlainObject(values)) {
        devWarn(
            `szv(config): variants.${dimension} must be an object of values, got ${describe(values)}.`,
        );
        return;
    }
    for (const [token, value] of Object.entries(values)) {
        if (value !== null && value !== undefined && !isPlainObject(value)) {
            devWarn(
                `szv(config): variants.${dimension}.${token} must be an sz object, got ${describe(value)}. It will be skipped.`,
            );
        } else if (isPlainObject(value)) {
            assertBoundedDepth(value, `variants.${dimension}.${token}`);
        }
    }
}

/**
 * Validate a szv config's structure in development and warn (once) on each
 * problem — strong types catch this at compile time, but a config built from
 * runtime/JSON data, an `as any`, or a JS caller bypasses them, and the failure
 * is otherwise silent (dead or wrong classes). Reuses the shared `isForbiddenSzKey`
 * + `MAX_SZ_DEPTH` guards (the same deep-object protections as the Rust/compiler
 * path) so a hostile or pathological config is bounded here too.
 *
 * @param config - The szv config to validate.
 * @returns true if the config is structurally usable; false if it should fall back.
 */
function validateSzvConfig(config: unknown): boolean {
    if (process.env.NODE_ENV === 'production') {
        return true;
    }
    if (!isPlainObject(config)) {
        devWarn(`szv(config): config must be an object, got ${describe(config)}. Ignoring.`);
        return false;
    }
    if (config.base !== undefined && !isPlainObject(config.base)) {
        devWarn(`szv(config): base must be an sz object, got ${describe(config.base)}.`);
    }
    // A base-only config (no `variants` key) is valid: it declares one reusable
    // class bundle. Warning here while still returning the base object was the
    // worst of both — the warning spammed and the behaviour didn't change.
    if (config.variants === undefined) {
        return true;
    }
    if (!isPlainObject(config.variants)) {
        devWarn(
            `szv(config): variants must be an object when present, got ${describe(config.variants)}. Ignoring.`,
        );
        return false;
    }
    for (const [dimension, values] of Object.entries(config.variants)) {
        validateVariantDimension(dimension, values);
    }
    if (config.defaultVariants !== undefined && !isPlainObject(config.defaultVariants)) {
        devWarn(
            `szv(config): defaultVariants must be an object, got ${describe(config.defaultVariants)}.`,
        );
    }
    return true;
}

/**
 * Walk an sz object bounded by `MAX_SZ_DEPTH`, warning if it is nested deeper —
 * the dev mirror of the runtime depth guard, so a pathological config is flagged
 * at authoring time instead of throwing an `SzDepthError` mid-render.
 *
 * @param obj - The sz object to bound-check.
 * @param where - A label for the warning (e.g. `variants.size.sm`).
 * @param depth - Current recursion depth.
 */
function assertBoundedDepth(obj: Record<string, unknown>, where: string, depth = 0): void {
    if (depth >= MAX_SZ_DEPTH) {
        devWarn(
            `szv(config): ${where} nests deeper than ${MAX_SZ_DEPTH} levels; it will be rejected at render.`,
        );
        return;
    }
    for (const key of Object.keys(obj)) {
        if (isForbiddenSzKey(key)) {
            devWarn(`szv(config): ${where} has a forbidden key "${key}"; it will be skipped.`);
            continue;
        }
        const v = obj[key];
        if (isPlainObject(v)) {
            assertBoundedDepth(v, `${where}.${key}`, depth + 1);
        }
    }
}

/**
 * One-line description of a bad value for a warning message.
 *
 * @param value - The offending value.
 * @returns A short type description.
 */
function describe(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'an array';
    return typeof value;
}

/**
 * Creates a variant-based sz object factory with strong TypeScript inference.
 *
 * TypeScript catches invalid variant values at compile time — no runtime
 * surprises. All variant objects are plain sz objects, fully compatible
 * with the sz prop and @csszyx/dynamic's sz() function.
 *
 * @param {SzvConfig<V>} config - Variant configuration with base, variants, and defaultVariants
 * @returns {Function} A factory function that accepts a variant selection and returns an SzObject
 *
 * @example
 * ```tsx
 * import { szv } from 'csszyx';
 *
 * const buttonSz = szv({
 *   base: { display: 'inline-flex', items: 'center', rounded: 'md', weight: 'medium' },
 *   variants: {
 *     variant: {
 *       default: { bg: 'primary', text: 'primary-foreground' },
 *       outline: { border: true, borderColor: 'blue-500', bg: 'transparent' },
 *       ghost:   { hover: { bg: 'accent' } },
 *     },
 *     size: {
 *       sm: { h: 9,  px: 3, text: 'sm' },
 *       md: { h: 10, px: 4 },
 *       lg: { h: 11, px: 8 },
 *     },
 *   },
 *   defaultVariants: { variant: 'default', size: 'md' },
 * });
 *
 * // Usage — consistent with sz prop, TypeScript catches invalid values
 * <button sz={buttonSz({ variant: 'outline', size: 'sm' })} />
 *
 * // Compose with sz array syntax
 * <button sz={[
 *   buttonSz({ variant: props.variant, size: props.size }),
 *   isLoading && { opacity: 50, cursor: 'wait' },
 * ]} />
 *
 * // With @csszyx/dynamic for fully runtime-resolved styling
 * const { sz } = useSz();
 * <button className={sz(buttonSz({ variant: props.variant }))} />
 * ```
 */
export function szv<V extends VariantSchema>(
    config: SzvConfig<V>,
): (selection?: VariantSelection<V>) => SzObject {
    // Validate the config shape once at factory creation (dev only). A
    // structurally broken config returns a safe factory (base or {}) so a bad
    // schema degrades instead of throwing per render.
    const configValid = validateSzvConfig(config);

    return function szVariantFn(selection?: VariantSelection<V>): SzObject {
        if (!configValid) {
            return attachStringCoercionGuard(
                isPlainObject(config?.base) ? { ...(config.base as SzObject) } : {},
            );
        }
        // Validate the selection tokens (dev only): an unknown variant dimension
        // or an unknown value silently produced no styles before.
        if (process.env.NODE_ENV !== 'production' && selection) {
            for (const key of Object.keys(selection)) {
                if (!(key in (config.variants ?? {}))) {
                    devWarn(
                        `szv()(selection): unknown variant "${key}" — not declared in config.variants.`,
                    );
                    continue;
                }
                const val = (selection as Record<string, unknown>)[key];
                if (
                    val !== null &&
                    val !== undefined &&
                    !(String(val) in (config.variants?.[key] ?? {}))
                ) {
                    devWarn(
                        `szv()(selection): "${String(val)}" is not a value of variant "${key}" — it has no styles.`,
                    );
                }
            }
        }

        let result: SzObject = config.base ? { ...config.base } : {};

        // defaultVariants applied first; null/undefined in selection means
        // "not specified" — falls back to default rather than clearing it.
        const resolved: Record<string, unknown> = { ...config.defaultVariants };
        if (selection) {
            for (const key of Object.keys(selection)) {
                if (isForbiddenSzKey(key)) {
                    continue;
                }
                const val = (selection as Record<string, unknown>)[key];
                if (val !== null && val !== undefined) {
                    resolved[key] = val;
                }
            }
        }

        for (const variantKey of Object.keys(config.variants ?? {})) {
            const selectedValue = resolved[variantKey];
            if (selectedValue === null || selectedValue === undefined) {
                continue;
            }

            const variantObj = config.variants?.[variantKey]?.[selectedValue as string];
            // Only merge a plain sz object — a primitive/array at this slot is a
            // mis-shaped config (already warned by validateSzvConfig) and would
            // otherwise spread into char-indexed keys.
            if (isPlainObject(variantObj)) {
                result = deepMerge(result, variantObj as SzObject);
            }
        }

        return attachStringCoercionGuard(result);
    };
}

/**
 * Dev-only trap for the classic misuse `className={someSzv({ v })}`: an szv
 * factory returns the sz OBJECT (only an `sz=` attribute position receives the
 * compile-time wrapping), so assigning it to className silently rendered
 * `class="[object Object]"`. The DOM coerces via `toString`, so a
 * non-enumerable override fires exactly at the misuse site — spreads,
 * Object.entries-based transforms, and JSON never see it. Production behaviour
 * is untouched.
 *
 * @param result - The sz object a variant factory is about to return.
 * @returns The same object, with the dev-only coercion trap attached.
 */
function attachStringCoercionGuard(result: SzObject): SzObject {
    if (process.env.NODE_ENV !== 'production') {
        Object.defineProperty(result, 'toString', {
            value: (): string => {
                devWarn(
                    'szv() returned an sz OBJECT that was used as a string (e.g. ' +
                        'className={someSzv({...})}) — this renders "[object Object]". ' +
                        'Pass it to an sz= prop, or resolve it with szr(...) first.',
                );
                return '';
            },
            enumerable: false,
            writable: true,
            configurable: true,
        });
    }
    return result;
}
