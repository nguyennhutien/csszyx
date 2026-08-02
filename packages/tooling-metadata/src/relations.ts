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
    /**
     * The form this member's own object value takes, when it holds one.
     *
     * Most structured values are one level deep — `bg: { color, op }` and
     * `bgImg: { gradient, dir, in }` carry only scalars. The mask layers are
     * not: `maskLinear: { b: { from: { at, color, op } } }` is three, because
     * Tailwind scopes a stop by side and then splits its position from its
     * colour. Assistance that stopped at the first level would go quiet exactly
     * where the shape is least guessable.
     */
    readonly form?: ObjectValueForm;
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

/** One mask gradient stop: `{ at, color, op }` → `mask-b-from-20%` + `…-red-500/30`. */
const MASK_STOP_FORM: ObjectValueForm = {
    members: [
        {
            name: 'at',
            detail: 'gradient position',
            values: ['0%', '20%', '50%', '80%', '100%'],
        },
        {
            name: 'color',
            detail: 'stop colour',
            values: VALUE_SUGGESTIONS.color as readonly string[],
        },
        {
            name: 'op',
            detail: 'colour opacity',
            values: VALUE_SUGGESTIONS.opacity as readonly string[],
        },
    ],
};

/** One side of the linear mask layer: `{ from, to }`. */
const MASK_EDGE_FORM: ObjectValueForm = {
    members: [
        { name: 'from', detail: 'start stop', values: [], form: MASK_STOP_FORM },
        { name: 'to', detail: 'end stop', values: [], form: MASK_STOP_FORM },
    ],
};

/** Sides of the linear layer, each owning its own `--tw-mask-<side>`. */
const MASK_SIDE_MEMBERS: readonly ObjectFormMember[] = (
    [
        ['t', 'top edge'],
        ['r', 'right edge'],
        ['b', 'bottom edge'],
        ['l', 'left edge'],
        ['x', 'left and right edges'],
        ['y', 'top and bottom edges'],
    ] as const
).map(([name, detail]) => ({ name, detail, values: [], form: MASK_EDGE_FORM }));

/**
 * `maskLinear: { angle, from, to }` OR `{ <side>: { from, to } }` — the angle
 * fields and the side fields both write `--tw-mask-linear`, so they are
 * alternative modes; both are offered because either is valid on its own.
 */
const MASK_LINEAR_FORM: ObjectValueForm = {
    members: [
        { name: 'angle', detail: 'gradient angle', values: ['0', '45', '90', '180', '-45'] },
        { name: 'from', detail: 'start stop', values: [], form: MASK_STOP_FORM },
        { name: 'to', detail: 'end stop', values: [], form: MASK_STOP_FORM },
        ...MASK_SIDE_MEMBERS,
    ],
};

/** `maskRadial: { at, size, shape, from, to }`. */
const MASK_RADIAL_FORM: ObjectValueForm = {
    members: [
        {
            name: 'at',
            detail: 'focal position',
            values: [
                'center',
                'top',
                'bottom',
                'left',
                'right',
                'top-left',
                'top-right',
                'bottom-left',
                'bottom-right',
            ],
        },
        {
            name: 'size',
            detail: 'gradient extent',
            values: ['closest-side', 'closest-corner', 'farthest-side', 'farthest-corner'],
        },
        { name: 'shape', detail: 'radial shape', values: ['circle', 'ellipse'] },
        { name: 'from', detail: 'start stop', values: [], form: MASK_STOP_FORM },
        { name: 'to', detail: 'end stop', values: [], form: MASK_STOP_FORM },
    ],
};

/** `maskConic: { angle, from, to }`. */
const MASK_CONIC_FORM: ObjectValueForm = {
    members: [
        { name: 'angle', detail: 'starting angle', values: ['0', '45', '90', '180'] },
        { name: 'from', detail: 'start stop', values: [], form: MASK_STOP_FORM },
        { name: 'to', detail: 'end stop', values: [], form: MASK_STOP_FORM },
    ],
};

/**
 * Keys whose value is ALWAYS a structured object, so they carry no
 * `PROPERTY_MAP` prefix and would otherwise be missing from the key list every
 * completion source builds from that map.
 */
