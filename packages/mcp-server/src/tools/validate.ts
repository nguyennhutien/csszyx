/**
 * csszyx_validate — Validate a sz object for correctness before using it.
 *
 * Checks each key against the real compiler's generated canonical-key sets,
 * then compiles every entry with the engine and reads the diagnostics it
 * returns. An entry that emits no class and has a diagnostic is an error (a
 * moved value, a replaced or removed key); any other diagnostic is a warning.
 * The engine returns its diagnostics per call, so the answer is the same on
 * every call — the console warnings the runtime transform prints are deduped
 * per process and muted in production, and are not read.
 *
 * Example: { padding: 4 } → error "Unknown prop 'padding'. Use 'p' instead."
 */

import {
    BOOLEAN_SHORTHANDS,
    KNOWN_SPECIAL_PROPERTIES,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    REMOVED_BOOLEAN_SUGAR,
    REPLACED_KEYS,
    SUGGESTION_MAP,
    type SzObject,
    transform,
    transformSource,
} from '@csszyx/compiler';
import { MAX_SZ_DEPTH } from '@csszyx/compiler/sz-limits';
import { z } from 'zod';

export const validateSchema = z.object({
    sz: z
        .record(z.string(), z.any())
        .describe('The sz prop object to validate. Example: { padding: 4, bg: "blue-500" }'),
});

/** Validated input type for the csszyx_validate tool. */
export type ValidateInput = z.infer<typeof validateSchema>;

/** A single validation error for an sz prop key. */
interface ValidationError {
    key: string;
    message: string;
    suggestion?: string;
}

/** The tail of the key check's message for a key it does not know. */
const UNKNOWN_KEY = ' Not a valid sz key, variant, or special prop.';

/**
 * Return the validation error for one sz entry, if any.
 *
 * @param key Candidate sz key.
 * @param value Candidate sz value.
 * @returns Validation error when the entry is unsupported.
 */
function validateEntry(key: string, value: unknown): ValidationError | undefined {
    const suggestion = SUGGESTION_MAP[key];
    if (suggestion) {
        return {
            key,
            message: REPLACED_KEYS.has(key)
                ? `'${key}' was replaced by '${suggestion}' in 0.18.0.`
                : `Unknown prop '${key}'. This is a CSS property name, not an sz key.`,
            suggestion: `Use '${suggestion}' instead. Example: { ${suggestion.split(/[\s/(]/)[0]}: ${JSON.stringify(value)} }`,
        };
    }

    const removed = REMOVED_BOOLEAN_SUGAR[key];
    if (removed && value === true) {
        return {
            key,
            message: REPLACED_KEYS.has(key)
                ? `'${key}: true' was replaced; it emits no class.`
                : `'${key}: true' boolean sugar was removed; it emits no class.`,
            suggestion: `Use { ${removed.key}: ${JSON.stringify(removed.value)} } instead.`,
        };
    }

    const isSpecial =
        ['@container', '*'].includes(key) || key.startsWith('@') || key.startsWith('[');
    const isKnown =
        key in PROPERTY_MAP ||
        BOOLEAN_SHORTHANDS.has(key) ||
        KNOWN_SPECIAL_PROPERTIES.has(key) ||
        KNOWN_VARIANTS.has(key) ||
        isSpecial;
    return isKnown
        ? undefined
        : {
              key,
              message: `Unknown prop '${key}'.${UNKNOWN_KEY}`,
          };
}

/** Filename the engine attributes diagnostics to; stripped from the messages. */
const PREVIEW_FILE = 'validate.tsx';
const LOCATION = / at validate\.tsx:\d+/g;

/** One `key: value` entry at the end of a chain of variant keys. */
interface Leaf {
    /** Variant keys down to the entry, then the entry's own key. */
    path: string[];
    value: unknown;
}

/**
 * Whether a key names a property rather than a variant.
 *
 * @param key Candidate sz key.
 * @returns True when the compiler lowers the key as a property.
 */
function isPropertyKey(key: string): boolean {
    return key in PROPERTY_MAP || BOOLEAN_SHORTHANDS.has(key) || KNOWN_SPECIAL_PROPERTIES.has(key);
}

/**
 * Every property entry of an sz object, walking into variant objects.
 *
 * @param sz The object to walk.
 * @param path Variant keys above it.
 * @returns The entries, in object order.
 */
function leaves(sz: Record<string, unknown>, path: string[] = []): Leaf[] {
    // Past the depth limit the transform throws, and a self-referencing
    // object would never end: stop and let the compiler report it.
    return Object.entries(sz).flatMap(([key, value]) =>
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !isPropertyKey(key) &&
        path.length < MAX_SZ_DEPTH
            ? leaves(value as Record<string, unknown>, [...path, key])
            : [{ path: [...path, key], value }],
    );
}

/**
 * Rebuild one entry inside its variant chain.
 *
 * @param leaf The entry.
 * @returns An sz object holding only that entry.
 */
