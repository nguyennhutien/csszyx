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
import { COLOR_VALUE_PROPS, VALUE_SUGGESTIONS } from './value-suggestions';

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

/** One member of a structured object-value form. */
export interface ObjectFormMember {
    readonly name: string;
    /** Short human hint shown beside the member key. */
    readonly detail: string;
    /** Curated value suggestions for the member. */
    readonly values: readonly string[];
}

/** A structured object value a property accepts instead of a style object. */
export interface ObjectValueForm {
    readonly members: readonly ObjectFormMember[];
}

/** Props that accept the `{ color: token, op: number }` object value form —
 * the documented (and only) way to express color opacity. */
export const COLOR_OBJECT_PROPS: ReadonlySet<string> = new Set(COLOR_VALUE_PROPS);

const COLOR_FORM: ObjectValueForm = {
    members: [
        { name: 'color', detail: 'color token', values: VALUE_SUGGESTIONS.color ?? [] },
        { name: 'op', detail: 'opacity', values: VALUE_SUGGESTIONS.opacity ?? [] },
    ],
};

/** `bgImg: { gradient, dir, in }` → `bg-linear-to-r/hsl` (spec: BgImgGradient). */
const BG_IMG_FORM: ObjectValueForm = {
    members: [
        { name: 'gradient', detail: 'gradient type', values: ['linear', 'radial', 'conic'] },
        {
            name: 'dir',
            detail: 'direction / angle',
            values: ['to-r', 'to-l', 'to-t', 'to-b', 'to-tr', 'to-tl', 'to-br', 'to-bl'],
        },
        {
            name: 'in',
            detail: 'color interpolation',
            values: [
                'srgb',
                'hsl',
                'oklab',
                'oklch',
                'longer',
                'shorter',
                'increasing',
                'decreasing',
            ],
        },
    ],
};

/** Resolve the structured object form a property's value accepts, if any.
 * @param name - Property key owning a nested object.
 * @returns The form, or null when the property takes no object value.
 */
export function objectValueForm(name: string): ObjectValueForm | null {
    if (name === 'bgImg') return BG_IMG_FORM;
    if (COLOR_OBJECT_PROPS.has(name)) return COLOR_FORM;
    return null;
}

/** Keys whose object value has OPEN membership (arbitrary CSS properties) —
 * valid syntax, but no finite key list exists to suggest inside it. */
const OPAQUE_OBJECT_KEYS: ReadonlySet<string> = new Set(['css']);

/** What a nested-object chain inside a style region means. */
export type StyleChainKind = 'style' | 'object-form' | 'opaque' | 'invalid';

/**
 * Classify one owner in a nested style chain.
 * @param name - Static owner name, or an empty dynamic placeholder.
 * @param index - Owner depth, innermost first.
 * @returns The owner's effect on the chain, or null when it remains style-like.
 */
function classifyStyleOwner(name: string, index: number): StyleChainKind | null {
    if (!name) return null;
    if (OPAQUE_OBJECT_KEYS.has(name)) return index === 0 ? 'opaque' : 'invalid';
    if (!PROPERTY_KEYS.has(name)) return null;
    if (index === 0 && objectValueForm(name) !== null) return 'object-form';
    return 'invalid';
}

/**
 * Classify a nested-object chain inside a style region.
 *
 * Variant and unknown keys may own nested style objects freely. A utility
 * property may own a nested object only as its documented structured value
 * (`bg: { color, op }`, `bgImg: { gradient, … }`) and only as the INNERMOST
 * owner. `css` owns an open object (arbitrary CSS properties) that cannot be
 * assisted. Any other property owner along the chain is invalid sz structure.
 * @param namesInnerFirst - Owner-name chain from the cursor's object outward
 * ('' = unknown owner, always permitted).
 * @returns The chain kind; consumers serve suggestions only for 'style' and
 * 'object-form'.
 */
export function classifyStyleChain(namesInnerFirst: readonly string[]): StyleChainKind {
    let kind: StyleChainKind = 'style';
    for (let index = 0; index < namesInnerFirst.length; index += 1) {
        const name = namesInnerFirst[index] ?? '';
        const ownerKind = classifyStyleOwner(name, index);
        if (ownerKind === 'invalid') return ownerKind;
        if (ownerKind !== null) kind = ownerKind;
    }
    return kind;
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
