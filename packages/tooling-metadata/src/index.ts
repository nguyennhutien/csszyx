/**
 * Generated metadata shared by csszyx editor integrations.
 *
 * This is an implementation package; application developers should install
 * `@csszyx/ts-plugin` rather than depending on this package directly.
 */

export {
    COLOR_OBJECT_PROPS,
    chainAllowsNesting,
    classifyStyleChain,
    isUtilityPropertyKey,
    type ObjectFormMember,
    type ObjectValueForm,
    objectValueForm,
    PROPERTY_KEYS,
    type StyleChainKind,
    szvStyleChain,
} from './relations';
export {
    BOOLEAN_SHORTHANDS,
    KNOWN_VARIANTS,
    METADATA_SCHEMA_VERSION,
    NEGATIVE_VALUE_KEYS,
    PROPERTY_MAP,
    SUGGESTION_MAP,
    VALUE_SUGGESTIONS,
} from './tooling.generated';
export { negativeValueSuggestions } from './value-suggestions';

import { NEGATIVE_VALUE_KEYS, VALUE_SUGGESTIONS } from './tooling.generated';
import { negativeValueSuggestions } from './value-suggestions';

/**
 * Values a key suggests, positives first then their negative counterparts.
 *
 * Negatives rank last on purpose: with an empty prefix the dropdown should read
 * as the natural positive scale, and a consumer that truncates the list keeps
 * the positives. Typing `-` filters to the negatives immediately.
 *
 * @param key - The sz prop key.
 * @returns Suggested values, or an empty array when the key has none.
 */
export function valueSuggestionsFor(key: string): string[] {
    const positives = VALUE_SUGGESTIONS[key];
    if (!positives) return [];
    return [
        ...positives,
        ...negativeValueSuggestions(key, (NEGATIVE_VALUE_KEYS as readonly string[]).includes(key)),
    ];
}

/** Completion metadata schema supported by this package. */
export interface ToolingMetadata {
    readonly schemaVersion: number;
    readonly propertyMap: Readonly<Record<string, string>>;
    readonly booleanShorthands: readonly string[];
    readonly knownVariants: readonly string[];
    readonly suggestionMap: Readonly<Record<string, string>>;
    readonly valueSuggestions: Readonly<Record<string, readonly string[]>>;
}