function nest(leaf: Leaf): Record<string, unknown> {
    return leaf.path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), leaf.value) as Record<
        string,
        unknown
    >;
}

/**
 * The engine's diagnostics for an sz object, location removed.
 *
 * JSON is a JavaScript expression, so the object goes into the source as-is.
 * An object JSON cannot write (one that references itself) reports nothing
 * here; the runtime transform reports it as `transformError`.
 *
 * @param sz The object to compile.
 * @returns The diagnostics.
 */
function engineDiagnostics(sz: Record<string, unknown>): string[] {
    try {
        const source = `export const A = () => <p sz={${JSON.stringify(sz)}} />;`;
        return transformSource(source, PREVIEW_FILE).diagnostics.map(message =>
            String(message).replace(LOCATION, ''),
        );
    } catch {
        return [];
    }
}

/**
 * Run the runtime transform with its console warnings silenced: the engine's
 * diagnostics already carry them, and a deduped copy would only add noise.
 *
 * @param sz The object to transform.
 * @returns The class names.
 */
function quietTransform(sz: SzObject): { className: string } {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        return transform(sz);
    } finally {
        console.warn = originalWarn;
    }
}

/**
 * Whether one entry, lowered on its own, emits no class.
 *
 * @param leaf The entry, with its path from the object root.
 * @returns True when it emits nothing; false when it does or cannot be lowered.
 */
function emitsNoClass(leaf: Leaf): boolean {
    let className: string | undefined;
    try {
        className = quietTransform(nest(leaf) as SzObject).className;
    } catch {
        // Too deep: reported once, as transformError.
    }
    return className === '';
}

/**
 * File one entry's diagnostics: an entry that emits nothing is an error, and
 * an entry the key check already rejected keeps its error, with the
 * compiler's note in place of "unknown key" when the key was removed.
 *
 * @param key The entry's dotted path.
 * @param diagnostics The engine's messages for it.
 * @param emitsNothing Whether it emits no class.
 * @param errors Key-level errors so far, mutated in place.
 * @returns Whether the messages now belong to an error, not a warning.
 */
function recordEntryDiagnostics(
    key: string,
    diagnostics: string[],
    emitsNothing: boolean,
    errors: ValidationError[],
): boolean {
    const existing = errors.find(error => error.key === key);
    if (existing) {
        if (emitsNothing && existing.message.endsWith(UNKNOWN_KEY)) {
            existing.message = diagnostics.join(' ');
        }
        return true;
    }
    if (!emitsNothing) return false;
    errors.push({ key, message: diagnostics.join(' ') });
    return true;
}

/**
 * Turn each entry's diagnostics into errors (no class emitted) or warnings.
 *
 * @param sz The object to check.
 * @param errors Key-level errors so far, mutated in place.
 * @returns The warnings.
 */
function diagnoseEntries(sz: Record<string, unknown>, errors: ValidationError[]): string[] {
    const errorMessages = new Set<string>();
    const warnings: string[] = [];
    for (const leaf of leaves(sz)) {
        const diagnostics = engineDiagnostics(nest(leaf));
        if (diagnostics.length === 0) continue;
        const recorded = recordEntryDiagnostics(
            leaf.path.join('.'),
            diagnostics,
            emitsNoClass(leaf),
            errors,
        );
        if (recorded) for (const message of diagnostics) errorMessages.add(message);
    }
    // Diagnostics about the object as a whole (a stand-alone key beside its
    // groups) belong to no one entry, so they are read off the full object.
    for (const message of engineDiagnostics(sz)) {
        if (!errorMessages.has(message) && !warnings.includes(message)) warnings.push(message);
    }
    return warnings;
}

/**
 * Validate a sz prop object and report unknown keys, CSS property name mistakes, and transform errors.
 * @param input - The validated input object.
 * @returns MCP tool response with validation results.
 */
export function handleValidate(input: ValidateInput): {
    content: Array<{ type: 'text'; text: string }>;
} {
    const errors: ValidationError[] = [];

    for (const key of Object.keys(input.sz)) {
        const error = validateEntry(key, input.sz[key]);
        if (error) {
            errors.push(error);
        }
    }
    const warnings = diagnoseEntries(input.sz, errors);

    let transformResult: { className: string } | null = null;
    let transformError: string | null = null;
    try {
        transformResult = quietTransform(input.sz);
    } catch (err) {
        transformError = err instanceof Error ? err.message : String(err);
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(
                    {
                        valid: errors.length === 0 && !transformError,
                        errors: errors.length > 0 ? errors : undefined,
                        warnings: warnings.length > 0 ? warnings : undefined,
                        transformResult: transformResult
                            ? {
                                  className: transformResult.className,
                                  classCount: transformResult.className.split(/\s+/).filter(Boolean)
                                      .length,
                              }
                            : undefined,
                        transformError: transformError ?? undefined,
                    },
                    null,
                    2,
                ),
            },
        ],
    };
}
