/**
 * szv() — variant-based sz object factory.
 *
 * CVA-equivalent but returns sz objects instead of className strings,
 * keeping DX consistent with the sz prop throughout. Use with the sz prop
 * (build-time transform) or with sz() from @csszyx/dynamic (runtime injection).
 *
 * @module @csszyx/runtime/variants
 */

import type { SzProps, VariantModifiers } from '@csszyx/compiler';
import type { SzObject } from '@csszyx/compiler/browser';
import { keysDisplacedBy, keysSettledAway } from '@csszyx/compiler/keyword-families';
import { isForbiddenSzKey, MAX_SZ_DEPTH, SzDepthError } from '@csszyx/compiler/sz-limits';
import { devWarn } from './dev-warn.js';
import { describeValue, selectionValueKey } from './selection-value.js';

/**
 * Dimension → option → sz row. Row VALUES are checked by this constraint, with
 * the same messages `sz={...}` gives.
 */
type VariantSchema = Record<string, Record<string, SzProps>>;

/**
 * The variant keys whose body is a TABLE of sz rows (`aria`, `data`, `has`,
 * `supports` — typed `Record<string, SzProps>`) rather than one sz row. Read
 * off `VariantModifiers` so a new table-shaped variant is picked up without
 * an edit here; not generic, so it is computed once.
 */
type RowTableVariant = {
    [K in keyof VariantModifiers]-?: string extends keyof NonNullable<VariantModifiers[K]>
        ? K
        : never;
}[keyof VariantModifiers];

/**
 * What an unknown row key is re-typed to. An object no string or number
 * satisfies, so the typo is an error, and one that names the key. A string
 * literal would not do: the row is also checked against `V`, and the
 * intersection of the key's literal value with another string literal is
 * `never`, which puts an error on every key of the row and names none.
 */
type NotAnSzKey<P> = { readonly 'not an sz key': P };

/**
 * Re-types one row so that a key `SzProps` does not have becomes
 * `NotAnSzKey`, which turns a typo into a compile error at that key alone.
 * The constraint on `V` cannot do this: an inferred row is checked
 * structurally, and a structural check ignores extra keys. Recurses only
 * through variant keys (`hover`, `md`, `group-hover`, `aria.expanded`, ...),
 * whose bodies are sz rows; an object VALUE such as `bgImg: { gradient }` or
 * `css: { ... }` is left to the constraint, its keys are not sz keys.
 */
type KnownRowKeys<T> = {
    [P in keyof T]: P extends keyof SzProps
        ? P extends keyof VariantModifiers
            ? VariantBodyKeys<T[P], P extends RowTableVariant ? true : false>
            : T[P]
        : NotAnSzKey<P>;
};

/**
 * A variant body: an sz row, or a table of sz rows. Scalars (`group: true`,
 * `'@container': true`) pass through.
 */
type VariantBodyKeys<T, IsTable extends boolean> = T extends object
    ? IsTable extends true
        ? { [K in keyof T]: KnownRowKeys<T[K]> }
        : KnownRowKeys<T>
    : T;

/** Every row of every dimension, key-checked. */
type KnownSchemaKeys<V> = { [K in keyof V]: { [R in keyof V[K]]: KnownRowKeys<V[K][R]> } };

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
    base?: SzProps;
    variants?: V & KnownSchemaKeys<V>;
    defaultVariants?: Partial<VariantSelection<V>>;
}

/**
 * The shape the resolver works on. The public types above do not describe
 * every config that reaches it — runtime data, `as any`, a JS caller — so the
 * internals take the loose shape and `validateSzvConfig` checks it.
 */
interface LooseSzvConfig {
    base?: SzObject;
    variants?: Record<string, Record<string, SzObject>>;
    defaultVariants?: Record<string, unknown>;
}

