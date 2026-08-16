/**
 * csszyx_validate — Validate a sz object for correctness before using it.
 *
 * Checks each key against the real compiler's generated canonical-key sets,
 * then runs transform() to confirm the output is valid.
 * Reports unknown props, CSS property name mistakes (padding → p), and type errors.
 *
 * Example: { padding: 4 } → error "Unknown prop 'padding'. Use 'p' instead."
 */

import {
    BOOLEAN_SHORTHANDS,
    KNOWN_SPECIAL_PROPERTIES,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    REMOVED_BOOLEAN_SUGAR,
    SUGGESTION_MAP,
    transform,
} from '@csszyx/compiler';
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
            message: `Unknown prop '${key}'. This is a CSS property name, not an sz key.`,
            suggestion: `Use '${suggestion}' instead. Example: { ${suggestion.split(/[\s/(]/)[0]}: ${JSON.stringify(value)} }`,
        };
    }

    const removed = REMOVED_BOOLEAN_SUGAR[key];
    if (removed && value === true) {
        return {
            key,
            message: `'${key}: true' boolean sugar was removed; it emits no class.`,
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
              message: `Unknown prop '${key}'. Not a valid sz key, variant, or special prop.`,
          };
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
    const warnings: string[] = [];

    for (const key of Object.keys(input.sz)) {
        const error = validateEntry(key, input.sz[key]);
        if (error) {
            errors.push(error);
        }
    }

    // Run the real compiler transform to catch any remaining issues. The
    // compiler reports value-level problems (invalid color strings, dropped
    // values, …) through console.warn rather than throwing — capture those
    // for the duration of the call so they surface as `warnings` instead of
    // vanishing into the MCP server's stderr.
    let transformResult: { className: string } | null = null;
    let transformError: string | null = null;
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
        warnings.push(
            args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '),
        );
    };
    try {
        transformResult = transform(input.sz);
    } catch (err) {
        transformError = err instanceof Error ? err.message : String(err);
    } finally {
        console.warn = originalWarn;
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
