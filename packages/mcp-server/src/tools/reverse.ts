/**
 * csszyx_reverse — Convert a Tailwind CSS class string into a sz object.
 * Calls classNameToSzObject() from @csszyx/cli.
 * Example: "p-4 bg-blue-500 hover:text-white" → { p: 4, bg: 'blue-500', hover: { color: 'white' } }
 */

import { classNameToSzObject } from '@csszyx/cli';
import { z } from 'zod';

export const reverseSchema = z.object({
    classes: z
        .string()
        .describe(
            'Tailwind CSS class string to convert. Example: "p-4 bg-blue-500 hover:text-white"',
        ),
});

/** Validated input type for the csszyx_reverse tool. */
export type ReverseInput = z.infer<typeof reverseSchema>;

/**
 * Convert a Tailwind class string into a structured sz object.
 * @param input - The validated input object.
 * @returns MCP tool response with the sz object and any unrecognized classes.
 */
export function handleReverse(input: ReverseInput): {
    content: Array<{ type: 'text'; text: string }>;
} {
    const { szObject, unrecognized } = classNameToSzObject(input.classes.trim());

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(
                    {
                        szObject,
                        unrecognized: unrecognized.length > 0 ? unrecognized : undefined,
                        totalRecognized: Object.keys(szObject).length,
                        totalUnrecognized: unrecognized.length,
                    },
                    null,
                    2,
                ),
            },
        ],
    };
}
