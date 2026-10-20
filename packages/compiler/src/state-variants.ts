/**
 * Which bare state names csszyx knows, and which of them the Tailwind it
 * builds with serves as a variant (`unserved-variant`, ADR 0031 item 17).
 *
 * The table is generated from the pinned Tailwind
 * (`state-variants.generated.ts`). The runtime answers from it because it
 * cannot read a project's stylesheet; `csszyx check` and the build ask the
 * project's own Tailwind whether a variant is served and read only the form
 * from here.
 *
 * @module state-variants
 */

import {
    SERVED_STATE_VARIANTS,
    STATE_VARIANT_FORMS,
    type StateVariantForm,
} from './state-variants.generated.js';

export type { StateVariantForm } from './state-variants.generated.js';

/**
 * The form `unserved-variant` names a state in.
 *
 * @param name - A variant name, as the class writes it (`hidden`).
 * @returns The form, or null for a name csszyx does not know as an ARIA
 *          state.
 */
export function stateVariantForm(name: string): StateVariantForm | null {
    // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is ES2022; this package's lib is ES2021.
    return Object.prototype.hasOwnProperty.call(STATE_VARIANT_FORMS, name)
        ? (STATE_VARIANT_FORMS[name] as StateVariantForm)
        : null;
}

/**
 * The form of a state name the pinned Tailwind serves no bare variant for.
 *
 * @param name - A variant name, as the class writes it.
 * @returns The form, or null when the name is served or not a state csszyx knows.
 */
export function unservedStateVariantForm(name: string): StateVariantForm | null {
    return SERVED_STATE_VARIANTS.includes(name) ? null : stateVariantForm(name);
}
