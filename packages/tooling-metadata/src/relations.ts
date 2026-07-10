/**
 * Token-relationship semantics shared by every csszyx completion provider.
 *
 * The AST classifier in `@csszyx/ts-plugin` and the regex scanner in the VS
 * Code extension traverse source differently, but the VERDICTS — which keys may
 * own a nested object, which szv chain positions are style objects — must be
 * identical, so the predicates live here beside the data they interpret.
 * (Future conflict/affinity relations belong in this module too.)
 */

import { BOOLEAN_SHORTHANDS, PROPERTY_MAP } from './tooling.generated';

/**
 * Utility property keys. Their values are strings/numbers, never objects, so a
 * nested object under one of them (`borderColor: { … }`) is not sz syntax and
 * must get no suggestions. Variant keys and unknown (arbitrary/custom-variant)
 * keys are absent from this set — classification stays syntax-first and gives
 * unknown parents the benefit of the doubt. PROPERTY_MAP and KNOWN_VARIANTS are
 * disjoint, so a variant name can never be blocked by this set.
 */
export const PROPERTY_KEYS: ReadonlySet<string> = new Set<string>([
    ...Object.keys(PROPERTY_MAP),
    ...BOOLEAN_SHORTHANDS,
]);

/** Check whether a key is a utility property (value-typed, never object-typed).
 * @param name - Candidate key name.
 * @returns True when the key's value cannot be a nested style object.
 */
export function isUtilityPropertyKey(name: string): boolean {
    return PROPERTY_KEYS.has(name);
}

/** Check that no key owning a nested object along a chain is a utility property.
 * @param names - Intermediate property-name chain (inner or outer order — the
 * verdict is order-independent). Unknown/computed owners should be passed as
 * empty strings or filtered out by the caller; they always pass.
 * @returns Whether every name may legally own a nested style object.
 */
export function chainAllowsNesting(names: readonly string[]): boolean {
    for (const name of names) {
        if (name && PROPERTY_KEYS.has(name)) return false;
    }
    return true;
}

/**
 * Resolve a szv config chain to the style-object chain it encloses.
 *
 * szv's schema levels are structural, not style keys: `base` holds a style
 * object directly; `variants.<axis>.<option>` holds one two levels below the
 * axis; `compoundVariants[n].sz` holds one behind the `sz` key. Names BELOW the
 * structural prefix are nested style keys and follow `chainAllowsNesting`.
 * @param rootToLeaf - Property-name chain from the szv config root down to
 * (excluding) the object being classified.
 * @returns The style-key chain below the structural prefix, or null when the
 * position is not inside a style object (axis/option levels, unknown sections).
 */
export function szvStyleChain(rootToLeaf: readonly string[]): readonly string[] | null {
    if (rootToLeaf[0] === 'base') return rootToLeaf.slice(1);
    if (rootToLeaf[0] === 'variants') {
        return rootToLeaf.length >= 3 ? rootToLeaf.slice(3) : null;
    }
    if (rootToLeaf[0] === 'compoundVariants') {
        const szIndex = rootToLeaf.indexOf('sz');
        return szIndex >= 0 ? rootToLeaf.slice(szIndex + 1) : null;
    }
    return null;
}
