/* eslint-disable jsdoc/require-jsdoc -- each export is a one-line type assertion
   whose meaning is its name + the section comment above it; per-export JSDoc would
   only restate the name. */
/**
 * Compile-time contract for the sz value types. No runtime — `tsc -b` checks this
 * module, so if the assignability relationships the runtime relies on ever
 * regress, the build fails here instead of in a downstream app.
 *
 * The bridge: a precise `SzPropValue` (the type the JSX augmentation gives `sz` on
 * a host element) must flow into the runtime helpers' `SzInput` so a polymorphic
 * wrapper can both forward `sz` to `<div>` and pass it to `szr`/`splitBoxSz`
 * without a cast. See {@link SzInput}.
 */

import type { SzArrayElement, SzObject, SzProps, SzPropValue } from '@csszyx/compiler';

import type { SzInput } from './concatenate.js';
// NOSONAR: this contract intentionally verifies the deprecated public alias.
import type { SzInput as LiteSzInput, SzStringInput } from './lite.js'; // NOSONAR

/** Resolves to `T` only when `T` is exactly `true`, else fails the build. */
type Assert<T extends true> = T;

/** True when `A` is assignable to `B`. */
type AssignableTo<A, B> = [A] extends [B] ? true : false;

/** True when `A` is NOT assignable to `B` (for locking negative cases). */
type NotAssignableTo<A, B> = [A] extends [B] ? false : true;

// ── The bridge: the augmentation's value type flows into the runtime input ──
export type _ContractPropValueToInput = Assert<AssignableTo<SzPropValue, SzInput>>;
export type _ContractPropsToInput = Assert<AssignableTo<SzProps, SzInput>>;
export type _ContractObjectToInput = Assert<AssignableTo<SzObject, SzInput>>;

// ── SzInput still accepts every shape it documents ──
export type _ContractStringToInput = Assert<AssignableTo<string, SzInput>>;
export type _ContractArrayToInput = Assert<AssignableTo<SzPropValue[], SzInput>>;
export type _ContractFalsyToInput = Assert<AssignableTo<null | undefined | false, SzInput>>;

// ── `as const` is authoring advice, so it must not cost assignability ──
// The docs recommend `as const` on a shared style object. On an OBJECT that is
// free; on an ARRAY it produces a readonly tuple, which a mutable element type
// rejects — the recommendation would then break the code that followed it.
// Nothing here mutates an sz array, so accepting readonly costs nothing.
export type _ContractReadonlyArrayToPropValue = Assert<
    AssignableTo<readonly SzArrayElement[], SzPropValue>
>;
export type _ContractReadonlyArrayToInput = Assert<
    AssignableTo<readonly SzArrayElement[], SzInput>
>;

// ── SzInput stays narrow enough to reject primitives that are not strings ──
// (the object member must not swallow numbers/booleans — those are not sz inputs).
export type _ContractNumberRejected = Assert<NotAssignableTo<number, SzInput>>;
export type _ContractBooleanTrueRejected = Assert<NotAssignableTo<true, SzInput>>;

// ── The lite alias is exactly its renamed type (back-compat) ──
export type _ContractLiteAlias = Assert<
    AssignableTo<LiteSzInput, SzStringInput> extends true // NOSONAR
        ? AssignableTo<SzStringInput, LiteSzInput> // NOSONAR
        : false
>;
// ── The lite (string-only) input must NOT accept objects ──
export type _ContractLiteRejectsObject = Assert<NotAssignableTo<SzProps, SzStringInput>>;
