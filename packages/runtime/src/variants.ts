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
 *
 */
interface SzvConfig<V extends VariantSchema> {
    base?: SzObject;
    variants: V;
    defaultVariants?: Partial<VariantSelection<V>>;
}

/**
 * Deep merge two SzObjects. Last-write-wins per key at each level.
 * Nested variant objects (e.g. hover, dark, sm) are recursively merged
 * so base hover styles are not lost when a variant adds its own hover.
 *
 * @param {SzObject} target - Base object to merge into
 * @param {SzObject} source - Object whose values take precedence
 * @returns {SzObject} New merged object (target and source are not mutated)
 */
function deepMerge(target: SzObject, source: SzObject): SzObject {
    const result: SzObject = { ...target };
    for (const key of Object.keys(source)) {
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
            result[key] = deepMerge(tv as SzObject, sv as SzObject);
        } else {
            result[key] = sv;
        }
    }
    return result;
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
 *   base: { inlineFlex: true, items: 'center', rounded: 'md', fontWeight: 'medium' },
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
    return function szVariantFn(selection?: VariantSelection<V>): SzObject {
        let result: SzObject = config.base ? { ...config.base } : {};

        // defaultVariants applied first; null/undefined in selection means
        // "not specified" — falls back to default rather than clearing it.
        const resolved: Record<string, unknown> = { ...config.defaultVariants };
        if (selection) {
            for (const key of Object.keys(selection)) {
                const val = (selection as Record<string, unknown>)[key];
                if (val !== null && val !== undefined) {
                    resolved[key] = val;
                }
            }
        }

        for (const variantKey of Object.keys(config.variants)) {
            const selectedValue = resolved[variantKey];
            if (selectedValue === null || selectedValue === undefined) {
                continue;
            }

            const variantObj = config.variants[variantKey][selectedValue as string];
            if (variantObj) {
                result = deepMerge(result, variantObj);
            }
        }

        return result;
    };
}
