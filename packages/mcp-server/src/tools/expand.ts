/**
 * csszyx_expand — Expand a single sz object into Tailwind CSS classes.
 * Calls transform() from @csszyx/compiler.
 * Example: { p: 4, bg: 'blue-500' } → "p-4 bg-blue-500"
 */

import { transform } from '@csszyx/compiler';
import { z } from 'zod';

export const expandSchema = z.object({
    sz: z.record(z.any()).describe(
        "The sz prop object to expand. Example: { p: 4, bg: 'blue-500', hover: { bg: 'blue-700' } }",
    ),
});

/** Validated input type for the csszyx_expand tool. */
export type ExpandInput = z.infer<typeof expandSchema>;

/**
 * Expand a single sz object into a Tailwind CSS class string.
 * @param input - The validated input object.
 * @returns MCP tool response with className and attribute output.
 */
export function handleExpand(input: ExpandInput): { content: Array<{ type: 'text'; text: string }> } {
    const result = transform(input.sz);
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify({
                    className: result.className,
                    attributes: result.attributes,
                    classCount: result.className.split(/\s+/).filter(Boolean).length,
                }, null, 2),
            },
        ],
    };
}
