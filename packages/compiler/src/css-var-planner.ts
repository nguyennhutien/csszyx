import { encode } from '@csszyx/core';

/**
 *
 */
export type CSSVariableTier = 'component' | 'scoped';

/**
 *
 */
export interface CSSVariablePlanInput {
    /**
     * Stable caller-owned identifier for this usage. The planner returns it
     * unchanged so transform code can apply names without relying on array
     * positions after filtering.
     */
    id: string;
    /** CSS variable tier. Component vars are shared; scoped vars are element-local. */
    tier: CSSVariableTier;
    /** sz property key, e.g. `p`, `bg`, `md-gap`. */
    propertyKey: string;
    /** Variant chain when the property came from nested variants. */
    variantChain?: string;
    /** Required for scoped vars so names can restart per element. */
    elementId?: string;
}

/**
 *
 */
export interface CSSVariablePlanEntry extends CSSVariablePlanInput {
    /** Mangled CSS custom property name, e.g. `--cz` or `--sz`. */
    name: string;
}

/** Options controlling CSS variable name allocation. */
export interface CSSVariablePlanOptions {
    /** CSS custom-property names already owned by user code in this file. */
    reservedNames?: ReadonlySet<string>;
}

/**
 * Plans tiered CSS custom property names without mutating source.
 *
 * Component-tier names are deterministic across the file and deduplicate the
 * same property/variant key. Scoped-tier names restart per element, allowing
 * short names like `--sz` to be safely reused because CSS cascade scope keeps
 * them local.
 *
 * @param usages CSS variable usages in source order.
 * @param options Planner options.
 * @returns Planned names in the same order as the input usages.
 */
export function planCSSVariableNames(
    usages: readonly CSSVariablePlanInput[],
    options: CSSVariablePlanOptions = {},
): CSSVariablePlanEntry[] {
    const componentNames = new Map<string, string>();
    const scopedNamesByElement = new Map<string, Map<string, string>>();
    const reservedNames = options.reservedNames ?? new Set<string>();

    return usages.map(usage => {
        if (usage.tier === 'component') {
            const key = canonicalUsageKey(usage);
            let name = componentNames.get(key);
            if (!name) {
                name = allocateVariableName('--c', componentNames.size, reservedNames);
                componentNames.set(key, name);
            }
            return { ...usage, name };
        }

        const elementId = usage.elementId ?? '';
        const elementNames = getOrCreate(scopedNamesByElement, elementId, () => new Map());
        const key = canonicalUsageKey(usage);
        let name = elementNames.get(key);
        if (!name) {
            name = allocateVariableName('--s', elementNames.size, reservedNames);
            elementNames.set(key, name);
        }
        return { ...usage, name };
    });
}

/**
 * Allocates the next short CSS variable name while skipping user-owned names.
 *
 * @param prefix Tier prefix, including leading custom-property dashes.
 * @param startIndex Initial sequence index.
 * @param reservedNames Names already present in user-authored style objects.
 * @returns Non-reserved CSS custom-property name.
 */
function allocateVariableName(
    prefix: string,
    startIndex: number,
    reservedNames: ReadonlySet<string>,
): string {
    let index = startIndex;
    while (true) {
        const name = `${prefix}${encode(index)}`;
        if (!reservedNames.has(name)) {
            return name;
        }
        index++;
    }
}

/**
 * Builds the stable identity used for deduping one tier's variable usages.
 *
 * @param usage Usage metadata containing the property and optional variant chain.
 * @returns Canonical key for a CSS variable usage.
 */
function canonicalUsageKey(
    usage: Pick<CSSVariablePlanInput, 'propertyKey' | 'variantChain'>,
): string {
    return `${usage.variantChain ?? ''}\0${usage.propertyKey}`;
}

/**
 * Gets an existing map value or stores a new one.
 *
 * @param map Map to read or populate.
 * @param key Entry key.
 * @param create Factory called only when the key is missing.
 * @returns Existing or newly-created value.
 */
function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
    const existing = map.get(key);
    if (existing) {
        return existing;
    }
    const value = create();
    map.set(key, value);
    return value;
}