/**
 * Deep merge two SzObjects. Last-write-wins per key at each level.
 * Nested variant objects (e.g. hover, dark, sm) are recursively merged
 * so base hover styles are not lost when a variant adds its own hover.
 *
 * A stand-alone keyword and its group keys (`touch` and `touchPanX`) settle
 * by the layers' order, as the compiler's sz-array merge settles them: each
 * layer settles its own first, then a later keyword resets the groups merged
 * before it and a later group replaces the keyword. The merged level then never
 * holds both sides of a family, so every key keeps its place.
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
    for (const key of keysSettledAway(target)) {
        delete result[key];
    }
    const settled = keysSettledAway(source);
    for (const key of Object.keys(source)) {
        // Skip prototype-polluting keys — source may be JSON-derived (a runtime
        // variant schema), where an own `__proto__` key would poison the prototype.
        if (isForbiddenSzKey(key)) {
            continue;
        }
        mergeKey(result, key, source[key], settled.has(key), depth);
    }
    return result;
}

/**
 * Merge one key of a later layer into the merged level, in place.
 *
 * @param result The merged level so far.
 * @param key The later layer's key.
 * @param sv Its value.
 * @param settledAway Whether its own layer already settled it away.
 * @param depth Current recursion depth.
 */
function mergeKey(
    result: SzObject,
    key: string,
    sv: SzObject[string],
    settledAway: boolean,
    depth: number,
): void {
    if (sv !== undefined && sv !== null && sv !== false) {
        for (const other of keysDisplacedBy(key)) {
            delete result[other];
        }
    }
    if (settledAway) {
        delete result[key];
        return;
    }
    const tv = result[key];
    result[key] =
        isPlainObject(sv) && isPlainObject(tv)
            ? deepMerge(tv as SzObject, sv as SzObject, depth + 1)
            : sv;
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
            `szv(config): variants.${dimension} must be an object of values, got ${describeValue(values)}.`,
        );
        return;
    }
    for (const [token, value] of Object.entries(values)) {
        if (value !== null && value !== undefined && !isPlainObject(value)) {
            devWarn(
                `szv(config): variants.${dimension}.${token} must be an sz object, got ${describeValue(value)}. It will be skipped.`,
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
        devWarn(`szv(config): config must be an object, got ${describeValue(config)}. Ignoring.`);
        return false;
    }
    if (config.base !== undefined && !isPlainObject(config.base)) {
        devWarn(`szv(config): base must be an sz object, got ${describeValue(config.base)}.`);
    }
    // A base-only config (no `variants` key) is valid: it declares one reusable
    // class bundle. Warning here while still returning the base object was the
    // worst of both — the warning spammed and the behaviour didn't change.
    if (config.variants === undefined) {
        return true;
    }
    if (!isPlainObject(config.variants)) {
        devWarn(
            `szv(config): variants must be an object when present, got ${describeValue(config.variants)}. Ignoring.`,
        );
        return false;
    }
    for (const [dimension, values] of Object.entries(config.variants)) {
        validateVariantDimension(dimension, values);
    }
    if (config.defaultVariants !== undefined && !isPlainObject(config.defaultVariants)) {
        devWarn(
            `szv(config): defaultVariants must be an object, got ${describeValue(config.defaultVariants)}.`,
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
 * Creates a variant-based sz object factory with strong TypeScript inference.
 *
 * The factory returns `SzProps` — the type `sz={...}` takes — so its result
 * goes into `sz=`, `szr()`, or another row without a cast. Rows are checked
 * like `sz={...}`: an unknown key (also nested, e.g. `hover: { bgg }`) or a bad
 * value is a compile error, and the dimension/option names are inferred and
 * checked at the call site. A row shared between configs is declared
 * `as const` (or typed `SzProps`); a row table built at runtime as
 * `Record<string, SzProps>` is accepted, and `validateSzvConfig` checks what
 * the types cannot see.
 *
 * @param {SzvConfig<V>} config - Variant configuration with base, variants, and defaultVariants
 * @returns {Function} A factory function that accepts a variant selection and returns `SzProps`
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
export function szv<const V extends VariantSchema>(
    config: SzvConfig<V>,
): (selection?: VariantSelection<V>) => SzProps {
    // The public type checks the literal config; from here on the config is
    // data — it may come from JSON or an `as any` — so the resolver reads the
    // loose shape and `validateSzvConfig` vouches for it.
    const loose = config as LooseSzvConfig;
    // Validate the config shape once at factory creation (dev only). A
    // structurally broken config returns a safe factory (base or {}) so a bad
    // schema degrades instead of throwing per render.
    const configValid = validateSzvConfig(loose);

    return function szVariantFn(selection?: VariantSelection<V>): SzProps {
        const selected = selection as Record<string, unknown> | undefined;
        const result = configValid
            ? resolveSelection(loose, selected)
            : invalidConfigFallback(loose);
        // A merge of sz rows is an sz row; the resolver works on the loose shape.
        return result as SzProps;
    };
}

/**
 * Resolve one selection against a validated config.
 * @param config - The validated variant config.
 * @param selection - The caller's requested variant values.
 * @returns The merged, guarded sz object.
 */
function resolveSelection(
    config: LooseSzvConfig,
    selection: Record<string, unknown> | undefined,
): SzObject {
    warnInvalidSelection(selection, config.variants);
    const resolved = resolveVariantSelection(selection, config.defaultVariants);
    return attachStringCoercionGuard(applySelectedVariants(config, resolved));
}

/**
 * Builds the safe base-only result used for a structurally invalid config.
 * @param config - The rejected variant config.
 * @returns A guarded copy of its valid base, or an empty object.
 */
function invalidConfigFallback(config: LooseSzvConfig): SzObject {
    const base = isPlainObject(config?.base) ? { ...config.base } : {};
    return attachStringCoercionGuard(base);
}

/**
 * Warns in development when a selection names an unknown dimension or value.
 * @param selection - The caller's requested variant values.
 * @param variants - The configured variant dimensions.
 */
function warnInvalidSelection(
    selection: Record<string, unknown> | undefined,
    variants: LooseSzvConfig['variants'],
): void {
    if (process.env.NODE_ENV === 'production' || !selection) {
        return;
    }

    for (const key of Object.keys(selection)) {
        const value = selection[key];
        warnInvalidSelectionValue(key, value, variants);
    }
}

/**
 * Warn for one selected variant dimension/value pair.
 * @param key - Selected dimension name.
 * @param value - Selected dimension value.
 * @param variants - Configured variant dimensions.
 */
function warnInvalidSelectionValue(
    key: string,
    value: unknown,
    variants: LooseSzvConfig['variants'],
): void {
    if (!(key in (variants ?? {}))) {
        devWarn(`szv()(selection): unknown variant "${key}" — not declared in config.variants.`);
        return;
    }
    if (value === null || value === undefined) return;

    const valueKey = selectionValueKey(value);
    if (valueKey === null || !(valueKey in (variants?.[key] ?? {}))) {
        devWarn(
            `szv()(selection): "${valueKey ?? describeValue(value)}" is not a value of variant "${key}" — it has no styles.`,
        );
    }
}

/**
 * Overlays non-null selections onto defaults while dropping forbidden keys.
 * @param selection - The caller's requested variant values.
 * @param defaults - The configured default variant values.
 * @returns The effective selection table.
 */
function resolveVariantSelection(
    selection: Record<string, unknown> | undefined,
    defaults: Record<string, unknown> | undefined,
): Record<string, unknown> {
    const resolved: Record<string, unknown> = { ...defaults };
    if (!selection) {
        return resolved;
    }

    for (const key of Object.keys(selection)) {
        const value = selection[key];
        if (!isForbiddenSzKey(key) && value !== null && value !== undefined) {
            resolved[key] = value;
        }
    }
    return resolved;
}

/**
 * Merges each selected plain sz object over the configured base.
 * @param config - The validated variant config.
 * @param resolved - The effective variant selections.
 * @returns The merged sz object.
 */
function applySelectedVariants(
    config: LooseSzvConfig,
    resolved: Record<string, unknown>,
): SzObject {
    let result: SzObject = config.base ? { ...config.base } : {};
    for (const variantKey of Object.keys(config.variants ?? {})) {
        const selectedValue = resolved[variantKey];
        if (selectedValue === null || selectedValue === undefined) {
            continue;
        }

        const variantObject = config.variants?.[variantKey]?.[selectedValue as string];
        // A primitive/array here is a mis-shaped config already reported during validation.
        if (isPlainObject(variantObject)) {
            result = deepMerge(result, variantObject as SzObject);
        }
    }
    return result;
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
