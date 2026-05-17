/**
 * csszyx_batch — Expand multiple sz objects to Tailwind classes in one call.
 * More efficient than calling csszyx_expand per object when processing many components.
 * Example: [{ p: 4 }, { m: 2, bg: 'red' }] → ["p-4", "m-2 bg-red"]
 */

import { transform } from '@csszyx/compiler';
import { z } from 'zod';

export const batchSchema = z.object({
    items: z
        .array(z.record(z.any()))
        .describe(
            "Array of sz prop objects to expand. Example: [{ p: 4 }, { m: 2, bg: 'red-500' }]",
        ),
});

/** Validated input type for the csszyx_batch tool. */
export type BatchInput = z.infer<typeof batchSchema>;

/**
 * Expand multiple sz objects into Tailwind CSS class strings in one call.
 * @param input - The validated input object.
 * @returns MCP tool response with per-item results.
 */
export function handleBatch(input: BatchInput): { content: Array<{ type: 'text'; text: string }> } {
    const results = input.items.map((sz, index) => {
        try {
            const result = transform(sz);
            return {
                index,
                className: result.className,
                attributes:
                    Object.keys(result.attributes).length > 0 ? result.attributes : undefined,
            };
        } catch (err) {
            return {
                index,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    });

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(
                    {
                        results,
                        totalItems: input.items.length,
                        successful: results.filter(r => !('error' in r)).length,
                    },
                    null,
                    2,
                ),
            },
        ],
    };
}