export const OBJECT_ONLY_PROPERTY_KEYS: ReadonlySet<string> = new Set([
    'maskLinear',
    'maskRadial',
    'maskConic',
]);

/** Resolve the structured object form a property's value accepts, if any.
 * @param name - Property key owning a nested object.
 * @returns The form, or null when the property takes no object value.
 */
export function objectValueForm(name: string): ObjectValueForm | null {
    if (name === 'bgImg') return BG_IMG_FORM;
    if (name === 'maskLinear') return MASK_LINEAR_FORM;
    if (name === 'maskRadial') return MASK_RADIAL_FORM;
    if (name === 'maskConic') return MASK_CONIC_FORM;
    if (COLOR_OBJECT_PROPS.has(name)) return COLOR_FORM;
    return null;
}

/**
 * Walk a form tree along a root-to-leaf property chain.
 *
 * @param root - Form owned by the outermost property.
 * @param path - Member names from that property inward.
 * @returns The form owning the innermost object, or null when the path leaves
 * the structured shape.
 */
export function descendObjectForm(
    root: ObjectValueForm | null,
    path: readonly string[],
): ObjectValueForm | null {
    let current = root;
    for (const name of path) {
        if (current === null) return null;
        const member = current.members.find(candidate => candidate.name === name);
        if (member === undefined) return null;
        current = member.form ?? null;
    }
    return current;
}

/** Keys whose object value has OPEN membership (arbitrary CSS properties) —
 * valid syntax, but no finite key list exists to suggest inside it. */
const OPAQUE_OBJECT_KEYS: ReadonlySet<string> = new Set(['css']);

/** What a nested-object chain inside a style region means. */
export type StyleChainKind = 'style' | 'object-form' | 'opaque' | 'invalid';

/** Structural verdict plus the exact form at the cursor, when applicable. */
export interface StyleChainResolution {
    readonly kind: StyleChainKind;
    readonly form: ObjectValueForm | null;
}

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
    return 'invalid';
}

/**
 * Index of the outermost name that opens a structured form.
 *
 * @param namesInnerFirst - Owner-name chain, innermost first.
 * @returns The index, or -1 when no name opens one.
 */
function findLastFormOwner(namesInnerFirst: readonly string[]): number {
    for (let index = namesInnerFirst.length - 1; index >= 0; index -= 1) {
        if (objectValueForm(namesInnerFirst[index] as string) !== null) return index;
    }
    return -1;
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
export function resolveStyleChain(namesInnerFirst: readonly string[]): StyleChainResolution {
    // A structured form may nest, so the owner that opens one is not always the
    // innermost name: `maskLinear: { b: { from: { … } } }` puts `from` and `b`
    // BELOW the owner. Find the outermost owner that opens a form and check the
    // names inside it against that form's tree rather than against sz keys.
    // Search from the OUTERMOST name inward. A member of a form can share a
    // name with a top-level property that owns its own form — `color` is both a
    // member of `bg`'s form and a colour prop — so scanning inward first would
    // treat `bg: { color: { … } }` as a fresh form instead of the invalid
    // nesting it is.
    const formOwner = findLastFormOwner(namesInnerFirst);
    if (formOwner >= 0) {
        const inside = namesInnerFirst.slice(0, formOwner).reverse();
        const resolved = descendObjectForm(
            objectValueForm(namesInnerFirst[formOwner] as string),
            inside,
        );
        if (resolved === null) return { kind: 'invalid', form: null };
        return { kind: 'object-form', form: resolved };
    }
    let kind: StyleChainKind = 'style';
    for (let index = 0; index < namesInnerFirst.length; index += 1) {
        const name = namesInnerFirst[index] ?? '';
        const ownerKind = classifyStyleOwner(name, index);
        if (ownerKind === 'invalid') return { kind: ownerKind, form: null };
        if (ownerKind !== null) kind = ownerKind;
    }
    return { kind, form: null };
}

/**
 * Classify a nested-object chain inside a style region.
 *
 * @param namesInnerFirst - Owner-name chain from the cursor's object outward.
 * @returns The structural chain kind.
 */
export function classifyStyleChain(namesInnerFirst: readonly string[]): StyleChainKind {
    return resolveStyleChain(namesInnerFirst).kind;
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
