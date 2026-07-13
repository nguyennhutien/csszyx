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
    REMOVED_BOOLEAN_SUGAR,
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

        // Removed boolean-sugar aliases in their BOOLEAN form (`{ flex: true }`,
        // `{ absolute: true }`, …) now emit NO class — a silent no-op that passes a
        // naive "is it a known key" check. Flag only the `=== true` form with the
        // canonical replacement; the same keys stay valid for real shorthand values
        // (`flex: 'auto'`, `flex: 1`), so don't touch those.
        const removed = REMOVED_BOOLEAN_SUGAR[key];
        if (removed && input.sz[key] === true) {
            errors.push({
                key,
                message: `'${key}: true' boolean sugar was removed; it emits no class.`,
                suggestion: `Use { ${removed.key}: ${JSON.stringify(removed.value)} } instead.`,
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
