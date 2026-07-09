/**
 * Generated metadata shared by csszyx editor integrations.
 *
 * This is an implementation package; application developers should install
 * `@csszyx/ts-plugin` rather than depending on this package directly.
 */
export {
    BOOLEAN_SHORTHANDS,
    KNOWN_VARIANTS,
    METADATA_SCHEMA_VERSION,
    PROPERTY_MAP,
    SUGGESTION_MAP,
    VALUE_SUGGESTIONS,
} from './tooling.generated';

/** Completion metadata schema supported by this package. */
export interface ToolingMetadata {
    readonly schemaVersion: number;
    readonly propertyMap: Readonly<Record<string, string>>;
    readonly booleanShorthands: readonly string[];
    readonly knownVariants: readonly string[];
    readonly suggestionMap: Readonly<Record<string, string>>;
    readonly valueSuggestions: Readonly<Record<string, readonly string[]>>;
}
