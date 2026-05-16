/**
 * csszyx_validate — Validate a sz object for correctness before using it.
 *
 * Checks each key against PROPERTY_MAP, KNOWN_VARIANTS, and BOOLEAN_SHORTHANDS
 * from the real compiler, then runs transform() to confirm the output is valid.
 * Reports unknown props, CSS property name mistakes (padding → p), and type errors.
 *
 * Example: { padding: 4 } → error "Unknown prop 'padding'. Use 'p' instead."
 */

import {
    BOOLEAN_SHORTHANDS,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    SUGGESTION_MAP,
    transform,
} from '@csszyx/compiler';
import { z } from 'zod';

export const validateSchema = z.object({
    sz: z
        .record(z.any())
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
        // Catch CSS property names used instead of sz keys (e.g. padding, margin).
        if (SUGGESTION_MAP[key]) {
            errors.push({
                key,
                message: `Unknown prop '${key}'. This is a CSS property name, not an sz key.`,
                suggestion: `Use '${SUGGESTION_MAP[key]}' instead. Example: { ${SUGGESTION_MAP[key].split(/[\s/(]/)[0]}: ${JSON.stringify(input.sz[key])} }`,
            });
            continue;
        }

        const isProperty = key in PROPERTY_MAP;
        const isBoolean = BOOLEAN_SHORTHANDS.has(key);
        const isVariant = KNOWN_VARIANTS.has(key);
        const isSpecial =
            ['css', '@container', '*'].includes(key) || key.startsWith('@') || key.startsWith('[');

        if (!isProperty && !isBoolean && !isVariant && !isSpecial) {
            errors.push({
                key,
                message: `Unknown prop '${key}'. Not a valid sz key, variant, or special prop.`,
            });
        }
    }

    // Run the real compiler transform to catch any remaining issues.
    let transformResult: { className: string } | null = null;
    let transformError: string | null = null;
    try {
        transformResult = transform(input.sz);
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
